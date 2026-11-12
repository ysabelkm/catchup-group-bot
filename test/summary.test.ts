/**
 * Daily summary end-to-end against a real local Postgres, with Telegram intercepted:
 * timing, topic posting, no double-sends, notes shown once, missed days, empty days, fallbacks.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { Bot, GrammyError } from "grammy";

process.env.TELEGRAM_BOT_TOKEN ||= "123456:test-token";
process.env.DATABASE_URL ||= "postgresql://localhost:5432/catchup_bot";
process.env.LOG_LEVEL = "silent";

const { prisma } = await import("../src/db.js");
const { sendDueSummaries } = await import("../src/summary/send.js");

const TZ = "Africa/Lagos";
const lagos = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const CHAT_ID = -1009999000002n;
const SUMMARY_TOPIC = 77;

type Sent = { chat_id: number; text: string; message_thread_id?: number };
let sent: Sent[] = [];
let failNext: ((p: Sent) => GrammyError | null) | null = null;

const bot = new Bot("123456:test-token");
bot.api.config.use(async (_prev, method, payload) => {
  if (method !== "sendMessage") return { ok: true, result: true } as never;
  const p = payload as unknown as Sent;
  const err = failNext?.(p);
  if (err) {
    failNext = null;
    throw err;
  }
  sent.push(p);
  return { ok: true, result: { message_id: 1000 + sent.length, date: 0, chat: { id: p.chat_id, type: "supergroup", title: "t" } } } as never;
});
const api = bot.api;

let groupId: number;
let msgSeq = 0;

async function addItem(over: { type: "assignment" | "task" | "project" | "note" | "tip"; title: string; dueAt?: Date | null; createdAt: Date; expiresAt: Date; status?: "active" | "expired" | "removed" }) {
  const message = await prisma.message.create({ data: { groupId, telegramMessageId: ++msgSeq, sentAt: over.createdAt, text: over.title } });
  return prisma.item.create({
    data: {
      groupId, type: over.type, title: over.title, dueAt: over.dueAt ?? null, createdAt: over.createdAt,
      expiresAt: over.expiresAt, status: over.status ?? "active", sources: { create: { messageId: message.id, kind: "created" } },
    },
  });
}

beforeEach(async () => {
  await prisma.group.deleteMany({ where: { telegramChatId: CHAT_ID } });
  const g = await prisma.group.create({
    data: { telegramChatId: CHAT_ID, title: "Summary test", isForum: true, enabled: true, summaryTopicId: SUMMARY_TOPIC, timezone: TZ },
  });
  groupId = g.id;
  sent = [];
  failNext = null;
  // Only our test group should be considered.
  await prisma.group.updateMany({ where: { id: { not: groupId }, enabled: true, telegramChatId: { lt: -1009999000000n, gt: -1009999999999n } }, data: { enabled: false } });
});

afterAll(async () => {
  await prisma.group.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.$disconnect();
});

const ours = () => sent.filter((s) => BigInt(s.chat_id) === CHAT_ID);

describe("sendDueSummaries", () => {
  it("does nothing before 7 PM", async () => {
    await sendDueSummaries(api, lagos("2026-11-09T18:55"));
    expect(ours()).toHaveLength(0);
  });

  it("posts at 7 PM into the summary topic, once", async () => {
    await addItem({ type: "assignment", title: "CSC 411 – Assignment 2", dueAt: lagos("2026-11-10T23:59"), createdAt: lagos("2026-11-09T09:00"), expiresAt: lagos("2026-11-10T23:59") });
    await sendDueSummaries(api, lagos("2026-11-09T19:00"));
    await sendDueSummaries(api, lagos("2026-11-09T19:05")); // cron retry / late check: no double-send
    expect(ours()).toHaveLength(1);
    expect(ours()[0]!.message_thread_id).toBe(SUMMARY_TOPIC);
    expect(ours()[0]!.text).toContain("<b>CSC 411 – Assignment 2</b>\n└ due <b>TOMORROW</b>");
    const log = await prisma.summaryLog.findFirstOrThrow({ where: { groupId } });
    expect(log).toMatchObject({ summaryDate: "2026-11-09", status: "sent", telegramMessageIds: [1001] });
  });

  it("sends late when 7 PM was missed", async () => {
    await sendDueSummaries(api, lagos("2026-11-09T22:40"));
    expect(ours()).toHaveLength(1);
    expect(ours()[0]!.text).toContain("No academic updates today ✅");
  });

  it("shows a note once, even when it was posted after the previous summary", async () => {
    await addItem({ type: "note", title: "HCI Week 9 slides", createdAt: lagos("2026-11-09T21:00"), expiresAt: lagos("2026-11-11T01:00") });
    await sendDueSummaries(api, lagos("2026-11-10T19:00"));
    await sendDueSummaries(api, lagos("2026-11-11T19:00"));
    expect(ours()).toHaveLength(2);
    expect(ours()[0]!.text).toContain("📝 <b>HCI Week 9 slides</b>");
    expect(ours()[1]!.text).not.toContain("HCI Week 9 slides");
  });

  it("a note whose summary was missed still shows in the next one", async () => {
    // Posted Monday morning; Monday's summary never happened; expiry timer already passed.
    await addItem({ type: "tip", title: "Focus on chapters 3–5", createdAt: lagos("2026-11-09T09:00"), expiresAt: lagos("2026-11-10T01:00"), status: "expired" });
    await sendDueSummaries(api, lagos("2026-11-10T19:00"));
    expect(ours()[0]!.text).toContain("💡 <b>Focus on chapters 3–5");
  });

  it("lists deadlines that passed on days with no summary", async () => {
    await prisma.summaryLog.create({ data: { groupId, summaryDate: "2026-11-06", status: "sent", sentAt: lagos("2026-11-06T19:00") } });
    await addItem({ type: "assignment", title: "CSC 411 – Assignment 1", dueAt: lagos("2026-11-07T23:59"), createdAt: lagos("2026-11-02T09:00"), expiresAt: lagos("2026-11-07T23:59"), status: "expired" });
    await addItem({ type: "assignment", title: "Old one", dueAt: lagos("2026-11-06T23:59"), createdAt: lagos("2026-11-02T09:00"), expiresAt: lagos("2026-11-06T23:59"), status: "expired" });
    await sendDueSummaries(api, lagos("2026-11-09T19:00"));
    const text = ours()[0]!.text;
    expect(text).toContain("⌛ <b>Was due since the last summary</b>");
    expect(text).toContain("<b>CSC 411 – Assignment 1</b>\n└ was due Sat 7 Nov");
    expect(text).not.toContain("Old one"); // shown as "due today" in Friday's summary already
  });

  it("stays quiet on empty days when the group opted out", async () => {
    await prisma.group.update({ where: { id: groupId }, data: { settings: { sendWhenEmpty: false } } });
    await sendDueSummaries(api, lagos("2026-11-09T19:00"));
    expect(ours()).toHaveLength(0);
    expect((await prisma.summaryLog.findFirstOrThrow({ where: { groupId } })).status).toBe("skipped");
  });

  it("falls back to General when the summary topic was deleted", async () => {
    failNext = (p) => (p.message_thread_id ? new GrammyError("x", { ok: false, error_code: 400, description: "Bad Request: message thread not found" }, "sendMessage", {}) : null);
    await sendDueSummaries(api, lagos("2026-11-09T19:00"));
    expect(ours()).toHaveLength(1);
    expect(ours()[0]!.message_thread_id).toBeUndefined();
    expect((await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).summaryTopicId).toBeNull();
  });

  it("retries a failed summary on the next run", async () => {
    failNext = () => new GrammyError("x", { ok: false, error_code: 500, description: "Internal Server Error" }, "sendMessage", {});
    await sendDueSummaries(api, lagos("2026-11-09T19:00"));
    expect(ours()).toHaveLength(0);
    expect((await prisma.summaryLog.findFirstOrThrow({ where: { groupId } })).status).toBe("failed");
    await sendDueSummaries(api, lagos("2026-11-09T19:10"));
    expect(ours()).toHaveLength(1);
    expect((await prisma.summaryLog.findFirstOrThrow({ where: { groupId } })).status).toBe("sent");
  });

  it("marks the group removed when the bot was kicked", async () => {
    failNext = () => new GrammyError("x", { ok: false, error_code: 403, description: "Forbidden: bot was kicked from the supergroup chat" }, "sendMessage", {});
    await sendDueSummaries(api, lagos("2026-11-09T19:00"));
    const g = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    expect(g.enabled).toBe(false);
    expect(g.botRemovedAt).not.toBeNull();
  });
});
