import { DateTime } from "luxon";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { Item } from "../generated/prisma/client.js";
import { logger } from "../logger.js";
import { parseSettings } from "../services/groups.js";
import { extractRuleBased, type Extracted, type ExtractionOutcome } from "./extract.js";
import { computeExpiresAt, type LifecycleOptions } from "./lifecycle.js";

/** How far back "same course code + similar title" looks for the item an update refers to (spec §4.2 step 6). */
const UPDATE_LOOKBACK_DAYS = 21;
const ACTIONABLE = ["assignment", "task", "project"] as const;

type DueInfo = { dueAt: Date | null; dueDatePhrase: string | null; dueDateUncertain: boolean };

function lifecycleOptions(group: { timezone: string; settings: unknown }): LifecycleOptions {
  return {
    timezone: group.timezone,
    summaryTime: config.SUMMARY_TIME,
    noDueDateDays: config.NO_DUE_DATE_DAYS,
    noteTipRule: parseSettings(group.settings).noteTipRule,
  };
}

/**
 * Extract items from one stored message (spec §4.2). Safe to call more than once:
 * a message already processed is skipped unless an edit reset processedAt.
 */
export async function processMessage(messageId: number): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { group: true, sources: { include: { item: true } } },
  });
  if (!message || message.deleted || message.processedAt) return;

  const opts = lifecycleOptions(message.group);
  const outcome = extractRuleBased(
    { text: message.text, links: message.links, hasFile: message.hasFile, fileType: message.fileType, fileName: message.fileName },
    message.sentAt,
    message.group.timezone,
  );

  // An edited message that already produced an item: update that item in place.
  const own = message.sources.find((s) => s.kind === "created")?.item;
  if (own) {
    await reapplyAfterEdit(own, outcome, message.id, opts);
  } else {
    await applyOutcome(message, outcome, opts);
  }

  await prisma.message.update({ where: { id: message.id }, data: { processedAt: new Date() } });
}

async function applyOutcome(
  message: { id: number; groupId: number; sentAt: Date; replyToMessageId: number | null },
  outcome: ExtractionOutcome,
  opts: LifecycleOptions,
) {
  if (outcome.kind === "ignored") return;

  const due: DueInfo = outcome.kind === "item" ? outcome.item : outcome;
  const courseCode = outcome.kind === "item" ? outcome.item.courseCode : outcome.courseCode;
  const isUpdate = outcome.kind === "update-only" || outcome.item.looksLikeUpdate;

  const target = await findItemToUpdate(message, { courseCode, isUpdate, extracted: outcome.kind === "item" ? outcome.item : null });

  // A reply or follow-up that changes an earlier item's date, or gives it one it lacked.
  if (target && due.dueAt && (isUpdate || !target.dueAt)) {
    await updateDueDate(target, due, { messageId: message.id, changedBy: "rule" }, opts);
    return;
  }
  if (outcome.kind === "item") await createItem(message, outcome.item, opts);
}

async function findItemToUpdate(
  message: { groupId: number; sentAt: Date; replyToMessageId: number | null },
  hint: { courseCode: string | null; isUpdate: boolean; extracted: Extracted | null },
): Promise<Item | null> {
  // 1. A reply to the message an item came from.
  if (message.replyToMessageId) {
    const parent = await prisma.message.findUnique({
      where: { groupId_telegramMessageId: { groupId: message.groupId, telegramMessageId: message.replyToMessageId } },
      include: { sources: { include: { item: true }, orderBy: { createdAt: "asc" } } },
    });
    const item = parent?.sources.map((s) => s.item).find((i) => i.status === "active");
    if (item) return item;
  }

  // 2. "CSC 411 deadline extended to Monday": the latest matching item with that course code.
  if (!hint.isUpdate || !hint.courseCode) return null;
  const since = DateTime.fromJSDate(message.sentAt).minus({ days: UPDATE_LOOKBACK_DAYS }).toJSDate();
  const candidates = await prisma.item.findMany({
    where: {
      groupId: message.groupId,
      status: "active",
      courseCode: hint.courseCode,
      type: { in: [...ACTIONABLE] },
      createdAt: { gte: since, lte: message.sentAt },
    },
    orderBy: { createdAt: "desc" },
  });
  if (candidates.length === 0) return null;
  const e = hint.extracted;
  return (
    (e && candidates.find((c) => c.type === e.type && c.title === e.title)) ??
    (e && candidates.find((c) => c.type === e.type)) ??
    candidates[0]!
  );
}

async function createItem(message: { id: number; groupId: number; sentAt: Date }, e: Extracted, opts: LifecycleOptions) {
  const expiresAt = computeExpiresAt({ type: e.type, dueAt: e.dueAt, postedAt: message.sentAt }, opts);
  const item = await prisma.item.create({
    data: {
      groupId: message.groupId,
      type: e.type,
      title: e.title,
      courseCode: e.courseCode,
      summary: e.summary,
      dueAt: e.dueAt,
      dueDateUncertain: e.dueDateUncertain,
      dueSource: e.dueAt ? "rule" : null,
      firstMessageId: message.id,
      // Lifecycle counts from when the message was posted, not when it was processed.
      createdAt: message.sentAt,
      expiresAt,
      status: expiresAt > new Date() ? "active" : "expired",
      sources: { create: { messageId: message.id, kind: "created" } },
    },
  });
  logger.info({ itemId: item.id, type: item.type, title: item.title, dueAt: item.dueAt }, "item created");
}

