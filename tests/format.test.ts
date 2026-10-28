import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatClock, formatDate, formatDay, formatMoney, formatMoneyExact, formatMoneyShort, formatNumber, formatPerDay } from "@/lib/format";

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
    expect(formatDate("2026-10-24T11:00:00Z", now)).toBe("today, 4:30 pm");
    expect(formatDate("2026-10-23T11:00:00Z", now)).toBe("yesterday, 4:30 pm");
    expect(formatDate("2026-10-22T11:00:00Z", now)).toBe("22 Oct, 4:30 pm");
    expect(formatDate("2026-01-02T03:30:00Z", now)).toBe("2 Jan, 9:00 am");
    expect(formatDate("2025-10-24T11:00:00Z", now)).toBe("24 Oct 2025");
    expect(formatDate("not a date", now)).toBe("");
  });

  it("#1292: the time someone tapped an ad, in India time", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    expect(formatClock("2026-10-24T04:10:00Z", now)).toBe("9:40 am");
    expect(formatClock("2026-10-23T19:00:00Z", now)).toBe("12:30 am");
    expect(formatClock("2026-10-23T15:00:00Z", now)).toBe("8:30 pm yesterday");
    expect(formatClock("2026-10-22T11:00:00Z", now)).toBe("22 Oct, 4:30 pm");
    expect(formatClock("not a date", now)).toBe("");
  });

  it("groups counts the Indian way", () => {
    expect(formatNumber(123456)).toBe("1,23,456");
  });

  // #1290: Indian grouping at the lakh boundary, in every money format.
  it.each([
    [99_999, "₹99,999", "₹99,999", "₹99,999"],
    [1_00_000, "₹1,00,000", "₹1,00,000", "₹1 lakh"],
    [12_34_567, "₹12,34,567", "₹12,34,567", "₹12.3 lakh"],
    [1_50_00_000, "₹1,50,00,000", "₹1,50,00,000", "₹1.5 crore"],
  ])("%s rupees → %s / %s / %s", (n, money, exact, short) => {
    expect(formatMoney(n)).toBe(money);
    expect(formatMoneyExact(n)).toBe(exact);
    expect(formatMoneyShort(n)).toBe(short);
  });

  it("keeps paise only when there are some, like a receipt", () => {
    expect(formatMoneyExact(12_345.67)).toBe("₹12,345.67");
    expect(formatMoneyExact(10_000)).toBe("₹10,000");
    expect(formatMoneyExact(Number.NaN)).toBe("—");
  });

  it("turns the day over at IST midnight, not UTC", () => {
    // 18:29 UTC on 24 Oct is 23:59 IST on 24 Oct; 18:30 UTC is 00:00 IST on 25 Oct.
    const late = new Date("2026-10-24T18:29:00Z");
    expect(formatDate("2026-10-24T18:29:00Z", late)).toBe("today, 11:59 pm");
    expect(formatDate("2026-10-24T18:29:00Z", new Date("2026-10-24T18:30:00Z"))).toBe("yesterday, 11:59 pm");
    expect(formatDate("2026-10-24T18:30:00Z", new Date("2026-10-24T18:30:00Z"))).toBe("today, 12:00 am");
    expect(formatDay("2026-10-24T18:30:00Z")).toBe("25 Oct");
  });

  it("is the only place components and routes format money or time (#1290)", () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(?:ts|tsx)$/.test(name) ? [path] : [];
    });
    const offenders = [...files("src/components"), ...files("src/app")].filter((path) =>
      /\.toLocale(?:String|DateString|TimeString)\(|Intl\.(?:NumberFormat|DateTimeFormat)\(/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
