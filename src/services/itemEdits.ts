import { prisma } from "../db.js";
import { computeExpiresAt, isActionable } from "../extraction/lifecycle.js";
import { lifecycleOptions } from "../extraction/pipeline.js";
import { logger } from "../logger.js";

/** Set a due date by hand (/due). A manual date always wins over AI and rules (spec §4.3). */
export async function setManualDue(itemId: number, dueAt: Date, byTelegramUserId: number) {
  const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId }, include: { group: true } });
  if (!isActionable(item.type)) throw new Error("notes and tips don't have due dates");
  const expiresAt = computeExpiresAt({ type: item.type, dueAt, postedAt: item.createdAt }, lifecycleOptions(item.group));
  const [updated] = await prisma.$transaction([
    prisma.item.update({
      where: { id: itemId },
      data: {
        dueAt,
        dueDateUncertain: false,
        dueSource: "manual",
        expiresAt,
        // A corrected date can bring an expired item back; a removed one stays removed.
        ...(item.status !== "removed" ? { status: expiresAt > new Date() ? "active" : "expired" } : {}),
      },
    }),
    prisma.itemChange.create({
      data: {
        itemId,
        field: "dueAt",
        oldValue: item.dueAt?.toISOString() ?? null,
        newValue: dueAt.toISOString(),
        changedBy: `manual:${byTelegramUserId}`,
      },
    }),
  ]);
  logger.info({ itemId, from: item.dueAt, to: dueAt, by: byTelegramUserId }, "due date set manually");
  return updated;
}

/** Remove a wrong item (/remove). Removed items never show again (spec §4.4). */
export async function removeItem(itemId: number, byTelegramUserId: number) {
  const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
  if (item.status === "removed") return item;
  const [updated] = await prisma.$transaction([
    prisma.item.update({ where: { id: itemId }, data: { status: "removed" } }),
    prisma.itemChange.create({
      data: { itemId, field: "status", oldValue: item.status, newValue: "removed", changedBy: `manual:${byTelegramUserId}` },
    }),
  ]);
  logger.info({ itemId, by: byTelegramUserId }, "item removed manually");
  return updated;
}
