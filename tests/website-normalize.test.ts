import { describe, expect, it } from "vitest";
import { normalizeWebsite } from "@/lib/brand/validation";

// #470: owners type their domain the normal way ("vanshul.com"); we store and send a full URL.
describe("normalizeWebsite (#470)", () => {
  it.each([
    ["vanshul.com", "https://vanshul.com"],
    ["  www.vanshul.com ", "https://www.vanshul.com"],
    ["vanshul.com/solar?ref=ad", "https://vanshul.com/solar?ref=ad"],
    ["https://vanshul.com/", "https://vanshul.com/"],
    ["http://vanshul.com", "http://vanshul.com"],
    ["HTTPS://Vanshul.com", "HTTPS://Vanshul.com"],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeWebsite(raw)).toBe(expected);
  });

  it.each([null, undefined, "", "   ", "not a url", "vanshul", "javascript:alert(1)", "ftp://vanshul.com", "mailto:a@vanshul.com", "http://"])(
    "rejects %j", (raw) => {
      expect(normalizeWebsite(raw)).toBeNull();
    });
});
