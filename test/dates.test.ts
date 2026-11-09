import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { resolveDueDate } from "../src/extraction/dates.js";

const TZ = "Africa/Lagos";
/** A Lagos wall-clock time as a Date. */
const lagos = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
/** Format a resolved date back to Lagos wall-clock for readable assertions. */
const wall = (d: Date) => DateTime.fromJSDate(d, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm");

const MON_10AM = lagos("2026-11-09T10:00"); // Monday 9 Nov 2026
const FRI_10AM = lagos("2026-11-13T10:00");

const due = (text: string, sentAt = MON_10AM) => resolveDueDate(text, sentAt, TZ);

describe("resolveDueDate", () => {
  it("tomorrow", () => {
    expect(wall(due("submit tomorrow")!.dueAt)).toBe("2026-11-10 23:59");
  });

  it("tomorrow with a time", () => {
    const r = due("due tomorrow 12pm")!;
    expect(wall(r.dueAt)).toBe("2026-11-10 12:00");
    expect(r.hasTime).toBe(true);
  });

  it("a weekday later this week", () => {
    expect(wall(due("submit by Friday")!.dueAt)).toBe("2026-11-13 23:59");
    expect(wall(due("ass 2 due fri")!.dueAt)).toBe("2026-11-13 23:59");
  });

  it("next Friday", () => {
    expect(wall(due("submit next Friday")!.dueAt)).toBe("2026-11-20 23:59");
  });

  it('"Friday" said on a Friday means next week, flagged as uncertain', () => {
    const r = due("submit by Friday", FRI_10AM)!;
    expect(wall(r.dueAt)).toBe("2026-11-20 23:59");
    expect(r.uncertain).toBe(true);
  });

  it('"today" keeps the same day', () => {
    expect(wall(due("submit today", FRI_10AM)!.dueAt)).toBe("2026-11-13 23:59");
  });

  it("explicit dates, including day-first numeric dates", () => {
    expect(wall(due("deadline is 14th Nov")!.dueAt)).toBe("2026-11-14 23:59");
    expect(wall(due("submit on 14/11")!.dueAt)).toBe("2026-11-14 23:59");
    expect(wall(due("due 2/12")!.dueAt)).toBe("2026-12-02 23:59");
  });

  it("a time only, later today", () => {
    expect(wall(due("submit by 12pm")!.dueAt)).toBe("2026-11-09 12:00");
  });

  it("a date with no time is the end of that day, 23:59 WAT", () => {
    const r = due("due 20 Nov")!;
    expect(wall(r.dueAt)).toBe("2026-11-20 23:59");
    expect(r.dueAt.toISOString()).toBe("2026-11-20T22:59:00.000Z");
    expect(r.hasTime).toBe(false);
  });

  it("a date with a time", () => {
    expect(wall(due("due 20 Nov 2pm")!.dueAt)).toBe("2026-11-20 14:00");
    expect(wall(due("submit before 11:59pm on Wednesday")!.dueAt)).toBe("2026-11-11 23:59");
  });

  it("month and year rollover", () => {
    expect(wall(due("due 5th Jan", lagos("2026-12-20T10:00"))!.dueAt)).toBe("2027-01-05 23:59");
    expect(wall(due("submit tomorrow", lagos("2026-12-31T15:00"))!.dueAt)).toBe("2027-01-01 23:59");
    expect(wall(due("due on the 3rd", lagos("2026-11-28T10:00"))!.dueAt)).toBe("2026-12-03 23:59");
  });

  it('"next week Tuesday" means Tuesday of next week', () => {
    const r = due("submit next week Tuesday")!;
    expect(wall(r.dueAt)).toBe("2026-11-17 23:59");
    expect(r.phrase).toBe("next week Tuesday");
    expect(wall(due("submission is Tuesday next week")!.dueAt)).toBe("2026-11-17 23:59");
  });

  it('"next tomorrow" means the day after tomorrow', () => {
    const r = due("submission na next tomorrow")!;
    expect(wall(r.dueAt)).toBe("2026-11-11 23:59");
    expect(r.phrase).toBe("next tomorrow");
  });

  it("several dates: the deadline wins over a class or test date", () => {
    const r = due("test on Thursday, assignment due next Monday")!;
    expect(wall(r.dueAt)).toBe("2026-11-16 23:59");
    expect(r.uncertain).toBe(false);
  });

  it("several dates with no deadline cue are flagged as uncertain", () => {
    const r = due("Thursday or Friday, we will see")!;
    expect(r.uncertain).toBe(true);
  });

  it("an extension", () => {
    expect(wall(due("deadline extended to next Monday")!.dueAt)).toBe("2026-11-16 23:59");
  });

  it("vague or missing dates give nothing", () => {
    expect(due("submit soon")).toBeNull();
    expect(due("submit next week")).toBeNull();
    expect(due("CSC 411 assignment 2")).toBeNull();
    expect(due("focus on chapters 3-5")).toBeNull();
    expect(due("form groups of 5")).toBeNull();
  });

  it("a bare day of the month after a deadline word", () => {
    expect(wall(due("on or before 15th")!.dueAt)).toBe("2026-11-15 23:59");
    expect(wall(due("submit by the 5th", lagos("2026-11-20T10:00"))!.dueAt)).toBe("2026-12-05 23:59");
    expect(due("submit by the 5th")!.phrase).toBe("the 5th");
  });

  it("ordinals that aren't dates are left alone", () => {
    expect(due("the 2nd assignment is out")).toBeNull();
    expect(due("due on the 2nd assignment page")).toBeNull();
    expect(wall(due("submit the 2nd assignment by Friday")!.dueAt)).toBe("2026-11-13 23:59");
  });

  it("keeps the student's own words as the phrase", () => {
    expect(due("CSC411 by 5pm tomorrow")!.phrase).toBe("5pm tomorrow");
  });
});
