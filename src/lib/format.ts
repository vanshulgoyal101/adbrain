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

/** "₹280 a day". */
export function formatPerDay(rupees: number): string {
  return `${formatMoney(rupees)} a day`;
}

/** "1,23,456". */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat(LOCALE).format(n);
}

const parts = (d: Date, options: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, ...options }).formatToParts(d).map((p) => [p.type, p.value]));

/** "24 Oct, 4:30 pm" this year; "24 Oct 2025" for earlier years. "" for an invalid date. */
export function formatDate(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const p = parts(d, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  if (p.year !== parts(now, { year: "numeric" }).year) return `${p.day} ${p.month} ${p.year}`;
  return `${p.day} ${p.month}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()}`;
}
