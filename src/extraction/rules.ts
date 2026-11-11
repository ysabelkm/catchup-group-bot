/**
 * Rule-based extraction (spec §4.2 step 1, milestone 2): no AI, so the bot works even
 * when every AI provider is down or rate-limited. Also the last step of the fallback chain.
 */

export type ItemType = "assignment" | "task" | "project" | "note" | "tip";

export type MessageInput = {
  text: string | null;
  links: string[];
  hasFile: boolean;
  fileType: string | null;
  fileName: string | null;
};

// --- Course codes -----------------------------------------------------------------------

/** Letters that look like a course code but aren't ("page 100", "room 101"). */
const NOT_COURSE = new Set([
  "page", "pg", "pgs", "room", "rm", "hall", "lt", "the", "and", "for", "not", "all", "are", "was", "has",
  "get", "via", "per", "no", "ch", "chap", "wk", "week", "part", "unit", "ver", "top", "lvl", "lev", "year",
  "yr", "q", "qs", "que", "ques", "at", "by", "in", "on", "of", "to", "is", "it", "be", "or", "as", "am", "pm",
  "ng", "naira", "plot", "box", "code", "pin", "otp",
]);

const COURSE_CODE = /\b([A-Za-z]{2,4})\s?-?(\d{3})\b/g;

/** Course codes in the order they appear, formatted like "CSC 411". */
export function courseCodes(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(COURSE_CODE)) {
    const letters = m[1]!;
    if (NOT_COURSE.has(letters.toLowerCase())) continue;
    // Mixed case like "Csc" is fine; all-lowercase common words are filtered above.
    out.push(`${letters.toUpperCase()} ${m[2]}`);
  }
  return [...new Set(out)];
}

// --- Keyword rules ----------------------------------------------------------------------

