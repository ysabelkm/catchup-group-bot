import { resolveDueDate } from "./dates.js";
import { buildSummary, buildTitle, classify, courseCodes, prefilter, UPDATE_CUE, type ItemType, type MessageInput } from "./rules.js";
import { isActionable } from "./lifecycle.js";

/** What extraction found in one message, independent of where it came from (rules or AI). */
export type Extracted = {
  type: ItemType;
  title: string;
  courseCode: string | null;
  summary: string | null;
  dueAt: Date | null;
  dueDatePhrase: string | null;
  dueDateUncertain: boolean;
  /** The message reads like a change to an earlier item ("deadline extended to Monday"). */
  looksLikeUpdate: boolean;
  confidence: number;
};

const DEADLINE_WORD = /\b(deadline|due|submit\w*|submission)\b/i;

export type ExtractionOutcome =
  | { kind: "item"; item: Extracted }
  /** Not an item on its own, but carries a date/update for an earlier one (e.g. a reply). */
  | { kind: "update-only"; courseCode: string | null; dueAt: Date | null; dueDatePhrase: string | null; dueDateUncertain: boolean }
  | { kind: "ignored"; reason: string };

export function extractRuleBased(msg: MessageInput, sentAt: Date, timezone: string): ExtractionOutcome {
  const text = msg.text ?? "";
  const due = text ? resolveDueDate(text, sentAt, timezone) : null;

  const pre = prefilter(msg, due !== null);
  if (!pre.keep) return { kind: "ignored", reason: pre.reason };

  const codes = courseCodes(text);
  const courseCode = codes[0] ?? null;
  const looksLikeUpdate = UPDATE_CUE.test(text);
  const cls = classify(msg, due !== null);

  if (!cls) {
    // "Deadline for this is 27 Nov" (often a reply): no item of its own, but a date for one.
    if (due && (looksLikeUpdate || DEADLINE_WORD.test(text))) {
      return { kind: "update-only", courseCode, dueAt: due.dueAt, dueDatePhrase: due.phrase, dueDateUncertain: due.uncertain };
    }
    return { kind: "ignored", reason: "not academic" };
  }

  // Notes and tips don't have due dates (spec §3).
  const keepDate = isActionable(cls.type) && due !== null;

  return {
    kind: "item",
    item: {
      type: cls.type,
      title: buildTitle(cls.type, msg, courseCode),
      courseCode,
      summary: buildSummary(msg),
      dueAt: keepDate ? due.dueAt : null,
      dueDatePhrase: keepDate ? due.phrase : null,
      dueDateUncertain: keepDate ? due.uncertain : false,
      looksLikeUpdate,
      confidence: cls.confidence,
    },
  };
}
