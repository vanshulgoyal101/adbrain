import { describe, expect, it } from "vitest";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

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
