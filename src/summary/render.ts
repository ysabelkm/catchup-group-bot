import { DateTime } from "luxon";
import { escapeHtml } from "../lib/html.js";
import { formatItemLine, type ItemView } from "../services/items.js";

/** Telegram's limit is 4096; leave room for the "(continued)" header. */
export const MESSAGE_LIMIT = 3900;

export type SummaryContent = {
  /** Deadlines that passed while no summary went out (spec §4.5, missed summaries). */
  missed: ItemView[];
  dueSoon: ItemView[];
  ongoing: ItemView[];
  /** Notes and tips not shown in any summary yet. */
  fresh: ItemView[];
  /** Notes and tips already shown, kept for 7 days when the group chose that rule. */
  recentNotes: ItemView[];
};

export function isEmpty(c: SummaryContent): boolean {
  return Object.values(c).every((list) => list.length === 0);
}

export function allItemIds(c: SummaryContent): number[] {
  return Object.values(c).flatMap((list: ItemView[]) => list.map((i) => i.id));
}

/**
 * Render the daily summary as Telegram HTML (spec §4.5), split into messages of at most
 * MESSAGE_LIMIT characters without cutting an item in half.
 */
export function renderSummary(
  content: SummaryContent,
  opts: { timezone: string; now: Date; sendWhenEmpty: boolean; title?: string },
): string[] {
  const day = DateTime.fromJSDate(opts.now, { zone: opts.timezone }).toFormat("ccc d LLL");
  const header = `📚 <b>${escapeHtml(opts.title ?? "Daily summary")} — ${day}</b>`;

  if (isEmpty(content)) return opts.sendWhenEmpty ? [`${header}\n\nNo academic updates today ✅`] : [];

  const line = (i: ItemView) => formatItemLine(i, opts.timezone, opts.now);
  const missedLine = (i: ItemView) => {
    const due = DateTime.fromJSDate(i.dueAt!, { zone: opts.timezone }).toFormat("ccc d LLL");
    return `• ${escapeHtml(i.title)} — was due ${due}${i.link ? ` <a href="${i.link}">↗</a>` : ""}`;
  };

  const sections: { heading: string; lines: string[] }[] = [
    { heading: "⌛ <b>Was due since the last summary</b>", lines: content.missed.map(missedLine) },
    { heading: "⏰ <b>Due soon</b>", lines: content.dueSoon.map(line) },
    { heading: "🔄 <b>Ongoing (no due date stated)</b>", lines: content.ongoing.map(line) },
    { heading: "🆕 <b>New today</b>", lines: content.fresh.map(line) },
    { heading: "📎 <b>Recent notes &amp; tips</b>", lines: content.recentNotes.map(line) },
  ].filter((s) => s.lines.length > 0);

  return splitIntoMessages(header, sections);
}

/**
 * Pack sections into as few messages as possible. A section that doesn't fit continues in the
 * next message under its heading marked "(cont.)"; single items are never split.
 */
export function splitIntoMessages(header: string, sections: { heading: string; lines: string[] }[], limit = MESSAGE_LIMIT): string[] {
  const messages: string[] = [];
  let current = header;

  const flush = () => {
    messages.push(current);
    current = `${header} <i>(continued)</i>`;
  };

  for (const { heading, lines } of sections) {
    let headingForThisMessage = `\n\n${heading}`;
    let startedInThisMessage = false;
    for (const raw of lines) {
      // An absurdly long single item still has to fit somewhere.
      const itemLine = raw.length > limit - header.length - heading.length - 40 ? `${raw.slice(0, limit - header.length - heading.length - 41)}…` : raw;
      const addition = (startedInThisMessage ? "" : headingForThisMessage) + `\n${itemLine}`;
      if (current.length + addition.length > limit) {
        flush();
        headingForThisMessage = `\n\n${heading} <i>(cont.)</i>`;
        startedInThisMessage = false;
        current += `${headingForThisMessage}\n${itemLine}`;
        startedInThisMessage = true;
        continue;
      }
      current += addition;
      startedInThisMessage = true;
    }
  }
  messages.push(current);
  return messages;
}
