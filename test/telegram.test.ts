import { describe, expect, it } from "vitest";
import type { Message } from "grammy/types";
import { attachmentInfo, extractLinks, isBotCommand, messageContent, realReplyToId, topicThreadId } from "../src/lib/telegram.js";

const base = { message_id: 10, date: 0, chat: { id: -1001, type: "supergroup", title: "CSC 400L" } } as const;
const msg = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as unknown as Message;

describe("extractLinks", () => {
  it("finds plain URLs and hidden text_link URLs", () => {
    const text = "Slides here https://x.com/a and click me";
    const links = extractLinks(text, [
      { type: "url", offset: 12, length: 15 },
      { type: "text_link", offset: 32, length: 8, url: "https://drive.google.com/b" },
    ]);
    expect(links).toEqual(["https://x.com/a", "https://drive.google.com/b"]);
  });

  it("returns nothing without entities", () => {
    expect(extractLinks("no links", undefined)).toEqual([]);
  });
});

describe("messageContent", () => {
  it("uses the caption for files", () => {
    const m = msg({ caption: "HCI week 9 slides", document: { file_id: "f", file_unique_id: "u", file_name: "hci-w9.pdf" } });
    expect(messageContent(m).text).toBe("HCI week 9 slides");
    expect(attachmentInfo(m)).toEqual({ hasFile: true, fileType: "document", fileName: "hci-w9.pdf", mimeType: null });
  });
});

describe("topics and replies", () => {
  it("treats the implicit reply to the topic root as no reply", () => {
    const m = msg({ is_topic_message: true, message_thread_id: 5, reply_to_message: { ...base, message_id: 5 } });
    expect(topicThreadId(m)).toBe(5);
    expect(realReplyToId(m)).toBeNull();
  });

  it("keeps real replies inside a topic", () => {
    const m = msg({ is_topic_message: true, message_thread_id: 5, reply_to_message: { ...base, message_id: 8 } });
    expect(realReplyToId(m)).toBe(8);
  });

  it("ignores reply threads in non-forum groups", () => {
    const m = msg({ message_thread_id: 3, reply_to_message: { ...base, message_id: 3 } });
    expect(topicThreadId(m)).toBeNull();
    expect(realReplyToId(m)).toBe(3);
  });
});

describe("isBotCommand", () => {
  it("detects a leading command", () => {
    expect(isBotCommand(msg({ text: "/setup", entities: [{ type: "bot_command", offset: 0, length: 6 }] }))).toBe(true);
    expect(isBotCommand(msg({ text: "submit by Friday" }))).toBe(false);
  });
});
