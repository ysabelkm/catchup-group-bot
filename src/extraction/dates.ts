import * as chrono from "chrono-node";
import { DateTime } from "luxon";

/**
 * Deterministic due-date resolution (spec §4.2 step 5, §4.3).
 *
 * - Relative dates resolve against when the message was SENT, in the group's timezone.
 * - Day-first numeric dates (14/11 = 14 November), as written in Nigeria.
 * - A date without a time means the end of that day (23:59 local).
 * - Several dates: the latest one near a submission cue ("due", "submit", "by"…) wins.
 * - Vague phrases ("soon", "next week") give no date.
 */

export type DueResolution = {
  dueAt: Date;
  /** The words that produced the date, as written in the message. */
  phrase: string;
  hasTime: boolean;
  uncertain: boolean;
};

const WEEKDAY_INDEX: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
const WEEKDAY = "(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday|rsday)?";
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";

/** Words just before a date that mark it as a deadline rather than e.g. a class or test date. */
const DUE_CUE = /\b(due|submit\w*|deadline|by|before|latest|not later than|on or before|closes?|extended|moved|postponed|shifted|now|till|until)\b[^.!?\n]{0,25}$/i;

/** chrono matches that are too vague to be a deadline. */
const VAGUE = /^(the|this|next|end of the) week$|^the week$/i;

type Replacement = { start: number; end: number; original: string; replacement: string };

/**
 * Rewrite phrases chrono gets wrong into ones it gets right, remembering the original words:
 *   "next tomorrow" (Nigerian English/Pidgin) → the day after tomorrow
 *   "next week Tuesday" / "Tuesday next week" → an explicit date in the following week
 */
function normalise(text: string, ref: DateTime): { text: string; replacements: Replacement[] } {
  const patterns: { re: RegExp; to: (m: RegExpExecArray) => string }[] = [
    { re: /\bnext\s+tomorrow\b/gi, to: () => "the day after tomorrow" },
    { re: /(?<!the\s)\bday\s+after\s+tomorrow\b/gi, to: () => "the day after tomorrow" },
    { re: new RegExp(`\\bnext\\s+week\\s+${WEEKDAY}\\b`, "gi"), to: (m) => weekdayNextWeek(m[1]!, ref) },
    { re: new RegExp(`\\b${WEEKDAY}\\s+(?:of\\s+)?next\\s+week\\b`, "gi"), to: (m) => weekdayNextWeek(m[1]!, ref) },
    // "by the 15th", "on or before 3rd" with no month: the next such day.
    // Only straight after a deadline word, so "the 2nd assignment" stays an ordinal.
    {
      re: new RegExp(
        `(?<=\\b(?:by|on|before|due|deadline|till|until|latest|is)\\s+)(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\b(?!\\s+(?:of\\s+)?${MONTH})(?!\\s+(?:assignment|year|level|semester|chapter|week|question|class|lecture|test|quiz|group|edition))`,
        "gi",
      ),
      to: (m) => nextDayOfMonth(Number(m[1]), ref) ?? m[0],
    },
  ];

  // Collect non-overlapping matches against the original text, then rebuild it once.
  const found: Replacement[] = [];
  for (const { re, to } of patterns) {
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index;
      const end = start + m[0].length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      found.push({ start, end, original: m[0], replacement: to(m) });
    }
  }
  found.sort((a, b) => a.start - b.start);

  let out = "";
  let cursor = 0;
  const shifted: Replacement[] = [];
  for (const f of found) {
    out += text.slice(cursor, f.start);
    shifted.push({ ...f, start: out.length, end: out.length + f.replacement.length });
    out += f.replacement;
    cursor = f.end;
  }
  out += text.slice(cursor);
  return { text: out, replacements: shifted };
}

/** The next date (today or later) falling on this day of the month. */
function nextDayOfMonth(day: number, ref: DateTime): string | null {
  if (day < 1 || day > 31) return null;
  for (let i = 0; i < 3; i++) {
    const month = ref.startOf("month").plus({ months: i });
    if (day > (month.daysInMonth ?? 31)) continue;
    const candidate = month.set({ day });
    if (candidate >= ref.startOf("day")) return candidate.toFormat("d LLLL yyyy");
  }
  return null;
}

function weekdayNextWeek(day: string, ref: DateTime): string {
  const idx = WEEKDAY_INDEX[day.slice(0, 3).toLowerCase()] ?? 1;
  const nextMonday = ref.startOf("week").plus({ weeks: 1 }); // Luxon weeks start on Monday
  return nextMonday.plus({ days: idx - 1 }).toFormat("d LLLL yyyy");
}

/** Map a chrono match in the normalised text back to the words the student actually wrote. */
function originalPhrase(match: chrono.ParsedResult, replacements: Replacement[]): string {
  let phrase = match.text;
  for (const r of replacements) {
    if (match.index <= r.start && match.index + match.text.length >= r.end) {
      phrase = phrase.replace(r.replacement, r.original);
    }
  }
  return phrase.replace(/[,.;:]+$/, "").trim();
}

export function resolveDueDate(text: string, sentAt: Date, timezone: string): DueResolution | null {
  const ref = DateTime.fromJSDate(sentAt, { zone: timezone });
  const { text: normalised, replacements } = normalise(text, ref);

  const results = chrono.en.GB.parse(normalised, { instant: sentAt, timezone: ref.offset }, { forwardDate: true }).filter(
    (r) => !VAGUE.test(r.text.trim()),
  );
  if (results.length === 0) return null;

  const candidates = results.map((r) => {
    const hasTime = r.start.isCertain("hour");
    let local = DateTime.fromJSDate(r.start.date(), { zone: timezone });
    let uncertain = false;

    // "by Friday" said on a Friday: chrono picks today. Students would say "today" for that,
    // so take next week's Friday, but flag it.
    const weekdayOnly = r.start.isCertain("weekday") && !r.start.isCertain("day");
    if (weekdayOnly && local.hasSame(ref, "day") && !/\b(today|this)\b/i.test(r.text)) {
      local = local.plus({ weeks: 1 });
      uncertain = true;
    }

    if (!hasTime) local = local.set({ hour: 23, minute: 59, second: 0, millisecond: 0 });

    // A deadline already in the past, or many months away, is probably a misread.
    if (local < ref.startOf("day") || local > ref.plus({ days: 180 })) uncertain = true;

    const before = normalised.slice(Math.max(0, r.index - 40), r.index);
    return {
      dueAt: local.toJSDate(),
      phrase: originalPhrase(r, replacements),
      hasTime,
      uncertain,
      cued: DUE_CUE.test(before) || DUE_CUE.test(r.text),
      day: local.toISODate(),
    };
  });

  const cued = candidates.filter((c) => c.cued);
  const pool = cued.length > 0 ? cued : candidates;
  const best = pool.reduce((a, b) => (b.dueAt > a.dueAt ? b : a));

  // Several different days and nothing saying which one is the deadline: ambiguous.
  const distinctDays = new Set(pool.map((c) => c.day)).size;
  const ambiguous = cued.length === 0 && distinctDays > 1;

  return { dueAt: best.dueAt, phrase: best.phrase, hasTime: best.hasTime, uncertain: best.uncertain || ambiguous };
}
