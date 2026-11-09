import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { computeExpiresAt, type LifecycleOptions } from "../src/extraction/lifecycle.js";

const TZ = "Africa/Lagos";
const lagos = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const wall = (d: Date) => DateTime.fromJSDate(d, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm");
const opts: LifecycleOptions = { timezone: TZ, summaryTime: "19:00", noDueDateDays: 7, noteTipRule: "once" };

/** Would the item still show in the summary sent at this Lagos time? */
const showsAt = (expiresAt: Date, iso: string) => expiresAt > lagos(iso);

describe("computeExpiresAt", () => {
  it("a dated assignment shows until the end of its due day, then disappears", () => {
    const exp = computeExpiresAt({ type: "assignment", dueAt: lagos("2026-11-13T12:00"), postedAt: lagos("2026-11-09T10:00") }, opts);
    expect(wall(exp)).toBe("2026-11-13 23:59");
    expect(showsAt(exp, "2026-11-13T19:00")).toBe(true); // "due today" in Friday's summary, even though noon has passed
    expect(showsAt(exp, "2026-11-14T19:00")).toBe(false); // gone on Saturday
  });

  it("an undated task shows for 7 days after posting (Thu 5 Nov → Thu 12 Nov)", () => {
    const exp = computeExpiresAt({ type: "task", dueAt: null, postedAt: lagos("2026-11-05T09:30") }, opts);
    expect(wall(exp)).toBe("2026-11-12 23:59");
    expect(showsAt(exp, "2026-11-12T19:00")).toBe(true);
    expect(showsAt(exp, "2026-11-13T19:00")).toBe(false);
  });

  it("a due date added later switches to the due-date rule", () => {
    const postedAt = lagos("2026-11-05T09:30");
    const before = computeExpiresAt({ type: "project", dueAt: null, postedAt }, opts);
    const after = computeExpiresAt({ type: "project", dueAt: lagos("2026-11-20T23:59"), postedAt }, opts);
    expect(wall(before)).toBe("2026-11-12 23:59");
    expect(wall(after)).toBe("2026-11-20 23:59");
  });

  it("a note shows once, in the summary of the day it was posted", () => {
    const exp = computeExpiresAt({ type: "note", dueAt: null, postedAt: lagos("2026-11-09T11:00") }, opts);
    expect(showsAt(exp, "2026-11-09T19:00")).toBe(true);
    expect(showsAt(exp, "2026-11-10T19:00")).toBe(false);
  });

  it("a note posted after the 7 PM summary shows once, the next evening", () => {
    const exp = computeExpiresAt({ type: "tip", dueAt: null, postedAt: lagos("2026-11-09T21:15") }, opts);
    expect(showsAt(exp, "2026-11-10T19:00")).toBe(true);
    expect(showsAt(exp, "2026-11-11T19:00")).toBe(false);
  });

  it("notes follow the 7-day rule when a group chooses it", () => {
    const exp = computeExpiresAt({ type: "note", dueAt: null, postedAt: lagos("2026-11-05T09:30") }, { ...opts, noteTipRule: "7days" });
    expect(wall(exp)).toBe("2026-11-12 23:59");
  });
});
