import { DateTime } from "luxon";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { messageLink } from "../lib/links.js";
import { parseSettings } from "../services/groups.js";
import type { ItemView } from "../services/items.js";
import type { SummaryContent } from "./render.js";

/** Unshown notes/tips older than this are dropped rather than dumped into a summary. */
const FRESH_MAX_AGE_DAYS = 7;

const itemInclude = {
  sources: {
    where: { kind: "created" },
    take: 1,
    include: { message: { include: { topic: true } } },
  },
} as const;

/**
 * Collect what goes into a group's summary right now (spec §4.4, §4.5).
 * `lastSentAt` is when the previous summary actually went out (null = first summary).
 */
export async function buildSummaryContent(groupId: number, now: Date, lastSentAt: Date | null): Promise<SummaryContent> {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
  const settings = parseSettings(group.settings);
  const tz = group.timezone;
  const startOfToday = DateTime.fromJSDate(now, { zone: tz }).startOf("day").toJSDate();

  const toView = (i: Awaited<ReturnType<typeof fetchItems>>[number]): ItemView => {
    const m = i.sources[0]?.message;
    return {
      id: i.id,
      type: i.type,
      title: i.title,
      dueAt: i.dueAt,
      dueDateUncertain: i.dueDateUncertain,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      link: m ? messageLink(group.telegramChatId, m.telegramMessageId, m.topic?.threadId) : null,
      topicName: group.isForum ? (m?.topic?.name ?? "General") : null,
    };
  };
  const fetchItems = (where: Prisma.ItemWhereInput) =>
    prisma.item.findMany({ where: { groupId, ...where }, include: itemInclude, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] });

  const actionable: Prisma.EnumItemTypeFilter = { in: ["assignment", "task", "project"] };
  const notesTips: Prisma.EnumItemTypeFilter = { in: ["note", "tip"] };

  // Deadlines that fell on days with no summary: due after the last summary's day, before today.
  let missed: ItemView[] = [];
  if (lastSentAt) {
    const afterLastSummaryDay = DateTime.fromJSDate(lastSentAt, { zone: tz }).endOf("day").toJSDate();
    if (afterLastSummaryDay < startOfToday) {
      missed = (await fetchItems({ type: actionable, status: { not: "removed" }, dueAt: { gt: afterLastSummaryDay, lt: startOfToday } })).map(toView);
    }
  }

  const dueSoon = (await fetchItems({ type: actionable, status: "active", dueAt: { gte: startOfToday } })).map(toView);
  const ongoing = (await fetchItems({ type: actionable, status: "active", dueAt: null, expiresAt: { gt: now } })).map(toView);

  // Notes/tips go by "shown yet?", not by a timer, so a missed summary can't lose them.
  const freshSince = DateTime.fromJSDate(now).minus({ days: FRESH_MAX_AGE_DAYS }).toJSDate();
  const fresh = (await fetchItems({ type: notesTips, status: { not: "removed" }, firstShownAt: null, createdAt: { gte: freshSince, lte: now } })).map(toView);

  const recentNotes =
    settings.noteTipRule === "7days"
      ? (await fetchItems({ type: notesTips, status: "active", firstShownAt: { not: null }, expiresAt: { gt: now } })).map(toView)
      : [];

  return { missed, dueSoon, ongoing, fresh, recentNotes };
}

/** The Lagos date whose summary is due at `now`, or null before today's summary time. */
export function summaryDateDue(now: Date, timezone: string, summaryTime = config.SUMMARY_TIME): string | null {
  const [h, m] = summaryTime.split(":").map(Number) as [number, number];
  const local = DateTime.fromJSDate(now, { zone: timezone });
  const todaysTime = local.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  return local >= todaysTime ? local.toISODate() : null;
}
