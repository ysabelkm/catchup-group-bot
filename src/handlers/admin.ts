import { Composer, InlineKeyboard, type Context } from "grammy";
import type { MessageEntity, User as TgUser } from "grammy/types";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { escapeHtml } from "../lib/html.js";
import { isGroupAdmin } from "../lib/permissions.js";
import { GROUP_ANONYMOUS_BOT_ID, realReplyToId } from "../lib/telegram.js";
import { parseSettings, type GroupSettings } from "../services/groups.js";
import { upsertUser } from "../services/users.js";
import type { Group } from "../generated/prisma/client.js";

/** /settings and /editors (spec §4.6). Group admins only. */
export const admin = new Composer();
const groupChats = admin.chatType(["group", "supergroup"]);
const html = { parse_mode: "HTML" as const };

async function adminGroup(ctx: Context & { chat: { id: number } }): Promise<Group | null> {
  if (!(await isGroupAdmin(ctx))) {
    await ctx.reply("Only group admins can do that.", { reply_parameters: { message_id: ctx.msg!.message_id } });
    return null;
  }
  const group = await prisma.group.findUnique({ where: { telegramChatId: BigInt(ctx.chat.id) } });
  if (!group) await ctx.reply("Send /setup first to turn me on in this group.");
  return group;
}

// --- /settings -------------------------------------------------------------------------
async function settingsView(group: Group) {
  const s = parseSettings(group.settings);
  let topic = "this chat";
  if (group.isForum) {
    if (group.summaryTopicId == null) topic = "the General topic";
    else {
      const t = await prisma.topic.findUnique({ where: { groupId_threadId: { groupId: group.id, threadId: group.summaryTopicId } } });
      topic = t && !t.name.startsWith("Topic ") ? `the “${escapeHtml(t.name)}” topic` : "the topic chosen at /setup";
    }
  }
  const text = [
    `⚙️ <b>CatchUp settings — ${escapeHtml(group.title)}</b>`,
    "",
    `Daily summary at <b>${config.SUMMARY_TIME}</b> (${escapeHtml(group.timezone)}), posted in ${topic}.`,
    group.isForum ? "To post it in another topic, send /setup in that topic." : null,
    "",
    "Tap to change:",
  ]
    .filter((l) => l !== null)
    .join("\n");
  const kb = new InlineKeyboard()
    .text(group.enabled ? "📚 Daily summary: ON" : "📚 Daily summary: OFF", `set:${group.id}:enabled`)
    .row()
    .text(s.sendWhenEmpty ? "📭 Empty days: post “No updates”" : "📭 Empty days: stay quiet", `set:${group.id}:sendWhenEmpty`)
    .row()
    .text(s.noteTipRule === "once" ? "📝 Notes & tips: show once" : "📝 Notes & tips: show 7 days", `set:${group.id}:noteTipRule`);
  return { text, kb };
}

groupChats.command("settings", async (ctx) => {
  const group = await adminGroup(ctx);
  if (!group) return;
  const { text, kb } = await settingsView(group);
  await ctx.reply(text, { ...html, reply_markup: kb });
});

admin.callbackQuery(/^set:(\d+):(enabled|sendWhenEmpty|noteTipRule)$/, async (ctx) => {
  const [, groupIdRaw, field] = ctx.match;
  const group = await prisma.group.findUnique({ where: { id: Number(groupIdRaw) } });
  if (!group || BigInt(ctx.chat?.id ?? 0) !== group.telegramChatId) {
    await ctx.answerCallbackQuery({ text: "This menu is out of date." });
    return;
  }
  if (!(await isGroupAdmin(ctx))) {
    await ctx.answerCallbackQuery({ text: "Only group admins can change settings." });
    return;
  }

  let updated: Group;
  if (field === "enabled") {
    updated = await prisma.group.update({ where: { id: group.id }, data: { enabled: !group.enabled } });
  } else {
    const s: GroupSettings = parseSettings(group.settings);
    if (field === "sendWhenEmpty") s.sendWhenEmpty = !s.sendWhenEmpty;
    else s.noteTipRule = s.noteTipRule === "once" ? "7days" : "once";
    updated = await prisma.group.update({ where: { id: group.id }, data: { settings: s } });
  }
  await ctx.answerCallbackQuery({ text: "Saved ✅" });
  const { text, kb } = await settingsView(updated);
  await ctx.editMessageText(text, { ...html, reply_markup: kb });
});

// --- /editors --------------------------------------------------------------------------
const EDITORS_USAGE = [
  "<b>Class reps</b> can correct due dates (/due) and remove wrong items (/remove).",
  "",
  "• <code>/editors</code> — list class reps",
  "• Reply to someone's message with <code>/editors add</code> or <code>/editors remove</code>",
].join("\n");

/** The person an /editors command is about: the replied-to sender, or a mentioned user without a username. */
function targetUser(ctx: Context): TgUser | null {
  const msg = ctx.msg!;
  const reply = msg.reply_to_message;
  // realReplyToId ignores the implicit "reply" to a forum topic's first message.
  if (realReplyToId(msg) && reply?.from && !reply.from.is_bot && reply.from.id !== GROUP_ANONYMOUS_BOT_ID) return reply.from;
  const mention = msg.entities?.find((e): e is MessageEntity.TextMentionMessageEntity => e.type === "text_mention");
  return mention?.user ?? null;
}

groupChats.command("editors", async (ctx) => {
  const group = await adminGroup(ctx);
  if (!group) return;
  const action = ctx.match.trim().toLowerCase();

  if (action === "add" || action === "remove") {
    const who = targetUser(ctx);
    if (!who) {
      await ctx.reply(`Reply to a message from the person you want to ${action}.\n\n${EDITORS_USAGE}`, html);
      return;
    }
    const user = await upsertUser(who);
    await prisma.groupMember.upsert({
      where: { userId_groupId: { userId: user.id, groupId: group.id } },
      create: { userId: user.id, groupId: group.id, role: action === "add" ? "editor" : "member" },
      update: { role: action === "add" ? "editor" : "member" },
    });
    await ctx.reply(
      action === "add"
        ? `✅ ${escapeHtml(who.first_name)} is now a class rep and can use /due and /remove.`
        : `${escapeHtml(who.first_name)} is no longer a class rep.`,
      { ...html, reply_parameters: { message_id: ctx.msg.message_id } },
    );
    return;
  }

  const editors = await prisma.groupMember.findMany({ where: { groupId: group.id, role: "editor" }, include: { user: true } });
  const list = editors.length ? editors.map((e) => `• ${escapeHtml(e.user.firstName)}`).join("\n") : "No class reps yet.";
  await ctx.reply(`${list}\n\nGroup admins can always use /due and /remove.\n\n${EDITORS_USAGE}`, html);
});
