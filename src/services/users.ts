import type { User as TgUser } from "grammy/types";
import { prisma } from "../db.js";

export async function upsertUser(from: TgUser, opts: { dmOptIn?: boolean } = {}) {
  return prisma.user.upsert({
    where: { telegramUserId: BigInt(from.id) },
    create: {
      telegramUserId: BigInt(from.id),
      firstName: from.first_name,
      dmOptIn: opts.dmOptIn ?? false,
    },
    update: {
      firstName: from.first_name,
      ...(opts.dmOptIn !== undefined ? { dmOptIn: opts.dmOptIn } : {}),
    },
  });
}

/** Record that a user is in a group. Never downgrades an existing editor/admin role. */
export async function ensureMember(userId: number, groupId: number) {
  return prisma.groupMember.upsert({
    where: { userId_groupId: { userId, groupId } },
    create: { userId, groupId, role: "member" },
    update: {},
  });
}
