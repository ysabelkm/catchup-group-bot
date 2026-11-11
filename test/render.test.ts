import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { renderSummary, splitIntoMessages, type SummaryContent } from "../src/summary/render.js";
import type { ItemView } from "../src/services/items.js";

const TZ = "Africa/Lagos";
const lagos = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const NOW = lagos("2026-11-09T19:00"); // Monday

const view = (over: Partial<ItemView>): ItemView => ({
  id: 1, type: "assignment", title: "Item", dueAt: null, dueDateUncertain: false,
  createdAt: lagos("2026-11-09T09:00"), expiresAt: lagos("2026-11-16T23:59"),
  link: "https://t.me/c/123/5/10", topicName: "General", ...over,
});
const empty: SummaryContent = { missed: [], dueSoon: [], ongoing: [], fresh: [], recentNotes: [] };
const opts = { timezone: TZ, now: NOW, sendWhenEmpty: true };

describe("renderSummary", () => {
  it("matches the spec's format", () => {
    const [text] = renderSummary(
      {
        ...empty,
        dueSoon: [
          view({ id: 1, title: "CSC 411 – Assignment 2", dueAt: lagos("2026-11-10T23:59"), topicName: "Assignments" }),
          view({ id: 2, title: "MIS 402 – Group project proposal", type: "project", dueAt: lagos("2026-11-13T23:59") }),
        ],
        ongoing: [view({ id: 3, title: "COS 411 – Reading task", type: "task", createdAt: lagos("2026-11-05T10:00"), expiresAt: lagos("2026-11-12T23:59"), topicName: null })],
        fresh: [
          view({ id: 4, type: "note", title: "HCI Week 9 slides", topicName: "Resources" }),
          view({ id: 5, type: "tip", title: "Focus on chapters 3–5 for the test", topicName: null }),
        ],
      },
      opts,
    );
    expect(text).toBe(
      [
        "📚 <b>Daily summary — Mon 9 Nov</b>",
        "",
        "⏰ <b>Due soon</b>",
        '• CSC 411 – Assignment 2 — due <b>TOMORROW</b> (Tue 10 Nov) · <a href="https://t.me/c/123/5/10">in Assignments ↗</a>',
        '• MIS 402 – Group project proposal — due Fri 13 Nov · <a href="https://t.me/c/123/5/10">in General ↗</a>',
        "",
        "🔄 <b>Ongoing (no due date stated)</b>",
        '• COS 411 – Reading task — posted Thu 5 Nov (shows until Thu 12 Nov) · <a href="https://t.me/c/123/5/10">open ↗</a>',
        "",
        "🆕 <b>New today</b>",
        '• 📝 Note: HCI Week 9 slides · <a href="https://t.me/c/123/5/10">in Resources ↗</a>',
        '• 💡 Tip: Focus on chapters 3–5 for the test · <a href="https://t.me/c/123/5/10">open ↗</a>',
      ].join("\n"),
    );
  });

  it("marks due today, times and unclear dates", () => {
    const [text] = renderSummary(
      { ...empty, dueSoon: [view({ title: "A", dueAt: lagos("2026-11-09T23:59") }), view({ title: "B", dueAt: lagos("2026-11-11T14:00"), dueDateUncertain: true })] },
      opts,
    );
    expect(text).toContain("A — due <b>TODAY</b>");
    expect(text).toContain("B — due Wed 11 Nov, 2:00 PM <i>(date unclear — check message)</i>");
  });

  it("escapes HTML in titles", () => {
    const [text] = renderSummary({ ...empty, fresh: [view({ type: "note", title: "<script> & co" })] }, opts);
    expect(text).toContain("&lt;script&gt; &amp; co");
  });

  it("lists deadlines that passed while no summary went out", () => {
    const [text] = renderSummary({ ...empty, missed: [view({ title: "CSC 411 – Assignment 1", dueAt: lagos("2026-11-07T23:59") })] }, opts);
    expect(text).toContain("⌛ <b>Was due since the last summary</b>");
    expect(text).toContain("CSC 411 – Assignment 1 — was due Sat 7 Nov");
  });

  it("empty days: a one-liner, or nothing when the group opted out", () => {
    expect(renderSummary(empty, opts)).toEqual(["📚 <b>Daily summary — Mon 9 Nov</b>\n\nNo academic updates today ✅"]);
    expect(renderSummary(empty, { ...opts, sendWhenEmpty: false })).toEqual([]);
  });
});

describe("splitIntoMessages", () => {
  it("keeps everything in one message when it fits", () => {
    expect(splitIntoMessages("H", [{ heading: "S", lines: ["a", "b"] }])).toEqual(["H\n\nS\na\nb"]);
  });

  it("splits long summaries under the limit without cutting an item in half", () => {
    const lines = Array.from({ length: 120 }, (_, i) => `• Item ${i} ${"x".repeat(60)}`);
    const parts = splitIntoMessages("📚 Header", [{ heading: "⏰ Due soon", lines }]);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(3900);
    // Every item appears exactly once and whole.
    const all = parts.join("\n");
    for (const l of lines) expect(all.split(l).length - 1).toBe(1);
    expect(parts[1]).toMatch(/^📚 Header <i>\(continued\)<\/i>\n\n⏰ Due soon <i>\(cont\.\)<\/i>\n• Item/);
  });

  it("stays under Telegram's 4096 limit with real HTML lines", () => {
    const longLine = `• ${"Very long assignment title ".repeat(10)} — due Fri 13 Nov · <a href="https://t.me/c/1234567890/12345/67890">in Assignments ↗</a>`;
    const parts = splitIntoMessages("📚 <b>Daily summary — Mon 9 Nov</b>", [
      { heading: "⏰ <b>Due soon</b>", lines: Array(40).fill(longLine) },
      { heading: "🆕 <b>New today</b>", lines: Array(40).fill(longLine) },
    ]);
    for (const p of parts) expect(p.length).toBeLessThan(4096);
  });
});
