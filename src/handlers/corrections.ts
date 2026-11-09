import { randomBytes } from "node:crypto";
import { Composer, InlineKeyboard, type Context } from "grammy";
import { DateTime } from "luxon";
import { prisma } from "../db.js";
import { resolveDueDate } from "../extraction/dates.js";
import { isActionable } from "../extraction/lifecycle.js";
import { escapeHtml } from "../lib/html.js";
import { realReplyToId } from "../lib/telegram.js";
import { truncate } from "../extraction/rules.js";
import { activeItems, formatDue } from "../services/items.js";
import { removeItem, setManualDue } from "../services/itemEdits.js";
import { canEdit } from "../services/roles.js";
import type { Group, Item } from "../generated/prisma/client.js";

/**
 * /due and /remove (spec §4.6). Admins and class reps only (decided 9 Nov 2026).
 *   Reply to the item's original message → applies to that item.
 *   Reply to a summary or /items list → buttons to pick which item.
 */
export const corrections = new Composer();
const groupChats = corrections.chatType(["group", "supergroup"]);

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const PICK_TTL_MS = 10 * 60 * 1000;
const MAX_BUTTONS = 20;

type Pending = { action: "due" | "remove"; groupId: number; requesterId: number; dueAt?: Date; expires: number };
const pending = new Map<string, Pending>();

function newToken(p: Pending) {
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  const token = randomBytes(4).toString("hex");
  pending.set(token, p);
  return token;
}

type Target = { kind: "item"; item: Item } | { kind: "list" } | { kind: "none"; why: string };

/** What the command is replying to. */
async function replyTarget(ctx: Context, group: Group): Promise<Target> {
  const msg = ctx.msg!;
  const replyId = realReplyToId(msg);
  if (!replyId || !msg.reply_to_message) return { kind: "none", why: "no reply" };
  if (msg.reply_to_message.from?.id === ctx.me.id) return { kind: "list" };

  const source = await prisma.message.findUnique({
    where: { groupId_telegramMessageId: { groupId: group.id, telegramMessageId: replyId } },
    include: { sources: { include: { item: true }, orderBy: { createdAt: "asc" } } },
  });
  const item = source?.sources.map((s) => s.item).find((i) => i.status !== "removed");
  return item ? { kind: "item", item } : { kind: "none", why: "not an item" };
}

async function loadGroupAndCheck(ctx: Context & { chat: { id: number } }, verb: string): Promise<Group | null> {
  const group = await prisma.group.findUnique({ where: { telegramChatId: BigInt(ctx.chat.id) } });
  if (!group) {
    await ctx.reply("I haven't seen any messages here yet.");
    return null;
  }
  if (!(await canEdit(ctx, group.id))) {
    await ctx.reply(`Only admins and class reps can ${verb}. An admin can add class reps with /editors.`, {
      reply_parameters: { message_id: ctx.msg!.message_id },
    });
    return null;
  }
  return group;
}

function pickKeyboard(token: string, items: { id: number; title: string; dueAt: Date | null }[], tz: string) {
  const kb = new InlineKeyboard();
  for (const i of items.slice(0, MAX_BUTTONS)) {
    const due = i.dueAt ? ` (${DateTime.fromJSDate(i.dueAt, { zone: tz }).toFormat("d LLL")})` : "";
    kb.text(truncate(`${i.title}${due}`, 60), `pick:${token}:${i.id}`).row();
  }
  return kb.text("Cancel", `pick:${token}:x`);
}

// --- /due <date> [time] ---------------------------------------------------------------
const DUE_USAGE =
  "Reply to the assignment's message (or to a summary) with:\n<code>/due 20 Nov</code> or <code>/due 20 Nov 2pm</code>";

