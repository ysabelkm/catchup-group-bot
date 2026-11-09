/**
 * Milestone 5 commands end-to-end: /due, /remove, /editors, /settings, /catchup and the DM
 * daily summary, through the real bot and a local Postgres. Telegram is faked, including
 * getChatMember (who is admin / member / outsider).
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
const { sendDueSummaries } = await import("../src/summary/send.js");

const TZ = "Africa/Lagos";
const CHAT_ID = -1009999000003;
const BOT_ID = 42;
const chat = { id: CHAT_ID, type: "supergroup" as const, title: "MIS 400L (test)" };
const adminUser = { id: 910001, is_bot: false, first_name: "Admin" };
const rep = { id: 910002, is_bot: false, first_name: "Rep" };
const student = { id: 910003, is_bot: false, first_name: "Student" };
const outsider = { id: 910004, is_bot: false, first_name: "Outsider" };
const ALL = [adminUser, rep, student, outsider];

type Call = { method: string; payload: Record<string, unknown> };
let calls: Call[] = [];
let botMsgId = 5000;

const bot = createBot("123456:test-token");
bot.botInfo = {
  id: BOT_ID, is_bot: true, first_name: "CatchUp", username: "catchup_group_bot", can_join_groups: true,
  can_read_all_group_messages: true, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false,
} as typeof bot.botInfo;
bot.api.config.use(async (_prev, method, payload) => {
  const p = payload as unknown as Record<string, unknown>;
  calls.push({ method, payload: p });
  if (method === "getChatMember") {
    const uid = p.user_id as number;
    const status = uid === adminUser.id ? "administrator" : uid === rep.id || uid === student.id ? "member" : "left";
    return { ok: true, result: { status, user: { id: uid, is_bot: false, first_name: "x" } } } as never;
  }
  if (method === "sendMessage") {
    return { ok: true, result: { message_id: ++botMsgId, date: 0, chat: { id: p.chat_id, type: "private" }, text: p.text } } as never;
  }
  return { ok: true, result: true } as never;
});

let updateId = Date.now() * 10 + 5;
let msgId = 100;
const now = () => Math.floor(Date.now() / 1000);
const send = (from: typeof student, text: string, extra: Record<string, unknown> = {}) => {
  const entities = text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] : undefined;
  return bot.handleUpdate({ update_id: ++updateId, message: { message_id: ++msgId, date: now(), chat, from, text, entities, ...extra } } as unknown as Update);
};
const dm = (from: typeof student, text: string) =>
  bot.handleUpdate({
    update_id: ++updateId,
    message: { message_id: ++msgId, date: now(), chat: { id: from.id, type: "private", first_name: from.first_name }, from, text, entities: [{ type: "bot_command", offset: 0, length: text.length }] },
  } as unknown as Update);
const replyTo = (id: number, from = student) => ({ reply_to_message: { message_id: id, date: 0, chat, from } });
const replyToBot = (id: number) => ({ reply_to_message: { message_id: id, date: 0, chat, from: { id: BOT_ID, is_bot: true, first_name: "CatchUp" }, text: "📋" } });
const press = (from: typeof student, data: string, messageId = 1) =>
  bot.handleUpdate({
    update_id: ++updateId,
    callback_query: { id: String(++updateId), from, chat_instance: "ci", data, message: { message_id: messageId, date: 0, chat, from: { id: BOT_ID, is_bot: true, first_name: "CatchUp" }, text: "menu" } },
  } as unknown as Update);

const sentTexts = (chatId = CHAT_ID) => calls.filter((c) => (c.method === "sendMessage" || c.method === "editMessageText") && c.payload.chat_id === chatId).map((c) => String(c.payload.text));
const lastText = (chatId = CHAT_ID) => sentTexts(chatId).at(-1) ?? "";
const callbackAnswers = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => String(c.payload.text ?? ""));
const wall = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm") : null);

let groupId: number;
let assignmentMsg: number;

async function cleanUp() {
  await prisma.group.deleteMany({ where: { telegramChatId: BigInt(CHAT_ID) } });
  await prisma.user.deleteMany({ where: { telegramUserId: { in: ALL.map((u) => BigInt(u.id)) } } });
}

beforeAll(async () => {
  await cleanUp();
  await send(adminUser, "/setup");
  groupId = (await prisma.group.findUniqueOrThrow({ where: { telegramChatId: BigInt(CHAT_ID) } })).id;
  await send(rep, "CSC 411 Assignment 2, submit on the portal by 20 Nov 2099");
  assignmentMsg = msgId;
  await send(rep, "MTH 201 assignment is out, check the portal");
  await send(rep, "Focus on chapters 3-5 for the test");
  calls = [];
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe("/due", () => {
  it("is refused for ordinary members", async () => {
    await send(student, "/due 25 Nov 2099", replyTo(assignmentMsg, rep));
    expect(lastText()).toContain("Only admins and class reps");
    const a = await prisma.item.findFirstOrThrow({ where: { groupId, courseCode: "CSC 411" } });
    expect(wall(a.dueAt)).toBe("2099-11-20 23:59");
  });

  it("an admin replying to the item's message sets a manual date", async () => {
    await send(adminUser, "/due 25 Nov 2099 2pm", replyTo(assignmentMsg, rep));
    const a = await prisma.item.findFirstOrThrow({ where: { groupId, courseCode: "CSC 411" }, include: { changes: true } });
    expect(wall(a.dueAt)).toBe("2099-11-25 14:00");
    expect(a.dueSource).toBe("manual");
    expect(a.changes.at(-1)).toMatchObject({ field: "dueAt", changedBy: `manual:${adminUser.id}` });
    expect(lastText()).toContain("CSC 411 – Assignment 2</b> is now due");
  });

  it("a later message can't override a manual date", async () => {
    await send(rep, "CSC 411 assignment deadline extended to 30 Nov 2099");
    const a = await prisma.item.findFirstOrThrow({ where: { groupId, courseCode: "CSC 411" } });
    expect(wall(a.dueAt)).toBe("2099-11-25 14:00");
  });

  it("replying to a summary shows buttons; only the requester can pick", async () => {
    calls = [];
    await send(adminUser, "/due 1 Dec 2099", replyToBot(4999));
    const menu = calls.find((c) => c.method === "sendMessage" && String(c.payload.text).startsWith("Which item"))!;
    const buttons = (menu.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.flat();
    const mth = buttons.find((b) => b.text.startsWith("MTH 201"))!;
    expect(buttons.some((b) => b.text.startsWith("Tip"))).toBe(false); // tips have no due dates

    await press(student, mth.callback_data);
    expect(callbackAnswers().at(-1)).toContain("Only the person who sent the command");

    await press(adminUser, mth.callback_data);
    const m = await prisma.item.findFirstOrThrow({ where: { groupId, courseCode: "MTH 201" } });
    expect(wall(m.dueAt)).toBe("2099-12-01 23:59");
    expect(lastText()).toContain("MTH 201 – Assignment</b> is now due");
  });

  it("explains how to use it", async () => {
    await send(adminUser, "/due next blue moon", replyTo(assignmentMsg, rep));
    expect(lastText()).toContain("couldn't read");
    await send(adminUser, "/due 20 Nov");
    expect(lastText()).toContain("Reply to the assignment");
  });
});

describe("/editors and /remove", () => {
  it("a class rep added by an admin can remove items", async () => {
    await send(rep, "/remove", replyTo(assignmentMsg, rep));
    expect(lastText()).toContain("Only admins and class reps");

    await send(student, "/editors add", replyTo(assignmentMsg, rep));
    expect(lastText()).toContain("Only group admins");

    await send(adminUser, "/editors add", replyTo(assignmentMsg, rep));
    expect(lastText()).toContain("Rep is now a class rep");

    await send(rep, "/remove", replyTo(assignmentMsg, rep));
    const a = await prisma.item.findFirstOrThrow({ where: { groupId, courseCode: "CSC 411" } });
    expect(a.status).toBe("removed");

    await send(adminUser, "/editors");
    expect(lastText()).toContain("• Rep");
  });
});

describe("/settings", () => {
  it("admins toggle options with buttons; others can't", async () => {
    await send(adminUser, "/settings");
    await press(student, `set:${groupId}:sendWhenEmpty`);
    expect(callbackAnswers().at(-1)).toContain("Only group admins");
    await press(adminUser, `set:${groupId}:sendWhenEmpty`);
    await press(adminUser, `set:${groupId}:noteTipRule`);
    const g = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    expect(g.settings).toMatchObject({ sendWhenEmpty: false, noteTipRule: "7days" });
  });
});

describe("private chat", () => {
  it("/catchup shows only groups the user is really in", async () => {
    await dm(student, "/catchup");
    const text = lastText(student.id);
    expect(text).toContain("Your catch-up");
    expect(text).toContain("MIS 400L (test)");
    expect(text).toContain("MTH 201 – Assignment");
    expect(text).not.toContain("CSC 411"); // removed
    expect((await prisma.user.findUniqueOrThrow({ where: { telegramUserId: BigInt(student.id) } })).lastCatchupAt).not.toBeNull();

    await dm(outsider, "/catchup");
    expect(lastText(outsider.id)).toContain("couldn't find you");
  });

  it("the daily DM summary goes to opted-in members only", async () => {
    await dm(student, "/start");
    await dm(outsider, "/start");
    await bot.handleUpdate({ update_id: ++updateId, callback_query: { id: "a", from: student, chat_instance: "c", data: "dm:toggle", message: { message_id: 1, date: 0, chat: { id: student.id, type: "private" }, text: "w" } } } as unknown as Update);
    await bot.handleUpdate({ update_id: ++updateId, callback_query: { id: "b", from: outsider, chat_instance: "c", data: "dm:toggle", message: { message_id: 1, date: 0, chat: { id: outsider.id, type: "private" }, text: "w" } } } as unknown as Update);
    expect((await prisma.user.findUniqueOrThrow({ where: { telegramUserId: BigInt(student.id) } })).dmSummaries).toBe(true);

    calls = [];
    await prisma.summaryLog.deleteMany({ where: { groupId } });
    const at7pm = DateTime.now().setZone(TZ).set({ hour: 19, minute: 1 }).toJSDate();
    await sendDueSummaries(bot.api, at7pm);
    await sendDueSummaries(bot.api, DateTime.fromJSDate(at7pm).plus({ minutes: 10 }).toJSDate()); // no double DM

    expect(sentTexts(CHAT_ID).filter((t) => t.includes("Daily summary"))).toHaveLength(1);
    const studentDms = sentTexts(student.id).filter((t) => t.includes("Your daily summary"));
    expect(studentDms).toHaveLength(1);
    expect(studentDms[0]).toContain("MIS 400L (test)");
    expect(sentTexts(outsider.id).filter((t) => t.includes("Your daily summary"))).toHaveLength(0);
  });
});
