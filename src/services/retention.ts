import { DateTime } from "luxon";
import { config } from "../config.js";
import { prisma } from "../db.js";

/** Telegram update ids are only needed to drop duplicate deliveries, which arrive within hours. */
const PROCESSED_UPDATE_DAYS = 7;

export type PurgeResult = { messagesWiped: number; updatesPruned: number };

/** Messages sent before this are past the retention limit. */
export function retentionCutoff(now = new Date()): Date {
  return DateTime.fromJSDate(now).minus({ days: config.RAW_MESSAGE_RETENTION_DAYS }).toJSDate();
}

/**
 * Enforce the raw-message retention promise made in /privacy and the join notice.
 *
 * Messages older than RAW_MESSAGE_RETENTION_DAYS lose their text, links, file name and
 * sender. The row itself stays, holding only ids and timestamps, so an item's ↗ link back
 * to Telegram keeps working. Extracted items (title, short summary, due date) are kept
 * while the group uses the bot, as /privacy says.
 */
export async function purgeOldMessages(now = new Date()): Promise<PurgeResult> {
  const cutoff = retentionCutoff(now);

  const { count: messagesWiped } = await prisma.message.updateMany({
    where: {
      sentAt: { lt: cutoff },
      OR: [{ text: { not: null } }, { links: { isEmpty: false } }, { fileName: { not: null } }, { mimeType: { not: null } }, { senderId: { not: null } }],
    },
    // processedAt is set so a wiped message is never sent through extraction again.
    data: { text: null, links: [], fileName: null, mimeType: null, senderId: null, processedAt: now },
  });

  const { count: updatesPruned } = await prisma.processedUpdate.deleteMany({
    where: { processedAt: { lt: DateTime.fromJSDate(now).minus({ days: PROCESSED_UPDATE_DAYS }).toJSDate() } },
  });

  return { messagesWiped, updatesPruned };
}
