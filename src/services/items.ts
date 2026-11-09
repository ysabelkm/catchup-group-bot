import { DateTime } from "luxon";
import { prisma } from "../db.js";
import { escapeHtml } from "../lib/html.js";
import { messageLink } from "../lib/links.js";

const TYPE_ICON: Record<string, string> = { note: "📝 Note: ", tip: "💡 Tip: " };

export type ItemView = {
  id: number;
  type: string;
  title: string;
  dueAt: Date | null;
  dueDateUncertain: boolean;
  createdAt: Date;
  expiresAt: Date;
  link: string | null;
  topicName: string | null;
};

/** Active items of a group with the link and topic of the message they came from. */
export async function activeItems(groupId: number, now = new Date()): Promise<ItemView[]> {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
  const items = await prisma.item.findMany({
    where: { groupId, status: "active", expiresAt: { gt: now } },
    include: {
      sources: {
        where: { kind: "created" },
        take: 1,
        include: { message: { include: { topic: true } } },
      },
    },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });

  return items.map((i) => {
    const m = i.sources[0]?.message;
    return {
      id: i.id,
      type: i.type,
      title: i.title,
      dueAt: i.dueAt,
      dueDateUncertain: i.dueDateUncertain,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      link: m ? messageLink(group.telegramChatId, m.telegramMessageId, m.topic?.threadId) : null,
      topicName: group.isForum ? (m?.topic?.name ?? "General") : null,
    };
  });
}

/** "due TODAY", "due TOMORROW (Tue 10 Nov)", "due Fri 13 Nov, 2:00 PM". */
export function formatDue(dueAt: Date, timezone: string, now = new Date()): string {
  const due = DateTime.fromJSDate(dueAt, { zone: timezone });
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf("day");
  // A date with no stated time is stored as 23:59.
  const time = due.hour === 23 && due.minute === 59 ? "" : `, ${due.toFormat("h:mm a")}`;
  const days = Math.round(due.startOf("day").diff(today, "days").days);
  if (days === 0) return `due <b>TODAY</b>${time}`;
  if (days === 1) return `due <b>TOMORROW</b> (${due.toFormat("ccc d LLL")})${time}`;
  return `due ${due.toFormat("ccc d LLL")}${time}`;
}

export function formatItemLine(item: ItemView, timezone: string, now = new Date()): string {
  const parts = [`• ${TYPE_ICON[item.type] ?? ""}${escapeHtml(item.title)}`];
  if (item.dueAt) {
    parts.push(` — ${formatDue(item.dueAt, timezone, now)}`);
    if (item.dueDateUncertain) parts.push(" <i>(date unclear — check message)</i>");
  } else if (item.type !== "note" && item.type !== "tip") {
    const posted = DateTime.fromJSDate(item.createdAt, { zone: timezone });
    const until = DateTime.fromJSDate(item.expiresAt, { zone: timezone });
    parts.push(` — posted ${posted.toFormat("ccc d LLL")} (shows until ${until.toFormat("ccc d LLL")})`);
  }
  if (item.topicName) parts.push(` · #${escapeHtml(item.topicName.replace(/\s+/g, ""))}`);
  if (item.link) parts.push(` <a href="${item.link}">↗</a>`);
  return parts.join("");
}
