/**
 * #718 slice 2 (CEO, Oct 28): own-account businesses pay ₹999 a month through a payment link, never auto-debit.
 * The first month is free from the first Go live. Unpaid only pauses new ads and campaigns; running ads keep running.
 * Paid months' dates are set in SQL (`public.plan_period_paid`); this only reads them.
 */
export const PLAN_PRICE_PAISE = 99_900;
const DUE_SOON_MS = 7 * 24 * 3_600_000;

export type PlanPeriod = { kind: "free" | "paid"; state: "open" | "paid" | "expired"; startsAt: string | null; endsAt: string | null; paidAt: string | null };

export type PlanStatus =
  | { state: "exempt" }
  | { state: "trial_not_started" }
  | { state: "free" | "paid"; until: string; dueSoon: boolean }
  | { state: "unpaid"; since: string };

/** One calendar month later at the same UTC time; the 31st clamps to the last day of a shorter month. */
export function addMonth(iso: string): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString();
}

export function planStatus(input: { exempt: boolean; firstLaunchAt: string | null; periods: PlanPeriod[]; now: Date }): PlanStatus {
  if (input.exempt) return { state: "exempt" };
  if (!input.firstLaunchAt) return { state: "trial_not_started" };
  const freeUntil = addMonth(input.firstLaunchAt);
  const paidEnds = input.periods.filter((period) => period.state === "paid" && period.endsAt).map((period) => period.endsAt as string);
  const until = [freeUntil, ...paidEnds].reduce((latest, end) => (Date.parse(end) > Date.parse(latest) ? end : latest));
  const now = input.now.getTime();
  if (now > Date.parse(until)) return { state: "unpaid", since: new Date(until).toISOString() };
  return { state: until === freeUntil ? "free" : "paid", until: new Date(until).toISOString(), dueSoon: Date.parse(until) - now <= DUE_SOON_MS };
}
