import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatNumber, formatPerDay } from "@/lib/format";

describe("formats (#403 S2)", () => {
  it.each([
    [10_000, "₹10,000"], [280, "₹280"], [412.4, "₹412"], [1_25_000.6, "₹1,25,001"], [68.73, "₹68.73"], [7.776, "₹7.78"],
    [0, "₹0"], [50, "₹50"], [99.999, "₹100"], [Number.NaN, "—"],
  ])("formatMoney(%s) → %s", (n, text) => expect(formatMoney(n)).toBe(text));

  it("writes a daily budget the way owners say it", () => {
    expect(formatPerDay(280)).toBe("₹280 a day");
  });

  it("dates this year with the time, earlier years with the year, always in India time", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    expect(formatDate("2026-10-24T11:00:00Z", now)).toBe("24 Oct, 4:30 pm");
    expect(formatDate("2026-01-02T03:30:00Z", now)).toBe("2 Jan, 9:00 am");
    expect(formatDate("2025-10-24T11:00:00Z", now)).toBe("24 Oct 2025");
    expect(formatDate("not a date", now)).toBe("");
  });

  it("groups counts the Indian way", () => {
    expect(formatNumber(123456)).toBe("1,23,456");
  });
});
