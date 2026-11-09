import { GrammyError, type Api } from "grammy";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { escapeHtml } from "../lib/html.js";
import { markBotRemoved, migrateGroup, parseSettings } from "../services/groups.js";
import { buildSummaryContent, summaryDateDue } from "./build.js";
import { allItemIds, renderSummary, type SummaryContent } from "./render.js";
import { sendDmSummaries } from "./dm.js";
import type { GroupBlock } from "./personal.js";

/** A "sending" claim older than this is assumed dead (crash mid-send) and can be retried. */
const STALE_CLAIM_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type SendReport = { sent: number; skipped: number; dms: number; failed: { group: string; error: string }[] };

let inFlight: Promise<SendReport> | null = null;

/**
 * Send today's summary to every enabled group that hasn't had it yet (spec §4.5).
 * Safe to call often: before SUMMARY_TIME it does nothing, and SummaryLog prevents double-sending.
 * Called by the 7 PM job, and opportunistically on incoming updates so a missed run sends late.
 */
export function sendDueSummaries(api: Api, now = new Date()): Promise<SendReport> {
  if (inFlight) return inFlight;
  inFlight = run(api, now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(api: Api, now: Date): Promise<SendReport> {
  const report: SendReport = { sent: 0, skipped: 0, dms: 0, failed: [] };
  const sentToday: GroupBlock[] = [];
  if (config.BOT_PAUSED) return report;

  const groups = await prisma.group.findMany({ where: { enabled: true, botRemovedAt: null }, orderBy: { id: "asc" } });
  for (const group of groups) {
    const date = summaryDateDue(now, group.timezone);
    if (!date) continue;
    const logId = await claim(group.id, date, now);
    if (logId === null) continue;

    try {
      const outcome = await sendOne(api, group.id, now);
      await prisma.summaryLog.update({
        where: { id: logId },
        data: { status: outcome.messageIds.length ? "sent" : "skipped", telegramMessageIds: outcome.messageIds, sentAt: new Date(), error: null },
      });
      if (outcome.messageIds.length) report.sent++;
      else report.skipped++;
      sentToday.push({ group, content: outcome.content });
    } catch (err) {
      const error = describe(err);
      await prisma.summaryLog.update({ where: { id: logId }, data: { status: "failed", error } });
      report.failed.push({ group: group.title, error });
      logger.error({ err, groupId: group.id, date }, "summary failed");
    }
  }

  try {
    report.dms = await sendDmSummaries(api, sentToday, now);
  } catch (err) {
    logger.error({ err }, "DM summaries failed");
  }

  if (report.failed.length) {
    await notifyOwner(
      api,
      `⚠️ <b>CatchUp: ${report.failed.length} summary(ies) failed</b>\n` +
        report.failed.map((f) => `• ${escapeHtml(f.group)}: ${escapeHtml(f.error)}`).join("\n") +
        "\n\nI'll retry automatically on the next activity.",
    );
  }
  if (report.sent || report.failed.length) logger.info(report, "summaries run finished");
  return report;
}

/** Reserve (group, date) so only one run sends it. Returns the SummaryLog id, or null if not ours to send. */
async function claim(groupId: number, summaryDate: string, now: Date): Promise<number | null> {
  try {
    const row = await prisma.summaryLog.create({ data: { groupId, summaryDate, status: "sending" } });
    return row.id;
  } catch (err) {
    if (!(err instanceof Error && "code" in err && (err as { code: string }).code === "P2002")) throw err;
  }
  const existing = await prisma.summaryLog.findUnique({ where: { groupId_summaryDate: { groupId, summaryDate } } });
  if (!existing || existing.status === "sent" || existing.status === "skipped") return null;
  if (existing.attempts >= MAX_ATTEMPTS) return null;
  const retryable = existing.status === "failed" || now.getTime() - existing.createdAt.getTime() > STALE_CLAIM_MS;
  if (!retryable) return null;
  // Conditional update: if another run grabbed it first, attempts no longer matches.
  const { count } = await prisma.summaryLog.updateMany({
    where: { id: existing.id, attempts: existing.attempts },
    data: { status: "sending", attempts: { increment: 1 }, createdAt: now },
  });
  return count === 1 ? existing.id : null;
}

async function sendOne(api: Api, groupId: number, now: Date): Promise<{ messageIds: number[]; content: SummaryContent }> {
  const lastSent = await prisma.summaryLog.findFirst({
    where: { groupId, status: "sent", sentAt: { not: null } },
    orderBy: { sentAt: "desc" },
  });
  const content = await buildSummaryContent(groupId, now, lastSent?.sentAt ?? null);
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
  const chunks = renderSummary(content, { timezone: group.timezone, now, sendWhenEmpty: parseSettings(group.settings).sendWhenEmpty });
  if (chunks.length === 0) return { messageIds: [], content };

  const messageIds: number[] = [];
  for (const text of chunks) messageIds.push(await postToGroup(api, groupId, text));

  // Everything in this summary has now been seen at least once.
  await prisma.item.updateMany({ where: { id: { in: allItemIds(content) }, firstShownAt: null }, data: { firstShownAt: new Date() } });
  logger.info({ groupId, messages: messageIds.length, items: allItemIds(content).length }, "summary sent");
  return { messageIds, content };
}

/** Post into the group's summary topic, coping with deleted topics, migrations and removal. */
export async function postToGroup(api: Api, groupId: number, text: string): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    const threadId = group.isForum && group.summaryTopicId ? group.summaryTopicId : undefined;
    try {
      const sent = await api.sendMessage(Number(group.telegramChatId), text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(threadId ? { message_thread_id: threadId } : {}),
      });
      return sent.message_id;
    } catch (err) {
      if (!(err instanceof GrammyError)) throw err;
      const desc = err.description.toLowerCase();

      if (err.parameters?.migrate_to_chat_id) {
        await migrateGroup(Number(group.telegramChatId), err.parameters.migrate_to_chat_id);
        continue;
      }
      if (threadId && (desc.includes("thread not found") || desc.includes("topic_closed") || desc.includes("topic_deleted"))) {
        // The chosen topic is gone or closed: fall back to General and remember that.
        logger.warn({ groupId, threadId, desc }, "summary topic unusable; falling back to General");
        await prisma.group.update({ where: { id: groupId }, data: { summaryTopicId: null } });
        continue;
      }
      if (err.error_code === 403 || desc.includes("chat not found") || desc.includes("bot was kicked")) {
        await markBotRemoved(Number(group.telegramChatId));
      }
      throw err;
    }
  }
  throw new Error("could not post summary after 3 attempts");
}

function describe(err: unknown): string {
  if (err instanceof GrammyError) return `Telegram ${err.error_code}: ${err.description}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Tell the bot owner on Telegram (spec §4.5 decision, §8 alerts). Never throws. */
export async function notifyOwner(api: Api, html: string) {
  if (!config.BOT_OWNER_TELEGRAM_ID) return;
  try {
    await api.sendMessage(config.BOT_OWNER_TELEGRAM_ID, html, { parse_mode: "HTML" });
  } catch (err) {
    logger.warn({ err }, "could not alert the owner (have they pressed Start?)");
  }
}
