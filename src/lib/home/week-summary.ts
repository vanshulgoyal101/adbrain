/**
 * #1668 (CPO, #1654): Home's Monday "last week" card. Read-only: snapshots, leads and stored per-ad results; no Meta
 * call, no AI, no WhatsApp send. A week is Monday 00:00 to Sunday 23:59 IST.
 */
const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** Last week's start and this week's start (Mondays 00:00 IST), as ISO instants. */
export function weekBounds(now: Date): { lastStart: string; thisStart: string } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const sinceMonday = (ist.getUTCDay() + 6) % 7;
  const thisStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - sinceMonday) - IST_OFFSET_MS;
  return { lastStart: new Date(thisStart - 7 * DAY_MS).toISOString(), thisStart: new Date(thisStart).toISOString() };
}

export type Snapshot = { spend: number; conversations?: number | null; whatsapp_opens?: number | null };
export type WeekDiff = { spend: number; chats: number; opens: number };

/**
 * Snapshots are cumulative and insert-only, so a campaign's week is the latest snapshot before this Monday minus the
 * latest before last Monday. A campaign that started mid-week has no earlier snapshot; it counts from 0.
 */
export function weekDiff(before: Snapshot | null, after: Snapshot | null): WeekDiff {
  if (!after) return { spend: 0, chats: 0, opens: 0 };
  const less = (value: number | null | undefined, earlier: number | null | undefined) => Math.max(0, (value ?? 0) - (earlier ?? 0));
  return {
    spend: less(after.spend, before?.spend),
    chats: less(after.conversations, before?.conversations),
    opens: less(after.whatsapp_opens, before?.whatsapp_opens),
  };
}

export type WeekSuggestion = "quick_questions" | "add_enquiries" | "run_again";
export type WeekSummary = { chats: number; enquiries: number; spend: number; bestAd: string | null; suggestion: WeekSuggestion | null };

/** Under 6 messages per 35 WhatsApp opens on a campaign with 30+ opens: few openers send the message. */
const OPENS_MIN = 30;
const SEND_RATE = 6 / 35;

/** Null when the week had no spend and no logged enquiry (nothing to say). One suggestion, first match wins. */
export function weekSummary(input: { diffs: WeekDiff[]; enquiries: number; running: boolean; bestAd: string | null }): WeekSummary | null {
  const spend = input.diffs.reduce((total, diff) => total + diff.spend, 0);
  const chats = input.diffs.reduce((total, diff) => total + diff.chats, 0);
  if (spend <= 0 && input.enquiries < 1) return null;
  // Never suggests spending more (#799).
  const suggestion: WeekSuggestion | null =
    input.diffs.some((diff) => diff.opens >= OPENS_MIN && diff.chats / diff.opens < SEND_RATE) ? "quick_questions"
      : chats > 0 && input.enquiries === 0 ? "add_enquiries"
        : !input.running ? "run_again"
          : null;
  return { chats, enquiries: input.enquiries, spend: Math.round(spend), bestAd: input.bestAd?.trim() || null, suggestion };
}

export const WEEK_SUGGESTION_HREF: Record<WeekSuggestion, string> = {
  quick_questions: "/campaigns",
  add_enquiries: "/leads",
  run_again: "/campaigns",
};

/** The `ui.action` a dismissal records (product_events); the card stays hidden for that week. */
export const WEEK_DISMISS_ACTION = "home.week_summary_dismiss";
