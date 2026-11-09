import type { Context } from "grammy";
import { prisma } from "../db.js";
import { isGroupAdmin } from "../lib/permissions.js";

/**
 * Admins and class reps (trusted editors) can correct due dates and remove items
 * (spec §4.6, decided 9 Nov 2026). Admin status is checked live; editors are stored.
 */
export async function canEdit(ctx: Context, groupId: number): Promise<boolean> {
  if (await isGroupAdmin(ctx)) return true;
  if (!ctx.from) return false;
  const member = await prisma.groupMember.findFirst({
    where: { groupId, role: { in: ["editor", "admin"] }, user: { telegramUserId: BigInt(ctx.from.id) } },
  });
  return member !== null;
}
