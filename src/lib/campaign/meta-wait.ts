import { durationIn } from "@/i18n/duration";

/**
 * #1838 slice 2b: the owner's words while Meta limits how often AdBrain can check (CPO on #1838 and #1870). Shown
 * only while the wait is in the future; nothing when it clears. Never "error", "rate limit" or "throttled".
 */
export function throttleActive(until: string | null | undefined, now = new Date()): until is string {
  return Boolean(until && Date.parse(until) > now.getTime());
}

/** How old a reading is, for "up to {age} old". */
export function ageMs(iso: string, now = Date.now()): number {
  return Math.max(0, now - Date.parse(iso));
}

/** The campaign card, under "Updated … ago" (Home has the same line in messages `home.metaWaiting`). */
export function resultsWaitLine(ageMs: number): string {
  return `Meta is limiting how often we can check right now, so these numbers may be up to ${durationIn("en", ageMs)} old. Your ads keep running, and pausing still works.`;
}

/** Enquiries, under "Updated … ago · Check now". */
export function enquiriesWaitLine(ageMs: number): string {
  return `Meta is limiting how often we can check right now. New form enquiries may show up to ${durationIn("en", ageMs)} late; WhatsApp chats still reach your phone as usual.`;
}

/** A tap on Check now while Meta asked us to wait; nothing is sent. */
export function checkLaterLine(until: string): string {
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(until));
  return `Meta asked us to wait. We'll check again at ${time}.`;
}
