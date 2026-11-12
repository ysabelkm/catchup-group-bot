import { DateTime } from "luxon";
import { prisma } from "../db.js";
import { escapeHtml } from "../lib/html.js";
import { messageLink } from "../lib/links.js";

const TYPE_ICON: Record<string, string> = { note: "📝 ", tip: "💡 " };

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

/**
 * One item as a two-line card: the title in bold, then the details under it.
 *
 *   <b>CSC 411 – Assignment 2</b>
 *   └ due <b>TOMORROW</b> (Thu 12 Nov) · in ASSIGNMENT ↗
 *
 * The topic name is the link to the message. There's no "#": Telegram would turn it into
 * a hashtag, and tapping that searches the chat instead of opening the message.
 */
export function formatItemLine(item: ItemView, timezone: string, now = new Date(), opts: { missed?: boolean } = {}): string {
  const title = `${TYPE_ICON[item.type] ?? ""}<b>${escapeHtml(item.title)}</b>`;
  const date = (d: Date) => DateTime.fromJSDate(d, { zone: timezone }).toFormat("ccc d LLL");

  const details: string[] = [];
  if (item.dueAt && opts.missed) details.push(`was due ${date(item.dueAt)}`);
  else if (item.dueAt) details.push(formatDue(item.dueAt, timezone, now) + (item.dueDateUncertain ? " <i>(date unclear, check the message)</i>" : ""));
  else if (item.type !== "note" && item.type !== "tip") details.push(`posted ${date(item.createdAt)}`);

  const topic = item.topicName ? `in ${escapeHtml(item.topicName)}` : "";
  if (item.link) details.push(`<a href="${item.link}">${topic ? `${topic} ↗` : "open ↗"}</a>`);
  else if (topic) details.push(topic);

  return details.length ? `${title}\n└ ${details.join(" · ")}` : title;
}
