import type { Context } from "grammy";
import { logger } from "../logger.js";
import { GROUP_ANONYMOUS_BOT_ID } from "./telegram.js";

/** True if the sender of this update is a Telegram admin of the current group. */
export async function isGroupAdmin(ctx: Context): Promise<boolean> {
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || !from || (chat.type !== "group" && chat.type !== "supergroup")) return false;

  // Anonymous admins post "as the group"; only admins can do that.
  if (from.id === GROUP_ANONYMOUS_BOT_ID && ctx.msg?.sender_chat?.id === chat.id) return true;

  try {
    const member = await ctx.api.getChatMember(chat.id, from.id);
    return member.status === "creator" || member.status === "administrator";
  } catch (err) {
    logger.warn({ err, chatId: chat.id }, "getChatMember failed during admin check");
    return false;
  }
}

/**
 * Whether the bot can see ordinary group messages: either privacy mode is off
 * (BotFather → /setprivacy → Disable) or the bot is an admin in this chat (spec §5.4).
 */
export async function botCanReadMessages(ctx: Context): Promise<{ ok: boolean; privacyModeOff: boolean; isAdmin: boolean }> {
  const me = ctx.me;
  const privacyModeOff = me.can_read_all_group_messages === true;
  let isAdmin = false;
  if (ctx.chat) {
    try {
      const member = await ctx.api.getChatMember(ctx.chat.id, me.id);
      isAdmin = member.status === "administrator";
    } catch (err) {
      logger.warn({ err, chatId: ctx.chat.id }, "could not check bot's own membership");
    }
  }
  return { ok: privacyModeOff || isAdmin, privacyModeOff, isAdmin };
}
