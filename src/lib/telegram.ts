import type { Message, MessageEntity } from "grammy/types";

/** Telegram's account that represents anonymous group admins. */
export const GROUP_ANONYMOUS_BOT_ID = 1087968824;

export type AttachmentInfo = {
  hasFile: boolean;
  fileType: string | null;
  fileName: string | null;
  mimeType: string | null;
};

export function attachmentInfo(msg: Message): AttachmentInfo {
  const none = { hasFile: false, fileType: null, fileName: null, mimeType: null };
  if (msg.document)
    return {
      hasFile: true,
      fileType: "document",
      fileName: msg.document.file_name ?? null,
      mimeType: msg.document.mime_type ?? null,
    };
  if (msg.photo) return { ...none, hasFile: true, fileType: "photo" };
  if (msg.video)
    return { hasFile: true, fileType: "video", fileName: msg.video.file_name ?? null, mimeType: msg.video.mime_type ?? null };
  if (msg.audio)
    return { hasFile: true, fileType: "audio", fileName: msg.audio.file_name ?? null, mimeType: msg.audio.mime_type ?? null };
  if (msg.voice) return { ...none, hasFile: true, fileType: "voice", mimeType: msg.voice.mime_type ?? null };
  if (msg.video_note) return { ...none, hasFile: true, fileType: "video_note" };
  if (msg.animation)
    return {
      hasFile: true,
      fileType: "animation",
      fileName: msg.animation.file_name ?? null,
      mimeType: msg.animation.mime_type ?? null,
    };
  if (msg.sticker) return { ...none, hasFile: true, fileType: "sticker" };
  return none;
}

/** All URLs in a text, including hidden text_link entities. De-duplicated, in order. */
export function extractLinks(text: string | undefined, entities: MessageEntity[] | undefined): string[] {
  if (!text || !entities) return [];
  const out: string[] = [];
  for (const e of entities) {
    if (e.type === "url") out.push(text.slice(e.offset, e.offset + e.length));
    else if (e.type === "text_link") out.push(e.url);
  }
  return [...new Set(out)];
}

/** Text and links of a message, whether it's a text message or a captioned file. */
export function messageContent(msg: Message): { text: string | null; links: string[] } {
  const text = msg.text ?? msg.caption;
  const entities = msg.text !== undefined ? msg.entities : msg.caption_entities;
  return { text: text ?? null, links: extractLinks(text, entities) };
}

/** True if the message starts with a /command. */
export function isBotCommand(msg: Message): boolean {
  return msg.entities?.some((e) => e.type === "bot_command" && e.offset === 0) ?? false;
}

/**
 * Forum thread the message belongs to, or null for General / non-forum groups.
 * Non-forum groups can also carry message_thread_id for reply threads; that isn't a topic.
 */
export function topicThreadId(msg: Message): number | null {
  return msg.is_topic_message && msg.message_thread_id ? msg.message_thread_id : null;
}

/**
 * The message this one replies to, ignoring Telegram's implicit "reply" to the topic's
 * creation message, which every message in a forum topic carries.
 */
export function realReplyToId(msg: Message): number | null {
  const reply = msg.reply_to_message;
  if (!reply) return null;
  if (msg.is_topic_message && reply.message_id === msg.message_thread_id) return null;
  return reply.message_id;
}