async function updateDueDate(
  item: Item,
  due: DueInfo,
  by: { messageId: number; changedBy: string },
  opts: LifecycleOptions,
) {
  await prisma.itemSource.upsert({
    where: { itemId_messageId: { itemId: item.id, messageId: by.messageId } },
    create: { itemId: item.id, messageId: by.messageId, kind: "updated" },
    update: {},
  });

  // A date set by an admin or class rep always wins (spec §4.3).
  if (item.dueSource === "manual") {
    logger.info({ itemId: item.id }, "due date update ignored: set manually");
    return;
  }
  if (item.dueAt?.getTime() === due.dueAt?.getTime() && item.dueDateUncertain === due.dueDateUncertain) return;

  const expiresAt = computeExpiresAt({ type: item.type, dueAt: due.dueAt, postedAt: item.createdAt }, opts);
  await prisma.$transaction([
    prisma.item.update({
      where: { id: item.id },
      data: {
        dueAt: due.dueAt,
        dueDateUncertain: due.dueDateUncertain,
        dueSource: due.dueAt ? "rule" : null,
        expiresAt,
        status: expiresAt > new Date() ? "active" : "expired",
      },
    }),
    prisma.itemChange.create({
      data: {
        itemId: item.id,
        field: "dueAt",
        oldValue: item.dueAt?.toISOString() ?? null,
        newValue: due.dueAt?.toISOString() ?? null,
        changedBy: by.changedBy,
      },
    }),
  ]);
  logger.info({ itemId: item.id, from: item.dueAt, to: due.dueAt }, "item due date updated");
}

async function reapplyAfterEdit(item: Item, outcome: ExtractionOutcome, messageId: number, opts: LifecycleOptions) {
  if (item.status === "removed") return; // removed by an admin/class rep: never comes back

  if (outcome.kind === "ignored") {
    await prisma.$transaction([
      prisma.item.update({ where: { id: item.id }, data: { status: "removed" } }),
      prisma.itemChange.create({
        data: { itemId: item.id, field: "status", oldValue: item.status, newValue: "removed", changedBy: "rule:edited" },
      }),
    ]);
    logger.info({ itemId: item.id }, "item removed: source message edited into non-academic text");
    return;
  }

  if (outcome.kind === "update-only") {
    await updateDueDate(item, outcome, { messageId, changedBy: "rule:edited" }, opts);
    return;
  }

  const e = outcome.item;
  const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];
  if (e.title !== item.title) changes.push({ field: "title", oldValue: item.title, newValue: e.title });
  if (e.type !== item.type) changes.push({ field: "type", oldValue: item.type, newValue: e.type });

  const keepManualDue = item.dueSource === "manual";
  const dueAt = keepManualDue ? item.dueAt : e.dueAt;
  if (!keepManualDue && item.dueAt?.getTime() !== e.dueAt?.getTime()) {
    changes.push({ field: "dueAt", oldValue: item.dueAt?.toISOString() ?? null, newValue: e.dueAt?.toISOString() ?? null });
  }
  const expiresAt = computeExpiresAt({ type: e.type, dueAt, postedAt: item.createdAt }, opts);

  await prisma.$transaction([
    prisma.item.update({
      where: { id: item.id },
      data: {
        type: e.type,
        title: e.title,
        courseCode: e.courseCode,
        summary: e.summary,
        ...(keepManualDue
          ? {}
          : { dueAt: e.dueAt, dueDateUncertain: e.dueDateUncertain, dueSource: e.dueAt ? "rule" : null }),
        expiresAt,
        status: expiresAt > new Date() ? "active" : "expired",
      },
    }),
    ...changes.map((c) => prisma.itemChange.create({ data: { itemId: item.id, ...c, changedBy: "rule:edited" } })),
  ]);
  if (changes.length) logger.info({ itemId: item.id, changes: changes.map((c) => c.field) }, "item updated after edit");
}

/** Process anything left unprocessed, e.g. messages that arrived while extraction was failing. */
export async function processPending(limit = 500): Promise<number> {
  const pending = await prisma.message.findMany({
    where: { processedAt: null, deleted: false },
    orderBy: { sentAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const { id } of pending) {
    try {
      await processMessage(id);
    } catch (err) {
      logger.error({ err, messageId: id }, "processing failed; will retry next run");
    }
  }
  return pending.length;
}

/** Mark items whose time has passed (spec §4.4). */
export async function expireItems(now = new Date()): Promise<number> {
  const { count } = await prisma.item.updateMany({
    where: { status: "active", expiresAt: { lte: now } },
    data: { status: "expired" },
  });
  return count;
}
