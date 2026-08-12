import { describe, expect, it } from "vitest";
import { cn, formatCurrency, formatNumber, timeAgo } from "@/lib/utils";

describe("cn", () => {
  it("merges class names and resolves tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", false, null, undefined, "font-bold")).toBe(
      "text-sm font-bold",
    );
  });
});

describe("formatNumber", () => {
  it("adds Indian-locale separators", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(100000)).toBe("1,00,000");
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatCurrency", () => {
  it("formats whole rupees with no decimals", () => {
    const out = formatCurrency(1500);
    expect(out).toContain("1,500");
    expect(out).toMatch(/₹|INR/);
    expect(out).not.toContain(".00");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-08-12T12:00:00Z");
  it("says just now under 45s", () => {
    expect(timeAgo(new Date("2026-08-12T11:59:30Z"), now)).toBe("just now");
  });
  it("formats minutes, hours, and days", () => {
    expect(timeAgo(new Date("2026-08-12T11:55:00Z"), now)).toBe("5m ago");
    expect(timeAgo(new Date("2026-08-12T10:00:00Z"), now)).toBe("2h ago");
    expect(timeAgo(new Date("2026-08-09T12:00:00Z"), now)).toBe("3d ago");
  });
  it("never shows negative time for a future date", () => {
    expect(timeAgo(new Date("2026-08-12T12:00:30Z"), now)).toBe("just now");
  });
});
