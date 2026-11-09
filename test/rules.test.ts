import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { extractRuleBased } from "../src/extraction/extract.js";
import { courseCodes, type MessageInput } from "../src/extraction/rules.js";

const TZ = "Africa/Lagos";
const MON_10AM = DateTime.fromISO("2026-11-09T10:00", { zone: TZ }).toJSDate();
const wall = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm") : null);

const msg = (text: string | null, extra: Partial<MessageInput> = {}): MessageInput => ({
  text,
  links: [],
  hasFile: false,
  fileType: null,
  fileName: null,
  ...extra,
});
const run = (m: MessageInput) => extractRuleBased(m, MON_10AM, TZ);
const item = (m: MessageInput) => {
  const r = run(m);
  if (r.kind !== "item") throw new Error(`expected an item, got ${r.kind}${r.kind === "ignored" ? ` (${r.reason})` : ""}`);
  return r.item;
};

describe("courseCodes", () => {
  it("finds and normalises course codes", () => {
    expect(courseCodes("CSC 411 and mis402, also Cos-411")).toEqual(["CSC 411", "MIS 402", "COS 411"]);
  });
  it("ignores things that only look like course codes", () => {
    expect(courseCodes("see page 100 in room 101, hall 3, level 400")).toEqual([]);
  });
});

describe("extractRuleBased: ignores chatter", () => {
  it.each(["ok", "😂😂", "Good morning everyone", "lol", "thanks", "abeg who get charger?", "na wa o", "Happy birthday Tolu!!"])(
    "%s",
    (text) => {
      expect(run(msg(text)).kind).toBe("ignored");
    },
  );

  it("stickers and voice notes", () => {
    expect(run(msg(null, { hasFile: true, fileType: "sticker" })).kind).toBe("ignored");
    expect(run(msg(null, { hasFile: true, fileType: "voice" })).kind).toBe("ignored");
  });

  it("questions from students", () => {
    expect(run(msg("When is the CSC 411 assignment due?")).kind).toBe("ignored");
  });
});

describe("extractRuleBased: assignments", () => {
  it("the spec example", () => {
    const i = item(msg("CSC 411 Assignment 2, submit on the portal by Friday"));
    expect(i).toMatchObject({ type: "assignment", title: "CSC 411 – Assignment 2", courseCode: "CSC 411", dueDateUncertain: false });
    expect(wall(i.dueAt)).toBe("2026-11-13 23:59");
    expect(i.dueDatePhrase).toBe("Friday");
  });

  it("Pidgin and abbreviations", () => {
    const i = item(msg("Una should submit ass 2 for csc411 before 12pm tomorrow o"));
    expect(i.type).toBe("assignment");
    expect(i.title).toBe("CSC 411 – Assignment 2");
    expect(wall(i.dueAt)).toBe("2026-11-10 12:00");
  });

  it("no due date", () => {
    const i = item(msg("MTH 201 assignment is out, check the portal"));
    expect(i.type).toBe("assignment");
    expect(i.dueAt).toBeNull();
  });

  it("an assignment sent as a PDF is still an assignment", () => {
    const i = item(msg("GST 111 assignment questions, due 20th Nov", { hasFile: true, fileType: "document", fileName: "gst111_assignment.pdf" }));
    expect(i.type).toBe("assignment");
    expect(wall(i.dueAt)).toBe("2026-11-20 23:59");
  });
});

describe("extractRuleBased: projects, tasks, notes, tips", () => {
  it("a group project proposal", () => {
    const i = item(msg("MIS 402: Group project proposal due 20th Nov"));
    expect(i).toMatchObject({ type: "project", title: "MIS 402 – Group project proposal" });
    expect(wall(i.dueAt)).toBe("2026-11-20 23:59");
  });

  it("forming groups", () => {
    expect(item(msg("Everyone should form groups of 5 for the MIS 402 project")).type).toBe("project");
  });

  it("a reading task", () => {
    const i = item(msg("Everyone should read chapter 4 before Thursday's class"));
    expect(i).toMatchObject({ type: "task", title: "Reading task" });
    expect(wall(i.dueAt)).toBe("2026-11-12 23:59");
  });

  it("a form to fill", () => {
    expect(item(msg("Fill the attendance form for COS 411 before Friday")).type).toBe("task");
  });

  it("a note: slides as a PDF, titled from the caption", () => {
    const i = item(msg("HCI Week 9 slides", { hasFile: true, fileType: "document", fileName: "HCI_week9.pdf" }));
    expect(i).toMatchObject({ type: "note", title: "HCI Week 9 slides", dueAt: null });
  });

  it("a note: a PDF with no caption is titled from the file name", () => {
    expect(item(msg(null, { hasFile: true, fileType: "document", fileName: "CSC411_lecture_notes-week3.pdf" })).title).toBe(
      "CSC411 lecture notes week3",
    );
  });

  it("a note: a Drive link", () => {
    expect(item(msg("Materials for the test", { links: ["https://drive.google.com/file/d/abc"] })).type).toBe("note");
  });

  it("a tip", () => {
    const i = item(msg("Focus on chapters 3–5 for the test"));
    expect(i).toMatchObject({ type: "tip", title: "Focus on chapters 3–5 for the test", dueAt: null });
  });

  it("a tip about the lecturer", () => {
    expect(item(msg("The lecturer likes diagrams, use them in the exam")).type).toBe("tip");
  });
});

describe("extractRuleBased: updates", () => {
  it("an extension with a course code is flagged as an update", () => {
    const i = item(msg("CSC 411 assignment deadline extended to next Monday"));
    expect(i.looksLikeUpdate).toBe(true);
    expect(wall(i.dueAt)).toBe("2026-11-16 23:59");
  });

  it("a bare deadline statement is an update-only signal", () => {
    expect(run(msg("Deadline for this is 27 Nov")).kind).toBe("update-only");
    expect(run(msg("Friday is the day for the party")).kind).toBe("ignored");
  });

  it("a bare extension is an update-only signal", () => {
    const r = run(msg("Deadline don shift to Monday 16th November"));
    expect(r.kind).toBe("update-only");
  });
});
