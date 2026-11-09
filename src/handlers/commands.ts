import { Composer } from "grammy";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { escapeHtml } from "../lib/html.js";
import { botCanReadMessages, isGroupAdmin } from "../lib/permissions.js";
import { topicThreadId } from "../lib/telegram.js";
import { PRIVACY, PRIVACY_MODE_WARNING, WELCOME } from "../lib/texts.js";
import { isGroupChat, parseSettings, upsertGroup } from "../services/groups.js";
import { upsertUser } from "../services/users.js";
import { activeItems, formatItemLine } from "../services/items.js";

export const commands = new Composer();

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

// --- /start (private chat) -------------------------------------------------------------
commands.chatType("private").command("start", async (ctx) => {
  await upsertUser(ctx.from, { dmOptIn: true });
  await ctx.reply(WELCOME, html);
});

commands.chatType(["group", "supergroup"]).command("start", async (ctx) => {
  await ctx.reply("I'm here 👋 An admin can send /setup to turn on daily summaries. Send /privacy to see what I store.", {
    reply_parameters: { message_id: ctx.msg.message_id },
  });
});

// --- /privacy (anywhere) ---------------------------------------------------------------
commands.command("privacy", async (ctx) => {
  await ctx.reply(PRIVACY, html);
});

// --- /setup (group admins) -------------------------------------------------------------
commands.chatType(["group", "supergroup"]).command("setup", async (ctx) => {
  if (!isGroupChat(ctx.chat)) return;
  if (!(await isGroupAdmin(ctx))) {
    await ctx.reply("Only group admins can run /setup.", { reply_parameters: { message_id: ctx.msg.message_id } });
    return;
  }

  const group = await upsertGroup(ctx.chat);
  // The summary goes to the topic /setup was sent from; General (null) otherwise.
  const threadId = group.isForum ? topicThreadId(ctx.msg) : null;
  const updated = await prisma.group.update({
    where: { id: group.id },
    data: { enabled: true, summaryTopicId: threadId },
  });
  const settings = parseSettings(updated.settings);

  let topicLabel = "this chat";
  if (updated.isForum) {
    if (threadId == null) topicLabel = "the <b>General</b> topic";
    else {
      const topic = await prisma.topic.findUnique({ where: { groupId_threadId: { groupId: group.id, threadId } } });
      topicLabel = topic && !topic.name.startsWith("Topic ") ? `the <b>${escapeHtml(topic.name)}</b> topic` : "this topic";
    }
  }

  const lines = [
    `✅ <b>CatchUp is on for ${escapeHtml(updated.title)}.</b>`,
    "",
    `• Daily summary: <b>${config.SUMMARY_TIME}</b> (${escapeHtml(updated.timezone)}), posted in ${topicLabel}.`,
    updated.isForum ? "• I read messages from <b>all topics</b>, not just this one." : null,
    `• Days with nothing new: ${settings.sendWhenEmpty ? 'I\'ll post "No academic updates today ✅"' : "I'll stay quiet"}.`,
    `• Notes and tips: ${settings.noteTipRule === "once" ? "shown once, on the day they're posted" : "shown for 7 days"}.`,
    "",
    updated.isForum ? "To post the summary somewhere else, send /setup again in that topic." : null,
  ].filter((l): l is string => l !== null);

  await ctx.reply(lines.join("\n"), html);

  const access = await botCanReadMessages(ctx);
  if (!access.ok) await ctx.reply(PRIVACY_MODE_WARNING, html);

  logger.info(
    { chatId: ctx.chat.id, summaryTopicId: threadId, canRead: access.ok },
    "group set up",
  );
});

// --- /items (group) ----------------------------------------------------------------------
// Basic group version. The DM version (all your groups, membership-checked) comes with /catchup.
const ITEMS_MAX_CHARS = 3800;

commands.chatType(["group", "supergroup"]).command("items", async (ctx) => {
  const group = await prisma.group.findUnique({ where: { telegramChatId: BigInt(ctx.chat.id) } });
  if (!group) {
    await ctx.reply("I haven't seen any messages here yet.");
    return;
  }
  const now = new Date();
  const items = await activeItems(group.id, now);
  if (items.length === 0) {
    await ctx.reply("No active items right now ✅", { reply_parameters: { message_id: ctx.msg.message_id } });
    return;
  }

  const sections: [string, typeof items][] = [
    ["⏰ <b>Due soon</b>", items.filter((i) => i.dueAt)],
    ["🔄 <b>Ongoing (no due date stated)</b>", items.filter((i) => !i.dueAt && i.type !== "note" && i.type !== "tip")],
    ["📎 <b>Notes &amp; tips</b>", items.filter((i) => i.type === "note" || i.type === "tip")],
  ];

  let out = `📋 <b>Active items — ${escapeHtml(group.title)}</b>`;
  let shown = 0;
  outer: for (const [heading, list] of sections) {
    if (list.length === 0) continue;
    const block = `\n\n${heading}`;
    if (out.length + block.length > ITEMS_MAX_CHARS) break;
    out += block;
    for (const item of list) {
      const line = `\n${formatItemLine(item, group.timezone, now)}`;
      if (out.length + line.length > ITEMS_MAX_CHARS) break outer;
      out += line;
      shown++;
    }
  }
  if (shown < items.length) out += `\n\n…and ${items.length - shown} more.`;

  await ctx.reply(out, { ...html, reply_parameters: { message_id: ctx.msg.message_id } });
});

commands.chatType("private").command("items", async (ctx) => {
  await ctx.reply("For now, send /items inside your class group. A personal version across all your groups is coming.");
});