groupChats.command("due", async (ctx) => {
  const group = await loadGroupAndCheck(ctx, "change due dates");
  if (!group) return;

  const args = ctx.match.trim();
  if (!args) {
    await ctx.reply(DUE_USAGE, { ...html, reply_parameters: { message_id: ctx.msg.message_id } });
    return;
  }
  const resolved = resolveDueDate(args, new Date(), group.timezone);
  if (!resolved) {
    await ctx.reply(`I couldn't read “${escapeHtml(args)}” as a date.\n${DUE_USAGE}`, { ...html, reply_parameters: { message_id: ctx.msg.message_id } });
    return;
  }

  const target = await replyTarget(ctx, group);
  if (target.kind === "none") {
    const hint = target.why === "not an item" ? "That message isn't one of my items. " : "";
    await ctx.reply(`${hint}${DUE_USAGE}`, { ...html, reply_parameters: { message_id: ctx.msg.message_id } });
    return;
  }

  if (target.kind === "item") {
    await applyDue(ctx, group, target.item.id, resolved.dueAt);
    return;
  }

  const choices = (await activeItems(group.id)).filter((i) => isActionable(i.type as Item["type"]));
  if (choices.length === 0) {
    await ctx.reply("There are no assignments, tasks or projects to set a date on right now.");
    return;
  }
  const token = newToken({ action: "due", groupId: group.id, requesterId: ctx.from.id, dueAt: resolved.dueAt, expires: Date.now() + PICK_TTL_MS });
  await ctx.reply(`Which item is due <b>${formatDue(resolved.dueAt, group.timezone).replace(/^due /, "")}</b>?`, {
    ...html,
    reply_markup: pickKeyboard(token, choices, group.timezone),
    reply_parameters: { message_id: ctx.msg.message_id },
  });
});

async function applyDue(ctx: Context, group: Group, itemId: number, dueAt: Date, edit = false) {
  let text: string;
  try {
    const item = await setManualDue(itemId, dueAt, ctx.from!.id);
    const past = dueAt < new Date() ? " ⚠️ That date has already passed." : "";
    text = `✅ <b>${escapeHtml(item.title)}</b> is now ${formatDue(dueAt, group.timezone)}.${past}`;
  } catch (err) {
    text = `⚠️ ${escapeHtml(err instanceof Error ? err.message : String(err))}`;
  }
  if (edit) await ctx.editMessageText(text, html);
  else await ctx.reply(text, { ...html, reply_parameters: { message_id: ctx.msg!.message_id } });
}

// --- /remove ---------------------------------------------------------------------------
groupChats.command("remove", async (ctx) => {
  const group = await loadGroupAndCheck(ctx, "remove items");
  if (!group) return;

  const target = await replyTarget(ctx, group);
  if (target.kind === "none") {
    const hint = target.why === "not an item" ? "That message isn't one of my items. " : "";
    await ctx.reply(`${hint}Reply to the wrong item's message (or to a summary) with /remove.`, {
      reply_parameters: { message_id: ctx.msg.message_id },
    });
    return;
  }
  if (target.kind === "item") {
    await removeItem(target.item.id, ctx.from.id);
    await ctx.reply(`🗑 Removed <b>${escapeHtml(target.item.title)}</b>. It won't show in summaries again.`, {
      ...html,
      reply_parameters: { message_id: ctx.msg.message_id },
    });
    return;
  }

  const choices = await activeItems(group.id);
  if (choices.length === 0) {
    await ctx.reply("There's nothing active to remove.");
    return;
  }
  const token = newToken({ action: "remove", groupId: group.id, requesterId: ctx.from.id, expires: Date.now() + PICK_TTL_MS });
  await ctx.reply("Which item should I remove?", {
    reply_markup: pickKeyboard(token, choices, group.timezone),
    reply_parameters: { message_id: ctx.msg.message_id },
  });
});

// --- Button presses for both ----------------------------------------------------------
corrections.callbackQuery(/^pick:([0-9a-f]+):(\d+|x)$/, async (ctx) => {
  const [, token, choice] = ctx.match;
  const p = pending.get(token!);
  if (!p || p.expires < Date.now()) {
    await ctx.answerCallbackQuery({ text: "This menu has expired. Send the command again." });
    return;
  }
  if (ctx.from.id !== p.requesterId) {
    await ctx.answerCallbackQuery({ text: "Only the person who sent the command can choose." });
    return;
  }
  pending.delete(token!);
  await ctx.answerCallbackQuery();
  if (choice === "x") {
    await ctx.editMessageText("Cancelled.");
    return;
  }

  const item = await prisma.item.findUnique({ where: { id: Number(choice) }, include: { group: true } });
  if (!item || item.groupId !== p.groupId) {
    await ctx.editMessageText("That item no longer exists.");
    return;
  }
  if (p.action === "due" && p.dueAt) {
    await applyDue(ctx, item.group, item.id, p.dueAt, true);
  } else {
    await removeItem(item.id, ctx.from.id);
    await ctx.editMessageText(`🗑 Removed <b>${escapeHtml(item.title)}</b>. It won't show in summaries again.`, html);
  }
});
