import { DateTime } from "luxon";
import { prisma } from "../db.js";
import type { Group } from "../generated/prisma/client.js";
import { escapeHtml } from "../lib/html.js";
import { messageLink } from "../lib/links.js";
import { formatItemLine, type ItemView } from "../services/items.js";
import { splitIntoMessages, type SummaryContent } from "./render.js";

/**
 * Personal views across a user's groups: /catchup, /items and /summary in DM, and the daily
 * DM summary (spec §4.5, §4.6). Groups must already be membership-checked by the caller.
 */

export type GroupBlock = { group: Group; content: SummaryContent };

/** One message list covering several groups, each section headed with the group's name. */
export function renderPersonal(header: string, blocks: GroupBlock[], now: Date, emptyLine = "No academic updates ✅"): string[] {
  const sections: { heading: string; lines: string[] }[] = [];
  for (const { group, content } of blocks) {
    const tz = group.timezone;
    const name = `🏫 <b>${escapeHtml(group.title)}</b>`;
    const line = (i: ItemView) => formatItemLine(i, tz, now);
    const parts: [string, string[]][] = [
      ["⌛ Was due since the last summary", content.missed.map((i) => formatItemLine(i, tz, now, { missed: true }))],
      ["⏰ Due soon", content.dueSoon.map(line)],
      ["🔄 Ongoing", content.ongoing.map(line)],
      ["🆕 New notes & tips", content.fresh.map(line)],
      ["📎 Recent notes & tips", content.recentNotes.map(line)],
    ];
    const nonEmpty = parts.filter(([, lines]) => lines.length > 0);
    if (nonEmpty.length === 0) {
      sections.push({ heading: name, lines: [emptyLine] });
      continue;
    }
    for (const [label, lines] of nonEmpty) sections.push({ heading: `${name} · ${escapeHtml(label)}`, lines });
  }
  return splitIntoMessages(header, sections);
}

const include = { sources: { where: { kind: "created" }, take: 1, include: { message: { include: { topic: true } } } } } as const;

function toViews(group: Group, items: Awaited<ReturnType<typeof fetchItems>>): ItemView[] {
  return items.map((i) => {
    const m = i.sources[0]?.message;
    return {
      id: i.id, type: i.type, title: i.title, dueAt: i.dueAt, dueDateUncertain: i.dueDateUncertain,
      createdAt: i.createdAt, expiresAt: i.expiresAt,
      link: m ? messageLink(group.telegramChatId, m.telegramMessageId, m.topic?.threadId) : null,
      topicName: group.isForum ? (m?.topic?.name ?? "General") : null,
    };
  });
}
function fetchItems(where: Parameters<typeof prisma.item.findMany>[0]) {
  return prisma.item.findMany({ ...where, include, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] });
}

/**
 * What a user needs to know about one group: everything still active, plus notes/tips posted
 * since `since` (their last /catchup). `since = null` → only what's active.
 */
export async function catchupContent(group: Group, now: Date, since: Date | null): Promise<SummaryContent> {
  const startOfToday = DateTime.fromJSDate(now, { zone: group.timezone }).startOf("day").toJSDate();
  const actionable = { in: ["assignment", "task", "project"] as ("assignment" | "task" | "project")[] };
  const [dueSoon, ongoing, notes] = await Promise.all([
    fetchItems({ where: { groupId: group.id, type: actionable, status: "active", dueAt: { gte: startOfToday } } }),
    fetchItems({ where: { groupId: group.id, type: actionable, status: "active", dueAt: null, expiresAt: { gt: now } } }),
    since
      ? fetchItems({ where: { groupId: group.id, type: { in: ["note", "tip"] }, status: { not: "removed" }, createdAt: { gt: since, lte: now } } })
      : fetchItems({ where: { groupId: group.id, type: { in: ["note", "tip"] }, status: "active", expiresAt: { gt: now } } }),
  ]);
  return { missed: [], dueSoon: toViews(group, dueSoon), ongoing: toViews(group, ongoing), fresh: toViews(group, notes), recentNotes: [] };
}
