/**
 * Raw-message retention: messages past RAW_MESSAGE_RETENTION_DAYS (default 30) are wiped
 * by the daily job, items built from them keep working, and edits can't bring text back.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { Update } from "grammy/types";

const { createBot } = await import("../src/bot.js");
const { prisma } = await import("../src/db.js");
const { purgeOldMessages } = await import("../src/services/retention.js");

const CHAT_ID = -1009999000004;
const chat = { id: CHAT_ID, type: "supergroup" as const, title: "Retention (test)" };
const from = { id: 920001, is_bot: false, first_name: "Rep" };
const daysAgo = (n: number) => DateTime.now().minus({ days: n }).toJSDate();

const bot = createBot("123456:test-token");
bot.botInfo = { id: 42, is_bot: true, first_name: "CatchUp", username: "catchup_group_bot", can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as typeof bot.botInfo;
bot.api.config.use(async () => ({ ok: true, result: true }) as never);

let groupId: number;
let senderId: number;
const ids = { oldWithItem: 0, oldChatter: 0, recent: 0 };

async function cleanUp() {
  await prisma.group.deleteMany({ where: { telegramChatId: BigInt(CHAT_ID) } });
  await prisma.user.deleteMany({ where: { telegramUserId: BigInt(from.id) } });
}

beforeAll(async () => {
  await cleanUp();
  groupId = (await prisma.group.create({ data: { telegramChatId: BigInt(CHAT_ID), title: chat.title, enabled: true } })).id;
  senderId = (await prisma.user.create({ data: { telegramUserId: BigInt(from.id), firstName: from.first_name } })).id;
  const message = (telegramMessageId: number, sentAt: Date, text: string, extra = {}) =>
    prisma.message.create({ data: { groupId, telegramMessageId, sentAt, text, senderId, processedAt: sentAt, ...extra } });

  const oldWithItem = await message(1, daysAgo(40), "CSC 411 Assignment 2, submit by Friday", {
    links: ["https://drive.google.com/x"], hasFile: true, fileType: "document", fileName: "csc411_ass2.pdf", mimeType: "application/pdf",
  });
  ids.oldWithItem = oldWithItem.id;
  ids.oldChatter = (await message(2, daysAgo(31), "ok 😂")).id;
  ids.recent = (await message(3, daysAgo(29), "Focus on chapters 3-5 for the test")).id;
  await prisma.item.create({
    data: {
      groupId, type: "assignment", title: "CSC 411 – Assignment 2", courseCode: "CSC 411", expiresAt: daysAgo(35),
      firstMessageId: oldWithItem.id, sources: { create: { messageId: oldWithItem.id, kind: "created" } },
    },
  });
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe("purgeOldMessages", () => {
  it("wipes content older than the limit and keeps what links need", async () => {
    const result = await purgeOldMessages();
    expect(result.messagesWiped).toBeGreaterThanOrEqual(2);

    const old = await prisma.message.findUniqueOrThrow({ where: { id: ids.oldWithItem }, include: { sources: true } });
    expect(old).toMatchObject({ text: null, links: [], fileName: null, mimeType: null, senderId: null });
    expect(old).toMatchObject({ telegramMessageId: 1, hasFile: true, fileType: "document" }); // enough for the ↗ link
    expect(old.processedAt).not.toBeNull();
    expect(old.sources).toHaveLength(1); // the item still points at it

    expect((await prisma.message.findUniqueOrThrow({ where: { id: ids.oldChatter } })).text).toBeNull();
    expect((await prisma.item.findFirstOrThrow({ where: { groupId } })).title).toBe("CSC 411 – Assignment 2");
  });

  it("leaves messages inside the limit alone", async () => {
    const recent = await prisma.message.findUniqueOrThrow({ where: { id: ids.recent } });
    expect(recent).toMatchObject({ text: "Focus on chapters 3-5 for the test", senderId });
  });

  it("is a no-op the second time", async () => {
    const again = await purgeOldMessages();
    const stillOurs = await prisma.message.count({ where: { groupId, text: { not: null } } });
    expect(stillOurs).toBe(1);
    expect(again.messagesWiped).toBe(0);
  });

  it("prunes old update ids but keeps recent ones", async () => {
    const base = BigInt(Date.now()) * 100n;
    await prisma.processedUpdate.createMany({ data: [{ updateId: base, processedAt: daysAgo(8) }, { updateId: base + 1n, processedAt: daysAgo(1) }] });
    await purgeOldMessages();
    const left = await prisma.processedUpdate.findMany({ where: { updateId: { in: [base, base + 1n] } } });
    expect(left.map((u) => u.updateId)).toEqual([base + 1n]);
    await prisma.processedUpdate.deleteMany({ where: { updateId: base + 1n } });
  });
});

describe("edits after the limit", () => {
  it("an edit to a wiped message doesn't bring its text back", async () => {
    const date = Math.floor(daysAgo(40).getTime() / 1000);
    await bot.handleUpdate({
      update_id: Date.now() * 10 + 7,
      edited_message: { message_id: 1, date, edit_date: Math.floor(Date.now() / 1000), chat, from, text: "CSC 411 Assignment 2, submit by Friday (edited)" },
    } as unknown as Update);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: ids.oldWithItem } })).text).toBeNull();
  });
});
