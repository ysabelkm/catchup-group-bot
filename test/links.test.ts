import { describe, expect, it } from "vitest";
import { messageLink } from "../src/lib/links.js";

describe("messageLink", () => {
  it("builds a topic link for forum messages", () => {
    expect(messageLink(-1001234567890n, 42, 7)).toBe("https://t.me/c/1234567890/7/42");
  });

  it("builds a plain link for non-topic supergroups", () => {
    expect(messageLink(-1001234567890n, 42)).toBe("https://t.me/c/1234567890/42");
    expect(messageLink("-1001234567890", 42, null)).toBe("https://t.me/c/1234567890/42");
  });

  it("returns null for basic groups, which have no message links", () => {
    expect(messageLink(-123456789, 42)).toBeNull();
  });
});