const RE = {
  project: /\b(projects?|proposals?|term\s+papers?|group\s+(work|presentation)|groups?\s+of\s+\d+|form\s+(your\s+)?groups?|seminar\s+papers?|presentations?|research\s+papers?)\b/i,
  assignment: /\b(assignments?|literature\s+reviews?|essays?|assignmt|assgn?t?|ass\s?\d+|homework|hw|take[-\s]home|tutorial\s+questions?|exercises?|submit|submission|portal|worksheet)\b/i,
  tip: /\b(tips?|focus\s+on|likely\s+(to\s+come|questions?)|(will|go)\s+come\s+out|examinable|areas?\s+of\s+concentration|aoc|lecturer\s+(likes|wants|prefers|said|emphasi[sz]ed)|important\s+(topics?|areas?)|don'?t\s+(skip|forget\s+to\s+read)|hint)\b/i,
  task: /\b(read|reading|fill(\s+(in|out))?\s+(the|this|your)?\s*(form|attendance|survey)|attendance|course\s+form|registration|register|bring|print(\s+out)?|prepare|come\s+with|sign\s+(the|in)|make\s+sure|everyone\s+should|all\s+students\s+(should|must|are\s+to)|familiari[sz]e\s+yoursel(f|ves)|study|revise|research\s+(on|about)|look\s+up|find\s+out|answer\s+(the|these|this|all)|explain|discuss)\b/i,
  note: /\b(slides?|notes?|handouts?|manuals?|materials?|past\s+questions?|pqs?|textbooks?|lecture\s+notes?|pdfs?|recordings?|e-?books?|summary|summaries|ppt|course\s+outline|syllabus|scheme\s+of\s+work)\b/i,
  /** Context that makes a generic task word ("read", "bring") academic. */
  academic: /\b(class|lecture|lecturer|course|chapter|topic|test|exam|quiz|tutorial|lab|practical|seminar|module|semester|textbook|ca|continuous\s+assessment|dept|department|faculty|hod|level)\b/i,
} as const;

const NOTE_FILE_TYPES = new Set(["document", "photo", "video", "audio"]);
const NOTE_LINK = /(drive\.google|docs\.google|dropbox|onedrive|sharepoint|youtu\.?be|classroom\.google|slideshare|scribd|notion\.so|\.pdf\b|\.pptx?\b|\.docx?\b)/i;

/** Stickers, voice notes, "ok", "😂", "good morning"… */
const SMALL_TALK = /^(ok(ay)?|k|kk|yes|yeah|yh|no|nope|lol|lmao|lmfao|haha+|hehe+|thanks?|thank\s+you|thx|tnx|tanks|noted|alright|sure|cool|nice|wow|amen|gm|good\s+(morning|afternoon|evening|night)|hello|hi+|hey|morning|abeg|oya|true|same|me\s+too|\+1)[\s!.?]*$/i;

// --- Adverts and non-academic events ------------------------------------------------------

/** Each pattern is one kind of advert signal; two or more different kinds = an advert. */
const AD_SIGNALS: RegExp[] = [
  // Selling / prices
  /(₦\s?\d|\bN\s?\d{3,}\b|\bngn\b|\bnaira\b|\b\d{1,3}\s?k\b|\bcheap\b|\bprices?\b|\bdiscount|\bpromo\b|\bfor\s+sale\b|\bselling\b|\bbuy\b|\baffordable\b)/i,
  // "Contact me" / phone numbers / WhatsApp
  /(\b(dm|pm|inbox|chat|call|text|whatsapp)\s+(me|us|now)\b|\bdm\b\s*[.!]?\s*$|\bwhatsapp\b|wa\.me|\b0[789][01]\d{8}\b|\+234\s?\d)/i,
  // Offering services
  /(\bservices?\s+(available|rendered|offered)\b|\bwe\s+(do|offer|write|handle|help)\b|\bfast\s+delivery\b|\bguaranteed?\b|\b100\s?%|\blegit\b|\border\s+(now|yours)\b|\bcontact\s+(me|us)\b)/i,
  // Paid academic help
  /(\b(assignments?|projects?|thesis|write-?ups?|seminars?)\s+(help|writing|services?|assistance)\b|\b(do|write)\s+your\s+(assignments?|projects?)\b|\bfor\s+you\b)/i,
  // Money-making / promos
  /(\bearn\s+(\d|money|cash|daily|weekly|from)|\binvest(ment)?\b|\bbusiness\s+opportunit|\bgiveaway\b|\breferral\b|\bsponsored\b|\bjoin\s+my\b)/i,
  // Link shorteners and invite links, common in spam
  /(bit\.ly|tinyurl|linktr\.ee|cutt\.ly|shorturl)/i,
];

export function isAdvert(text: string, links: string[] = []): boolean {
  const haystack = `${text} ${links.join(" ")}`;
  return AD_SIGNALS.filter((re) => re.test(haystack)).length >= 2;
}

const COURSE_MATERIAL = /\b(manuals?|textbooks?|handouts?|lab\s+coats?|practical\s+(manual|fee)|course\s+(manual|materials?))\b/i;

const NON_ACADEMIC_EVENT =
  /\b(fellowship|church|mosque|jum'?u?ah?|jumat|crusade|party|birthday|wedding|owambe|hangout|football|match\s+day|vote|voting|campaign|election|dinner|movie\s+night|week\s+celebration|freshers?\s+night|bonfire)\b/i;
const STRONG_ACADEMIC = /\b(lecture|lecturer|test|exam|assignments?|chapter|tutorial|practical|lab|seminar\s+paper|project|course\s+form|registration)\b/i;

// --- Pre-filter -------------------------------------------------------------------------

export type PrefilterResult = { keep: boolean; reason: string };

/**
 * Cheap check before any extraction or AI call. Keeps anything with academic keywords,
 * dates, course codes, files or links (spec §4.2 step 1).
 */
export function prefilter(msg: MessageInput, hasDate: boolean): PrefilterResult {
  const text = (msg.text ?? "").trim();

  if (!text && (!msg.hasFile || ["sticker", "animation", "voice", "video_note"].includes(msg.fileType ?? ""))) {
    return { keep: false, reason: "no text" };
  }
  if (msg.hasFile && msg.fileType === "document") return { keep: true, reason: "document" };
  if (msg.links.length > 0) return { keep: true, reason: "link" };
  if (courseCodes(text).length > 0) return { keep: true, reason: "course code" };
  if (Object.entries(RE).some(([k, re]) => k !== "academic" && re.test(text))) return { keep: true, reason: "keyword" };
  if (RE.academic.test(text)) return { keep: true, reason: "academic word" };
  if (hasDate) return { keep: true, reason: "date" };
  if (SMALL_TALK.test(text) || !/\p{L}{2,}/u.test(text)) return { keep: false, reason: "small talk" };
  return { keep: false, reason: "no academic signal" };
}

// --- Classification ---------------------------------------------------------------------

export type Classification = { type: ItemType; confidence: number };

/**
 * Pick an item type, or null for chatter. Order matters: a PDF of "Assignment 2 questions"
 * is an assignment, not a note; "focus on chapters 3-5" is a tip, not a reading task.
 */
export function classify(msg: MessageInput, hasDate: boolean): Classification | null {
  const text = msg.text ?? "";
  const hasCode = courseCodes(text).length > 0;
  const academic = hasCode || RE.academic.test(text);

  // Questions are usually students asking ("when is the assignment due?"), not announcing.
  // But a multi-line instruction can end with a question for the class to answer, so only a
  // one-line message, or one that opens like a student's question, counts.
  const trimmed = text.trim();
  const asks = /^(when|what|who|where|which|how|is|are|has|have|do|does|did|can|could|will|should|pls|please|plz|abeg|biko|guys|anyone|una)\b/i;
  const isQuestion = /\?\s*$/.test(trimmed) && !msg.hasFile && msg.links.length === 0 && (!trimmed.includes("\n") || asks.test(trimmed));
  if (isQuestion) return null;

  // Ads that borrow academic words ("assignment help", "past questions for sale") and social
  // events with a time ("fellowship by 4pm") are not items.
  if (!hasCode && isAdvert(text, msg.links)) return null;
  if (NON_ACADEMIC_EVENT.test(text) && !hasCode && !STRONG_ACADEMIC.test(text)) return null;

  if (RE.project.test(text) && (academic || hasDate || /\bproject\b/i.test(text))) {
    return { type: "project", confidence: hasDate || hasCode ? 0.75 : 0.6 };
  }
  if (RE.assignment.test(text)) {
    // "submit"/"portal" alone are weak (could be "submit your names for the party").
    const strong = /\b(assignments?|literature\s+reviews?|essays?|assignmt|assgn?t?|ass\s?\d+|homework|hw|take[-\s]home|tutorial\s+questions?|exercises?|worksheet)\b/i.test(text);
    if (strong || academic) return { type: "assignment", confidence: strong && (hasDate || hasCode) ? 0.8 : 0.6 };
  }
  if (RE.tip.test(text) && (academic || /\b(tips?|focus\s+on|examinable|aoc)\b/i.test(text))) {
    return { type: "tip", confidence: 0.6 };
  }
  if (RE.task.test(text) && (academic || hasDate)) {
    return { type: "task", confidence: hasDate ? 0.65 : 0.5 };
  }
  // "Pay for the CSC 411 manual before Friday": course materials only, not hostel fees.
  if (/\b(pay|payment|buy|collect)\b/i.test(text) && (hasCode || COURSE_MATERIAL.test(text))) {
    return { type: "task", confidence: hasDate ? 0.6 : 0.5 };
  }
  const noteFile = msg.hasFile && NOTE_FILE_TYPES.has(msg.fileType ?? "") && (msg.fileType === "document" || RE.note.test(text) || academic);
  const noteLink = msg.links.some((l) => NOTE_LINK.test(l)) || (msg.links.length > 0 && (RE.note.test(text) || academic));
  if (noteFile || noteLink || (RE.note.test(text) && academic)) {
    return { type: "note", confidence: msg.fileType === "document" ? 0.75 : 0.55 };
  }
  return null;
}

// --- Title and summary ------------------------------------------------------------------

function clean(s: string): string {
  return s
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—•*:,.]+|[\s\-–—•*:,]+$/g, "")
    .trim();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const atWord = cut.replace(/\s+\S*$/, "");
  return `${atWord.length > max * 0.6 ? atWord : cut}…`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fileTitle(fileName: string): string {
  return clean(fileName.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ").replace(/(?<=\w)-(?=\w)/g, " "));
}

/** A short label like "Assignment 2", "Group project proposal", "Reading task". */
function label(type: ItemType, text: string): string | null {
  switch (type) {
    case "assignment": {
      const n = text.match(/\b(?:assignments?|assignmt|assgn?t?|ass)\s*(?:no\.?\s*)?(\d+|[ivx]+)\b/i);
      if (n) return `Assignment ${n[1]!.toUpperCase()}`;
      if (/\btutorial\s+questions?\b/i.test(text)) return "Tutorial questions";
      if (/\bhomework|hw\b/i.test(text)) return "Homework";
      return /\bassign|\bass\b/i.test(text) ? "Assignment" : null;
    }
    case "project": {
      const group = /\bgroups?\b/i.test(text);
      if (/\bproposals?\b/i.test(text)) return group ? "Group project proposal" : "Project proposal";
      if (/\bterm\s+papers?\b/i.test(text)) return "Term paper";
      if (/\bpresentations?\b/i.test(text)) return group ? "Group presentation" : "Presentation";
      if (/\bform\s+(your\s+)?groups?|groups?\s+of\s+\d+/i.test(text) && !/\bproject\b/i.test(text)) return "Form groups";
      return group ? "Group project" : "Project";
    }
    case "task": {
      if (/\b(fill|form|survey)\b/i.test(text)) return "Form to fill";
      if (/\battendance\b/i.test(text)) return "Attendance";
      if (/\bregist/i.test(text)) return "Registration";
      if (/\bread(ing)?\b/i.test(text)) return "Reading task";
      return null;
    }
    default:
      return null;
  }
}

export function buildTitle(type: ItemType, msg: MessageInput, courseCode: string | null): string {
  const text = clean(msg.text ?? "");
  const lbl = label(type, text);

  // Drop a leading course code ("ICT415", "INS 412 -") so it isn't repeated after the prefix,
  // and skip lines that are nothing but the code.
  const codeRe = courseCode ? new RegExp(`^${courseCode.replace(" ", "\\s?-?")}\\b\\s*[-–:.,]?\\s*`, "i") : null;
  const strip = (s: string) => (codeRe ? s.replace(codeRe, "").trim() : s.trim());
  const meaningful = (s: string) => /\p{L}{3,}/u.test(s);
  const firstLine = (msg.text ?? "").split("\n").map((l) => strip(clean(l))).find(meaningful) ?? "";
  const fromFile = msg.fileName ? strip(fileTitle(msg.fileName)) : "";

  let core: string;
  if (lbl) core = lbl;
  else if ((type === "note" || type === "tip") && meaningful(fromFile) && firstLine.length < 4) core = fromFile;
  else if (firstLine) core = capitalise(firstLine);
  else if (meaningful(fromFile)) core = fromFile;
  else core = DEFAULT_TITLE[type];

  core = truncate(core, 70);
  if (!courseCode || core.toUpperCase().replace(/\s/g, "").includes(courseCode.replace(" ", ""))) return core;
  return `${courseCode} – ${core}`;
}

const DEFAULT_TITLE: Record<ItemType, string> = { assignment: "Assignment", project: "Project", task: "Task", note: "Notes", tip: "Tip" };

export function buildSummary(msg: MessageInput): string | null {
  const text = clean(msg.text ?? "");
  if (!text) return msg.fileName ? fileTitle(msg.fileName) : null;
  return truncate(text, 160);
}

// --- Updates to earlier items -----------------------------------------------------------

/** Words that mean "this changes an earlier item" (spec §4.2 step 6). */
export const UPDATE_CUE =
  /\b(extended|extension|postponed|moved|shifted|changed|new\s+(deadline|date)|now\s+(due|on|by)|rescheduled|pushed\s+(back|forward|to)|deadline\s+(is\s+)?now|still\s+(due|on)|(don|done|has|have)\s+(shift|move|change|extend|postpone)\w*|(shift|move|extend|postpone)\w*\s+(it\s+)?to)\b/i;
