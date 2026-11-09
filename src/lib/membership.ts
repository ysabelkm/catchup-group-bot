import type { Api } from "grammy";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { ensureMember } from "../services/users.js";

const IN_GROUP = new Set(["creator", "administrator", "member"]);

/**
 * Is this Telegram user currently in the group? Asked live via getChatMember (spec §6: only
 * show a user content from groups they're actually in). `cache` avoids repeat calls in one run.
 */
export async function isInGroup(api: Api, chatId: bigint, userId: number, cache?: Map<string, boolean>): Promise<boolean> {
  const key = `${chatId}:${userId}`;
  const hit = cache?.get(key);
  if (hit !== undefined) return hit;
  let result = false;
  try {
    const m = await api.getChatMember(Number(chatId), userId);
    result = IN_GROUP.has(m.status) || (m.status === "restricted" && m.is_member);
  } catch (err) {
    logger.debug({ err, chatId: String(chatId), userId }, "getChatMember failed; treating as not a member");
  }
  cache?.set(key, result);
  return result;
}

/**
 * Enabled groups this user is in, verified live. Checks every enabled group (not just ones
 * where they've posted) so students who only read still get their catch-up.
 */
export async function groupsForUser(api: Api, telegramUserId: number, cache?: Map<string, boolean>) {
  const groups = await prisma.group.findMany({ where: { enabled: true, botRemovedAt: null }, orderBy: { title: "asc" } });
  const mine = [];
  for (const g of groups) {
    if (await isInGroup(api, g.telegramChatId, telegramUserId, cache)) mine.push(g);
  }
  if (mine.length) {
    const user = await prisma.user.findUnique({ where: { telegramUserId: BigInt(telegramUserId) } });
    if (user) for (const g of mine) await ensureMember(user.id, g.id);
  }
  return mine;
}

