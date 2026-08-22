/**
 * Timely campaign ideas for the Indian calendar. Turns "today" into a couple of
 * seasonal ad prompts (festivals, national days, shopping seasons) plus a few
 * evergreen ones, so a non-technical owner can one-tap a relevant campaign.
 *
 * Pure and industry-agnostic — the label is the chip, the prompt seeds the goal.
 * Variable-date festivals use sensible windows rather than exact lunar dates so
 * this needs no yearly maintenance and never shows a stale suggestion.
 */

export interface Suggestion {
  label: string;
  prompt: string;
}

interface Occasion {
  label: string;
  prompt: string;
  /** Inclusive window as month*100+day (wraps across year-end when start > end). */
  startMd: number;
  endMd: number;
}

const md = (month: number, day: number) => month * 100 + day;

/**
 * Month/day of an instant in India (Asia/Kolkata), independent of the host
 * timezone. This keeps the result identical on a UTC server and an IST client,
 * so the rendered suggestions never mismatch during hydration.
 */
function istMonthDay(now: Date): { month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? "1");
  return { month: get("month"), day: get("day") };
}

/** Timely occasions, ordered by the calendar. */
const OCCASIONS: Occasion[] = [
  { label: "New Year offer", prompt: "A New Year offer for my business", startMd: md(12, 26), endMd: md(1, 5) },
  { label: "Sankranti / Pongal offer", prompt: "A Makar Sankranti / Pongal offer ad", startMd: md(1, 8), endMd: md(1, 16) },
  { label: "Republic Day sale", prompt: "A Republic Day sale ad", startMd: md(1, 20), endMd: md(1, 26) },
  { label: "Valentine's offer", prompt: "A Valentine's Day offer ad", startMd: md(2, 7), endMd: md(2, 14) },
  { label: "Holi offer", prompt: "A Holi festival offer ad", startMd: md(3, 1), endMd: md(3, 20) },
  { label: "Summer sale", prompt: "A summer sale ad for my business", startMd: md(4, 15), endMd: md(6, 15) },
  { label: "Monsoon offer", prompt: "A monsoon-season offer ad", startMd: md(6, 20), endMd: md(8, 5) },
  { label: "Independence Day sale", prompt: "An Independence Day sale ad", startMd: md(8, 8), endMd: md(8, 15) },
  { label: "Festive-season (Diwali) offer", prompt: "A festive-season Diwali offer for my business", startMd: md(9, 25), endMd: md(11, 15) },
  { label: "Wedding-season offer", prompt: "A wedding-season offer ad", startMd: md(11, 16), endMd: md(2, 6) },
  { label: "Year-end clearance", prompt: "A year-end clearance sale ad", startMd: md(12, 15), endMd: md(12, 31) },
];

const EVERGREEN: Suggestion[] = [
  { label: "Weekend discount", prompt: "A weekend discount offer for my business" },
  { label: "New-customer offer", prompt: "A first-time customer offer ad" },
  { label: "Limited-time deal", prompt: "A limited-time offer ad to drive urgency" },
];

function inWindow(todayMd: number, startMd: number, endMd: number): boolean {
  return startMd <= endMd
    ? todayMd >= startMd && todayMd <= endMd
    : todayMd >= startMd || todayMd <= endMd; // wraps across year-end
}

/**
 * Up to `max` suggestions: any in-season occasions first (calendar order),
 * topped up with evergreen ideas. Labels are unique.
 */
export function seasonalSuggestions(now: Date = new Date(), max = 3): Suggestion[] {
  const { month, day } = istMonthDay(now);
  const today = md(month, day);
  const timely: Suggestion[] = OCCASIONS.filter((o) =>
    inWindow(today, o.startMd, o.endMd),
  ).map(({ label, prompt }) => ({ label, prompt }));

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const s of [...timely, ...EVERGREEN]) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
