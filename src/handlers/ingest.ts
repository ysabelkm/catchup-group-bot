import { Composer } from "grammy";
import type { Message } from "grammy/types";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { ensureTopic, isGroupChat, migrateGroup, upsertGroup, upsertTopic } from "../services/groups.js";
import { ensureMember, upsertUser } from "../services/users.js";
import { attachmentInfo, isBotCommand, messageContent, realReplyToId, topicThreadId } from "../lib/telegram.js";
import { processMessage } from "../extraction/pipeline.js";
import { retentionCutoff } from "../services/retention.js";

/**
 * Stores every group message from every topic (spec §4.1).
 * Extraction runs later from the stored rows (processedAt = null).
 */
export const ingest = new Composer();

const groups = ingest.filter((ctx) => isGroupChat(ctx.chat));

// --- Group migration (spec §5.4) -------------------------------------------------------
groups.on("message:migrate_to_chat_id", async (ctx) => {
  await migrateGroup(ctx.chat.id, ctx.msg.migrate_to_chat_id);
});
groups.on("message:migrate_from_chat_id", async (ctx) => {
  await migrateGroup(ctx.msg.migrate_from_chat_id, ctx.chat.id);
});

// --- New and edited messages -----------------------------------------------------------
groups.on("message", async (ctx, next) => {
  await storeMessage(ctx.msg);
  await next(); // let command handlers run too
});

groups.on("edited_message", async (ctx) => {
  await storeMessage(ctx.editedMessage, { edited: true });
});

async function storeMessage(msg: Message, opts: { edited?: boolean } = {}) {
  if (!isGroupChat(msg.chat)) return;
  // An edit to a message past the retention limit would bring its wiped text back.
  if (opts.edited && new Date(msg.date * 1000) < retentionCutoff()) return;
  const group = await upsertGroup(msg.chat);

  // Topic names only arrive via service messages, so learn them wherever we can.
  if (msg.forum_topic_created) {
    await upsertTopic(group.id, msg.message_thread_id ?? msg.message_id, msg.forum_topic_created.name);
    return;
  }
  if (msg.forum_topic_edited) {
    if (msg.forum_topic_edited.name && msg.message_thread_id)
      await upsertTopic(group.id, msg.message_thread_id, msg.forum_topic_edited.name);
    return;
  }

  const threadId = topicThreadId(msg);
  let topicId: number | null = null;
  if (threadId) {
    // Messages in a topic "reply" to the topic's creation message, which carries its name.
    const rootName = msg.reply_to_message?.forum_topic_created?.name;
    const topic = rootName ? await upsertTopic(group.id, threadId, rootName) : await ensureTopic(group.id, threadId);
    topicId = topic.id;
  }

  // Other service messages (joins, pins, title changes…) and commands carry no academic content.
  const { text, links } = messageContent(msg);
  const attachment = attachmentInfo(msg);
  if (!text && !attachment.hasFile) return;
  if (isBotCommand(msg)) return;

  let senderId: number | null = null;
  if (msg.from && !msg.from.is_bot) {
    const user = await upsertUser(msg.from);
    await ensureMember(user.id, group.id);
    senderId = user.id;
  }

  const data = {
    topicId,
    senderId,
    sentAt: new Date(msg.date * 1000),
    text,
    links,
    replyToMessageId: realReplyToId(msg),
    ...attachment,
  };

  const stored = await prisma.message.upsert({
    where: { groupId_telegramMessageId: { groupId: group.id, telegramMessageId: msg.message_id } },
    create: {
      groupId: group.id,
      telegramMessageId: msg.message_id,
      ...data,
      editedAt: opts.edited && msg.edit_date ? new Date(msg.edit_date * 1000) : null,
    },
    // On a re-delivered update this rewrites the same values. On an edit it stores the new
    // text and clears processedAt so extraction runs again for this message.
    update: opts.edited
      ? { ...data, editedAt: msg.edit_date ? new Date(msg.edit_date * 1000) : new Date(), processedAt: null }
      : {},
  });

  logger.debug({ chatId: msg.chat.id, messageId: msg.message_id, threadId, edited: !!opts.edited }, "message stored");

  // Rule-based extraction is cheap, so run it straight away. If it fails, the message stays
  // unprocessed and the daily job picks it up (processPending).
  try {
    await processMessage(stored.id);
  } catch (err) {
    logger.error({ err, messageId: stored.id }, "extraction failed; will retry in the daily run");
  }
}
