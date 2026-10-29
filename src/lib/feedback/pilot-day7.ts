/**
 * #1650 (CPO #1644): one structured answer per pilot to "would you pay ₹999 a month?", asked on Home after the
 * first week, for the pricing call (#718). Stored as product events (codes only, no free text): `pilot_day7` with
 * `{answer, reason, days}`, and `pilot_day7.dismissed` for each 'Not now'.
 */
export const PILOT_DAY7_EVENT = "pilot_day7";
export const PILOT_DAY7_DISMISSED = "pilot_day7.dismissed";

export const PILOT_DAY7_ANSWERS = ["yes", "maybe", "no"] as const;
export type PilotDay7Answer = (typeof PILOT_DAY7_ANSWERS)[number];
const NOT_YET = ["few_enquiries", "too_expensive", "hard_to_use", "prefer_meta", "other"] as const;
export const PILOT_DAY7_REASONS = {
  yes: ["brings_enquiries", "saves_time", "sees_cost"],
  maybe: NOT_YET,
  no: NOT_YET,
} as const satisfies Record<PilotDay7Answer, readonly string[]>;
export type PilotDay7Reason = (typeof PILOT_DAY7_REASONS)[PilotDay7Answer][number];

const DAY_MS = 86_400_000;
const FIRST_ASK_DAYS = 7;
const SNOOZE_DAYS = 3;
const MAX_SHOWS = 2;

export function pilotDay7Visible({ exempt, firstLaunchAt, events, now }: {
  exempt: boolean;
  firstLaunchAt: string | null;
  events: { name: string; created_at: string }[];
  now: Date;
}): boolean {
  if (exempt || !firstLaunchAt) return false;
  if (now.getTime() - Date.parse(firstLaunchAt) < FIRST_ASK_DAYS * DAY_MS) return false;
  if (events.some((event) => event.name === PILOT_DAY7_EVENT)) return false;
  const dismissals = events.filter((event) => event.name === PILOT_DAY7_DISMISSED).map((event) => Date.parse(event.created_at));
  if (dismissals.length >= MAX_SHOWS) return false;
  return !dismissals.length || now.getTime() - Math.max(...dismissals) >= SNOOZE_DAYS * DAY_MS;
}

/** Whole days since the first Go live, for the answer's `days`. */
export const daysSinceLaunch = (firstLaunchAt: string, now: Date) => Math.max(0, Math.floor((now.getTime() - Date.parse(firstLaunchAt)) / DAY_MS));
