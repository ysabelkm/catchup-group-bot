import { DateTime } from "luxon";
import { GrammyError, type Api } from "grammy";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { isInGroup } from "../lib/membership.js";
import { renderPersonal, type GroupBlock } from "./personal.js";

/**
 * Daily summary by DM for users who opted in (spec §4.5, decided 9 Nov 2026).
 * Uses the exact content each group just received, filtered to groups the user is in.
 */
export async function sendDmSummaries(api: Api, sentToday: GroupBlock[], now: Date): Promise<number> {
  if (sentToday.length === 0) return 0;
  const summaryDate = DateTime.fromJSDate(now, { zone: config.DEFAULT_TIMEZONE }).toISODate()!;
  const users = await prisma.user.findMany({ where: { dmOptIn: true, dmSummaries: true } });
  const membership = new Map<string, boolean>();
  let sent = 0;

  for (const user of users) {
    const blocks: GroupBlock[] = [];
    for (const b of sentToday) {
      if (await isInGroup(api, b.group.telegramChatId, Number(user.telegramUserId), membership)) blocks.push(b);
    }
    if (blocks.length === 0) continue;

    // Claim the day first so a retry or overlapping run can't DM twice.
    try {
      await prisma.dmSummaryLog.create({ data: { userId: user.id, summaryDate } });
    } catch {
      continue; // already sent today
    }

    const day = DateTime.fromJSDate(now, { zone: config.DEFAULT_TIMEZONE }).toFormat("ccc d LLL");
    const chunks = renderPersonal(`📚 <b>Your daily summary — ${day}</b>`, blocks, now);
    try {
      for (const text of chunks) {
        await api.sendMessage(Number(user.telegramUserId), text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      }
      sent++;
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 403) {
        // Blocked the bot or deleted their account: stop trying (spec §5.4).
        await prisma.user.update({ where: { id: user.id }, data: { dmOptIn: false, dmSummaries: false } });
        logger.info({ userId: user.id }, "user blocked the bot; DM summaries turned off");
      } else {
        // Let a later run try again.
        await prisma.dmSummaryLog.deleteMany({ where: { userId: user.id, summaryDate } });
        logger.error({ err, userId: user.id }, "DM summary failed");
      }
    }
  }
  if (sent) logger.info({ sent }, "DM summaries sent");
  return sent;
}
