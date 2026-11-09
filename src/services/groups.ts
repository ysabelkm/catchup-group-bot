import type { Chat } from "grammy/types";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";

/** Per-group settings stored in Group.settings (JSON). */
export const GroupSettingsSchema = z.object({
  /** Send "No academic updates today ✅" on empty days (spec §4.5, decision 5). */
  sendWhenEmpty: z.boolean().default(true),
  /** How long notes/tips show (spec §4.4, decision 3). */
  noteTipRule: z.enum(["once", "7days"]).default("once"),
});
export type GroupSettings = z.infer<typeof GroupSettingsSchema>;

export function parseSettings(raw: unknown): GroupSettings {
  const parsed = GroupSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : GroupSettingsSchema.parse({});
}

type GroupChat = Chat.GroupChat | Chat.SupergroupChat;

export function isGroupChat(chat: Chat | undefined): chat is GroupChat {
  return chat?.type === "group" || chat?.type === "supergroup";
}

/** Create the group row if missing and keep title/forum flag in sync. */
export async function upsertGroup(chat: GroupChat) {
  const isForum = chat.type === "supergroup" && chat.is_forum === true;
  return prisma.group.upsert({
    where: { telegramChatId: BigInt(chat.id) },
    create: {
      telegramChatId: BigInt(chat.id),
      title: chat.title,
      isForum,
      timezone: config.DEFAULT_TIMEZONE,
    },
    update: { title: chat.title, isForum, botRemovedAt: null },
  });
}

/** Group was upgraded to a supergroup: Telegram gives it a new chat id (spec §5.4). */
export async function migrateGroup(oldChatId: number, newChatId: number) {
  const [oldGroup, newGroup] = await Promise.all([
    prisma.group.findUnique({ where: { telegramChatId: BigInt(oldChatId) } }),
    prisma.group.findUnique({ where: { telegramChatId: BigInt(newChatId) } }),
  ]);
  if (!oldGroup) return; // Already migrated, or never seen.

  if (!newGroup) {
    await prisma.group.update({
      where: { id: oldGroup.id },
      data: { telegramChatId: BigInt(newChatId) },
    });
    logger.info({ oldChatId, newChatId }, "group migrated to supergroup");
    return;
  }

  // Messages from the new supergroup arrived before the migration notice, so both rows exist.
  // Carry the setup over to the new row and retire the old one; history stays on the old row.
  await prisma.$transaction([
    prisma.group.update({
      where: { id: newGroup.id },
      data: {
        enabled: oldGroup.enabled,
        settings: oldGroup.settings ?? {},
        timezone: oldGroup.timezone,
      },
    }),
    prisma.group.update({
      where: { id: oldGroup.id },
      data: { enabled: false, botRemovedAt: new Date() },
    }),
  ]);
  logger.warn({ oldChatId, newChatId }, "group migrated but both rows existed; settings copied, history not merged");
}

export async function markBotRemoved(chatId: number) {
  await prisma.group.updateMany({
    where: { telegramChatId: BigInt(chatId) },
    data: { enabled: false, botRemovedAt: new Date() },
  });
}

/** Record or rename a forum topic. */
export async function upsertTopic(groupId: number, threadId: number, name: string) {
  return prisma.topic.upsert({
    where: { groupId_threadId: { groupId, threadId } },
    create: { groupId, threadId, name },
    update: { name },
  });
}

/** Make sure a topic row exists for a thread, without overwriting a name we already know. */
export async function ensureTopic(groupId: number, threadId: number) {
  return prisma.topic.upsert({
    where: { groupId_threadId: { groupId, threadId } },
    create: { groupId, threadId, name: `Topic ${threadId}` },
    update: {},
  });
}
