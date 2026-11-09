import { DateTime } from "luxon";
import type { ItemType } from "./rules.js";

/**
 * When an item stops showing in the daily summary (spec §4.4, §5.3).
 *
 *   assignment/task/project with a due date → end of the due day (it shows as "due today"
 *                                              on that day, and is gone the next day)
 *   assignment/task/project without one     → end of the day, NO_DUE_DATE_DAYS after posting
 *                                              (posted Thu 5 Nov → shows until Thu 12 Nov)
 *   note/tip, rule "once"                   → right after the first summary that follows the post
 *   note/tip, rule "7days"                  → same as an undated assignment
 *
 * "Once" is tied to the summary rather than the calendar day: a note posted at 9 PM, after
 * that day's 7 PM summary, still appears once, in the next evening's summary.
 */
export type LifecycleOptions = {
  timezone: string;
  /** HH:MM local time of the daily summary. */
  summaryTime: string;
  noDueDateDays: number;
  noteTipRule: "once" | "7days";
};

/** How long after the summary time a "once" item is still included (covers a late-running summary). */
const ONCE_GRACE_HOURS = 6;

export function isActionable(type: ItemType) {
  return type === "assignment" || type === "task" || type === "project";
}

/** The first summary moment at or after `at`, in the group's timezone. */
export function nextSummaryAt(at: Date, opts: Pick<LifecycleOptions, "timezone" | "summaryTime">): DateTime {
  const [h, m] = opts.summaryTime.split(":").map(Number) as [number, number];
  const local = DateTime.fromJSDate(at, { zone: opts.timezone });
  const today = local.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  return local <= today ? today : today.plus({ days: 1 });
}

export function computeExpiresAt(
  item: { type: ItemType; dueAt: Date | null; postedAt: Date },
  opts: LifecycleOptions,
): Date {
  const posted = DateTime.fromJSDate(item.postedAt, { zone: opts.timezone });

  if (isActionable(item.type)) {
    if (item.dueAt) return DateTime.fromJSDate(item.dueAt, { zone: opts.timezone }).endOf("day").toJSDate();
    return posted.plus({ days: opts.noDueDateDays }).endOf("day").toJSDate();
  }

  if (opts.noteTipRule === "7days") return posted.plus({ days: opts.noDueDateDays }).endOf("day").toJSDate();
  return nextSummaryAt(item.postedAt, opts).plus({ hours: ONCE_GRACE_HOURS }).toJSDate();
}
