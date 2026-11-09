/**
 * Integration test (spec §7): fake Telegram updates → ingestion → rule-based extraction →
 * items in a real Postgres database. Telegram API calls are intercepted, nothing leaves the machine.
 *
 * Needs a migrated local database (DATABASE_URL, default postgresql://localhost:5432/catchup_bot).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { Update } from "grammy/types";

process.env.TELEGRAM_BOT_TOKEN ||= "123456:test-token";
process.env.DATABASE_URL ||= "postgresql://localhost:5432/catchup_bot";
process.env.BOT_MODE = "polling";
process.env.LOG_LEVEL = "silent";

const { createBot } = await import("../src/bot.js");
const { prisma } = await import("../src/db.js");
const { activeItems } = await import("../src/services/items.js");

const CHAT_ID = -1009999000001; // fake forum supergroup reserved for tests
const TZ = "Africa/Lagos";
const unix = (iso: string) => Math.floor(DateTime.fromISO(iso, { zone: TZ }).toSeconds());
const wall = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm") : null);

const chat = { id: CHAT_ID, type: "supergroup" as const, title: "CSC 400L (test)", is_forum: true as const };
const ada = { id: 900001, is_bot: false, first_name: "Ada" };
const rep = { id: 900002, is_bot: false, first_name: "Class Rep" };

// Unique per run: processed update ids are remembered (idempotency), so reusing them would skip everything.
let updateId = Date.now() * 10;
const apiCalls: { method: string; payload: unknown }[] = [];

function buildBot() {
  const bot = createBot("123456:test-token");
  bot.botInfo = {
    id: 42, is_bot: true, first_name: "CatchUp", username: "catchup_group_bot",
    can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false,
    can_connect_to_business: false, has_main_web_app: false,
  } as typeof bot.botInfo;
  // Answer every Telegram API call locally.
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload });
    return { ok: true, result: { message_id: 1, date: 0, chat } } as never;
  });
  return bot;
}

type Msg = Record<string, unknown>;
const message = (id: number, at: string, from: typeof ada, extra: Msg): Update =>
  ({ update_id: ++updateId, message: { message_id: id, date: unix(at), chat, from, ...extra } }) as unknown as Update;
const inTopic = (thread: number, extra: Msg = {}): Msg => ({
  is_topic_message: true,
  message_thread_id: thread,
  reply_to_message: { message_id: thread, date: 0, chat, forum_topic_created: { name: "Assignments", icon_color: 0 } },
  ...extra,
});

async function cleanUp() {
  await prisma.group.deleteMany({ where: { telegramChatId: BigInt(CHAT_ID) } });
  await prisma.user.deleteMany({ where: { telegramUserId: { in: [BigInt(ada.id), BigInt(rep.id)] } } });
}

describe("ingestion → extraction → items", () => {
  const bot = buildBot();
  let groupId: number;

  beforeAll(async () => {
    await cleanUp();
    // Messages from "now-ish" so the items are still active when the test runs.
    const base = DateTime.now().setZone(TZ).startOf("day").plus({ hours: 9 });
    const at = (h: number) => base.plus({ hours: h }).toISO()!;

    await bot.handleUpdate(message(5, at(0), rep, { forum_topic_created: { name: "Assignments", icon_color: 0 }, message_thread_id: 5, is_topic_message: true }));
    await bot.handleUpdate(message(10, at(0.1), rep, inTopic(5, { text: "CSC 411 Assignment 2, submit on the portal by 20 Nov 2099" })));
    await bot.handleUpdate(message(11, at(0.2), ada, inTopic(5, { text: "😂😂 ok" })));
    await bot.handleUpdate(message(12, at(0.3), ada, { text: "Good morning everyone" }));
    await bot.handleUpdate(message(13, at(0.4), rep, { text: "MIS 402: form groups of 5 for the project" }));
    await bot.handleUpdate(
      message(14, at(0.5), rep, { caption: "HCI Week 9 slides", document: { file_id: "f", file_unique_id: "u", file_name: "HCI_week9.pdf", mime_type: "application/pdf" } }),
    );
    // A reply that gives the undated project a deadline.
    await bot.handleUpdate(
      message(15, at(0.6), rep, { text: "Deadline for this is 27 Nov 2099", reply_to_message: { message_id: 13, date: 0, chat } }),
    );
    // An extension for the assignment, by course code (no reply).
    await bot.handleUpdate(message(16, at(0.7), rep, inTopic(5, { text: "CSC 411 assignment deadline has been extended to 4 Dec 2099" })));

    const g = await prisma.group.findUniqueOrThrow({ where: { telegramChatId: BigInt(CHAT_ID) } });
    groupId = g.id;
  });

  afterAll(async () => {
    await cleanUp();
    await prisma.$disconnect();
  });

  it("stores messages from every topic and learns topic names", async () => {
    const topics = await prisma.topic.findMany({ where: { groupId } });
    expect(topics.map((t) => t.name)).toEqual(["Assignments"]);
    const stored = await prisma.message.count({ where: { groupId } });
    expect(stored).toBe(7); // all real messages; the topic-creation service message isn't one
  });

  it("creates one item per academic message and ignores chatter", async () => {
    const items = await prisma.item.findMany({ where: { groupId }, orderBy: { id: "asc" } });
    expect(items.map((i) => [i.type, i.title])).toEqual([
      ["assignment", "CSC 411 – Assignment 2"],
      ["project", "MIS 402 – Group project"],
      ["note", "HCI Week 9 slides"],
    ]);
  });

  it("applies the extension to the existing assignment and keeps history", async () => {
    const a = await prisma.item.findFirstOrThrow({ where: { groupId, type: "assignment" }, include: { changes: true, sources: true } });
    expect(wall(a.dueAt)).toBe("2099-12-04 23:59");
    expect(a.changes).toHaveLength(1);
    expect(a.changes[0]).toMatchObject({ field: "dueAt", changedBy: "rule" });
    expect(a.sources.map((s) => s.kind).sort()).toEqual(["created", "updated"]);
  });

  it("a reply adds a due date to an item that had none", async () => {
    const p = await prisma.item.findFirstOrThrow({ where: { groupId, type: "project" } });
    expect(wall(p.dueAt)).toBe("2099-11-27 23:59");
    expect(wall(p.expiresAt)).toBe("2099-11-27 23:59");
  });

  it("an edit re-runs extraction on the same item", async () => {
    await bot.handleUpdate({
      update_id: ++updateId,
      edited_message: { message_id: 10, date: unix(DateTime.now().toISO()!), edit_date: unix(DateTime.now().toISO()!), chat, from: rep, ...inTopic(5, { text: "CSC 411 Assignment 3, submit on the portal by 20 Nov 2099" }) },
    } as unknown as Update);
    const items = await prisma.item.findMany({ where: { groupId, type: "assignment" }, include: { changes: true } });
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("CSC 411 – Assignment 3");
    expect(items[0]!.changes.some((c) => c.field === "title")).toBe(true);
  });

  it("ignores a re-delivered update", async () => {
    const dup = message(99, DateTime.now().toISO()!, rep, { text: "CSC 499 assignment due 1 Dec 2099" });
    await bot.handleUpdate(dup);
    await bot.handleUpdate(dup);
    expect(await prisma.item.count({ where: { groupId, courseCode: "CSC 499" } })).toBe(1);
  });

  it("lists active items with topic names and links", async () => {
    const list = await activeItems(groupId);
    const a = list.find((i) => i.type === "assignment")!;
    expect(a.topicName).toBe("Assignments");
    expect(a.link).toBe("https://t.me/c/9999000001/5/10");
    const note = list.find((i) => i.type === "note")!;
    expect(note.topicName).toBe("General");
    expect(note.link).toBe("https://t.me/c/9999000001/14");
  });
});
