import { Composer, InlineKeyboard, type Context } from "grammy";
import { DateTime } from "luxon";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { groupsForUser } from "../lib/membership.js";
import { WELCOME } from "../lib/texts.js";
import { upsertUser } from "../services/users.js";
import { buildSummaryContent } from "../summary/build.js";
import { catchupContent, renderPersonal, type GroupBlock } from "../summary/personal.js";

/** Private-chat features: /start + DM opt-in, /catchup, /items, /summary, /settings (spec §4.5, §4.6). */
export const personal = new Composer();
const dm = personal.chatType("private");
const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

/** No catch-up window yet: look back this far on a first /catchup. */
const FIRST_CATCHUP_DAYS = 7;
const COOLDOWN_MS = 60 * 1000;
const lastUse = new Map<string, number>();

function rateLimited(key: string): boolean {
  const last = lastUse.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return true;
  lastUse.set(key, Date.now());
  return false;
}

function dmToggle(on: boolean) {
  return new InlineKeyboard().text(on ? "🔔 Daily summary by DM: ON (tap to turn off)" : "🔕 Daily summary by DM: OFF (tap to turn on)", "dm:toggle");
}

const NOT_IN_GROUPS =
  "I couldn't find you in any class group that uses CatchUp yet.\n\nAsk your group admin to add me and send /setup there.";

// --- /start and /settings: DM opt-in -----------------------------------------------------
dm.command("start", async (ctx) => {
  const user = await upsertUser(ctx.from, { dmOptIn: true });
  await ctx.reply(WELCOME, { ...html, reply_markup: dmToggle(user.dmSummaries) });
});

dm.command("settings", async (ctx) => {
  const user = await upsertUser(ctx.from, { dmOptIn: true });
  await ctx.reply(
    `⚙️ <b>Your settings</b>\n\nTurn this on to also get each evening's summary here at <b>${config.SUMMARY_TIME}</b>, for all your class groups that use CatchUp.`,
    { ...html, reply_markup: dmToggle(user.dmSummaries) },
  );
});

personal.callbackQuery("dm:toggle", async (ctx) => {
  const current = await upsertUser(ctx.from, { dmOptIn: true });
  const user = await prisma.user.update({ where: { id: current.id }, data: { dmSummaries: !current.dmSummaries } });
  await ctx.answerCallbackQuery({
    text: user.dmSummaries ? `On ✅ You'll get the summary here at ${config.SUMMARY_TIME}.` : "Off. You'll only see it in the group.",
  });
  await ctx.editMessageReplyMarkup({ reply_markup: dmToggle(user.dmSummaries) });
});

// --- /catchup: everything since your last /catchup ---------------------------------------
dm.command("catchup", async (ctx) => {
  if (rateLimited(`catchup:${ctx.from.id}`)) {
    await ctx.reply("You just caught up 🙂 Try again in a minute.");
    return;
  }
  await ctx.replyWithChatAction("typing");
  const user = await upsertUser(ctx.from, { dmOptIn: true });
  const groups = await groupsForUser(ctx.api, ctx.from.id);
  if (groups.length === 0) {
    await ctx.reply(NOT_IN_GROUPS);
    return;
  }

  const now = new Date();
  const since = user.lastCatchupAt ?? DateTime.fromJSDate(now).minus({ days: FIRST_CATCHUP_DAYS }).toJSDate();
  const blocks: GroupBlock[] = [];
  for (const group of groups) blocks.push({ group, content: await catchupContent(group, now, since) });

  const sinceText = DateTime.fromJSDate(since, { zone: config.DEFAULT_TIMEZONE }).toFormat("ccc d LLL, h:mm a");
  const header = `🧭 <b>Your catch-up</b> — since ${user.lastCatchupAt ? sinceText : `the last ${FIRST_CATCHUP_DAYS} days`}`;
  await sendChunks(ctx, renderPersonal(header, blocks, now, "Nothing new ✅"));
  await prisma.user.update({ where: { id: user.id }, data: { lastCatchupAt: now } });
});

// --- /items and /summary in DM: across all your groups -------------------------------------
dm.command("items", async (ctx) => {
  if (rateLimited(`items:${ctx.from.id}`)) {
    await ctx.reply("Just sent that 🙂 Try again in a minute.");
    return;
  }
  await upsertUser(ctx.from, { dmOptIn: true });
  const groups = await groupsForUser(ctx.api, ctx.from.id);
  if (groups.length === 0) {
    await ctx.reply(NOT_IN_GROUPS);
    return;
  }
  const now = new Date();
  const blocks: GroupBlock[] = [];
  for (const group of groups) blocks.push({ group, content: await catchupContent(group, now, null) });
  await sendChunks(ctx, renderPersonal("📋 <b>Your active items</b>", blocks, now, "Nothing active ✅"));
});

dm.command("summary", async (ctx) => {
  if (rateLimited(`summary:${ctx.from.id}`)) {
    await ctx.reply("Just sent that 🙂 Try again in a minute.");
    return;
  }
  await upsertUser(ctx.from, { dmOptIn: true });
  const groups = await groupsForUser(ctx.api, ctx.from.id);
  if (groups.length === 0) {
    await ctx.reply(NOT_IN_GROUPS);
    return;
  }
  const now = new Date();
  const blocks: GroupBlock[] = [];
  for (const group of groups) {
    const lastSent = await prisma.summaryLog.findFirst({ where: { groupId: group.id, status: "sent", sentAt: { not: null } }, orderBy: { sentAt: "desc" } });
    blocks.push({ group, content: await buildSummaryContent(group.id, now, lastSent?.sentAt ?? null) });
  }
  const day = DateTime.fromJSDate(now, { zone: config.DEFAULT_TIMEZONE }).toFormat("ccc d LLL");
  await sendChunks(ctx, renderPersonal(`📚 <b>Summary so far — ${day}</b>`, blocks, now));
});

async function sendChunks(ctx: Context, chunks: string[]) {
  for (const text of chunks) await ctx.reply(text, html);
}
