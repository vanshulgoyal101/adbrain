/**
 * Timely occasion ideas for the Indian calendar (#700). Turns "today" in IST into
 * up to two one-tap Create chips (festivals, national days, seasons).
 *
 * Variable-date festivals use generous windows rather than exact lunar dates, so
 * this needs no yearly maintenance. The prompt becomes the campaign goal in the owner's
 * plain words (#1153, #1210): it never asserts a sale, discount or deadline, and the
 * server-side concept prompt and claim check let the ads use only offers saved on Brand.
 */

export interface Suggestion {
  id: string;
  label: string;
  prompt: string;
}

interface Occasion {
  id: string;
  label: string;
  /** The occasion as it reads inside a sentence. */
  name: string;
  /** Inclusive window as month*100+day (wraps across year-end when start > end). */
  startMd: number;
  endMd: number;
  /** A season yields to a festival or national day in the same window (#1210: Chhath over the wedding season). */
  season?: boolean;
}

const md = (month: number, day: number) => month * 100 + day;

/**
 * Month/day of an instant in India (Asia/Kolkata), independent of the host
 * timezone, so a UTC server and an IST owner agree on the day.
 */
function istMonthDay(now: Date): { month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "1");
  return { month: get("month"), day: get("day") };
}

/** Ordered by the calendar; the first in-window occasions win. */
export const OCCASIONS: readonly Occasion[] = [
  { id: "new-year", label: "New Year", name: "the New Year", startMd: md(12, 26), endMd: md(1, 5) },
  { id: "sankranti", label: "Makar Sankranti / Pongal / Lohri", name: "Makar Sankranti, Pongal and Lohri", startMd: md(1, 6), endMd: md(1, 16) },
  { id: "republic-day", label: "Republic Day", name: "Republic Day", startMd: md(1, 18), endMd: md(1, 26) },
  { id: "valentines", label: "Valentine's Day", name: "Valentine's Day", startMd: md(2, 5), endMd: md(2, 14) },
  { id: "holi", label: "Holi", name: "Holi", startMd: md(2, 25), endMd: md(3, 22) },
  { id: "summer", label: "Summer season", name: "the summer season", startMd: md(4, 15), endMd: md(5, 24), season: true },
  { id: "back-to-school", label: "Back to school", name: "the back-to-school season", startMd: md(5, 25), endMd: md(6, 20), season: true },
  { id: "monsoon", label: "Monsoon season", name: "the monsoon season", startMd: md(6, 21), endMd: md(8, 5), season: true },
  { id: "independence-day", label: "Independence Day", name: "Independence Day", startMd: md(8, 8), endMd: md(8, 15) },
  { id: "festive", label: "Diwali festive season", name: "the Diwali festive season", startMd: md(9, 25), endMd: md(11, 15) },
  // #1210: Chhath falls six days after Diwali (Oct 23 2028 to Nov 15 2026); Guru Nanak Jayanti on Kartik Purnima (Nov 2 to Nov 24).
  { id: "chhath", label: "Chhath Puja", name: "Chhath Puja", startMd: md(10, 20), endMd: md(11, 18) },
  { id: "gurpurab", label: "Guru Nanak Jayanti", name: "Guru Nanak Jayanti", startMd: md(10, 28), endMd: md(11, 25) },
  { id: "wedding", label: "Wedding season", name: "the wedding season", startMd: md(11, 16), endMd: md(2, 6), season: true },
  { id: "winter", label: "Winter season", name: "the winter season", startMd: md(11, 20), endMd: md(1, 31), season: true },
  { id: "christmas", label: "Christmas", name: "Christmas", startMd: md(12, 15), endMd: md(12, 25) },
];

function inWindow(todayMd: number, startMd: number, endMd: number): boolean {
  return startMd <= endMd
    ? todayMd >= startMd && todayMd <= endMd
    : todayMd >= startMd || todayMd <= endMd; // wraps across year-end
}

/** Up to `max` occasions in season today (IST), as one-tap goals for `brandName`. */
export function occasionIdeas(brandName: string, now: Date = new Date(), max = 2): Suggestion[] {
  const { month, day } = istMonthDay(now);
  const today = md(month, day);
  const brand = brandName.trim().slice(0, 120) || "my business";
  const inSeason = OCCASIONS.filter((o) => inWindow(today, o.startMd, o.endMd));
  return [...inSeason.filter((o) => !o.season), ...inSeason.filter((o) => o.season)]
    .slice(0, max)
    .map((o) => ({
      id: `occasion-${o.id}`,
      label: o.label,
      prompt: `An ad for ${o.name} from ${brand}.`,
    }));
}
