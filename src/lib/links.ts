/**
 * Build a t.me deep link to a message in a group.
 *
 * Only supergroups (chat ids starting with -100) support t.me/c links.
 * Basic groups have no public message links, so we return null for them.
 */
export function messageLink(chatId: bigint | number | string, messageId: number, threadId?: number | null): string | null {
  const id = String(chatId);
  if (!id.startsWith("-100")) return null;
  const internal = id.slice(4);
  if (threadId != null) return `https://t.me/c/${internal}/${threadId}/${messageId}`;
  return `https://t.me/c/${internal}/${messageId}`;
}
