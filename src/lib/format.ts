/**
 * The one place AdBrain formats money, dates and counts for owners (#403 S2).
 * Fixed locale and timezone, so the server and the browser render the same string.
 */

const LOCALE = "en-IN";
const TIME_ZONE = "Asia/Kolkata";

const wholeRupees = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const withPaise = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "₹10,000"; amounts under ₹100 keep their paise ("₹7.78", "₹68.73") because they matter there. */
export function formatMoney(rupees: number): string {
  if (!Number.isFinite(rupees)) return "—";
  const rounded = Math.round(rupees * 100) / 100;
  return Math.abs(rounded) < 100 && !Number.isInteger(rounded) ? withPaise.format(rounded) : wholeRupees.format(Math.round(rounded));
}

/** #1290: exact like a receipt, but no ".00" on whole rupees ("₹10,000", "₹12,345.67"). */
export function formatMoneyExact(rupees: number): string {
  if (!Number.isFinite(rupees)) return "—";
  const rounded = Math.round(rupees * 100) / 100;
  return Number.isInteger(rounded) ? wholeRupees.format(rounded) : withPaise.format(rounded);
}

/** #1290: large amounts the way owners say them ("₹12.3 lakh", "₹1.5 crore"); under ₹1 lakh as formatMoney. */
export function formatMoneyShort(rupees: number): string {
  if (!Number.isFinite(rupees)) return "—";
  const size = Math.abs(rupees);
  const unit = size >= 1_00_00_000 ? [1_00_00_000, "crore"] as const : size >= 1_00_000 ? [1_00_000, "lakh"] as const : null;
  if (!unit) return formatMoney(rupees);
  const value = Math.round((rupees / unit[0]) * 10) / 10;
  return `₹${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(value)} ${unit[1]}`;
}

/** "₹280 a day". */
export function formatPerDay(rupees: number): string {
  return `${formatMoney(rupees)} a day`;
}

/** "1,23,456". */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat(LOCALE).format(n);
}

const parts = (d: Date, options: Intl.DateTimeFormatOptions, locale = LOCALE) =>
  Object.fromEntries(new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, ...options }).formatToParts(d).map((p) => [p.type, p.value]));

const istDay = (d: Date) => { const p = parts(d, { day: "numeric", month: "numeric", year: "numeric" }); return `${p.year}-${p.month}-${p.day}`; };

/**
 * "today, 9:40 am" and "yesterday, 9:40 am" by the India calendar day (#1290); "24 Oct, 4:30 pm" otherwise
 * this year; "24 Oct 2025" for earlier years. "" for an invalid date.
 */
export function formatDate(date: Date | string, now: Date = new Date(), language: "en" | "hi" = "en"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  // #1877: Hindi month names and day words, with Latin digits like the rest of Home.
  const p = parts(d, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, numberingSystem: "latn" }, language === "hi" ? "hi-IN" : LOCALE);
  if (p.year !== parts(now, { year: "numeric" }).year) return `${p.day} ${p.month} ${p.year}`;
  const time = `${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()}`;
  if (istDay(d) === istDay(now)) return `${language === "hi" ? "आज" : "today"}, ${time}`;
  if (istDay(d) === istDay(new Date(now.getTime() - 86_400_000))) return `${language === "hi" ? "कल" : "yesterday"}, ${time}`;
  return `${p.day} ${p.month}, ${time}`;
}

/** #1292: "9:40 am" today, "9:40 pm yesterday", otherwise "24 Oct, 9:40 am", for "tapped your ad at …". */
export function formatClock(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const p = parts(d, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
  const time = `${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()}`;
  if (istDay(d) === istDay(now)) return time;
  if (istDay(d) === istDay(new Date(now.getTime() - 86_400_000))) return `${time} yesterday`;
  return `${p.day} ${p.month}, ${time}`;
}

/** #1290: a day without the time ("24 Oct"), by the India calendar. "" for an invalid date. */
export function formatDay(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const p = parts(d, { day: "numeric", month: "short" });
  return `${p.day} ${p.month}`;
}
