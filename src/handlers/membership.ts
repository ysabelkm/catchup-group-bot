import { Composer } from "grammy";
import { logger } from "../logger.js";
import { JOIN_NOTICE, PRIVACY_MODE_WARNING } from "../lib/texts.js";
import { isGroupChat, markBotRemoved, upsertGroup } from "../services/groups.js";

/** Bot added to / removed from a group (spec §5.4, §6). */
export const membership = new Composer();

type Status = { status: string; is_member?: boolean };
const isPresent = (m: Status) =>
  m.status === "member" || m.status === "administrator" || m.status === "creator" || (m.status === "restricted" && m.is_member === true);

membership.on("my_chat_member", async (ctx) => {
  const chat = ctx.chat;
  if (!isGroupChat(chat)) return;

  const { old_chat_member: before, new_chat_member: after } = ctx.myChatMember;
  const wasIn = isPresent(before);
  const isIn = isPresent(after);

  if (!wasIn && isIn) {
    await upsertGroup(chat);
    logger.info({ chatId: chat.id, title: chat.title }, "bot added to group");
    const opts = { parse_mode: "HTML" as const };
    try {
      await ctx.api.sendMessage(chat.id, JOIN_NOTICE, opts);
      const canRead = ctx.me.can_read_all_group_messages === true || after.status === "administrator";
      if (!canRead) await ctx.api.sendMessage(chat.id, PRIVACY_MODE_WARNING, opts);
    } catch (err) {
      // e.g. added as "restricted" without permission to send messages.
      logger.warn({ err, chatId: chat.id }, "could not post join notice");
    }
  } else if (wasIn && !isIn) {
    await markBotRemoved(chat.id);
    logger.info({ chatId: chat.id }, "bot removed from group");
  }
});
