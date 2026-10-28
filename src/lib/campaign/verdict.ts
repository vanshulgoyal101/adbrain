import type { PauseSuggestion } from "@/lib/campaign/ad-pause";

/**
 * #1255 (#1226 workstream 2): what an owner should understand about a campaign in 3 seconds: one sentence, one
 * number, at most one action. Fixed rules, no AI, first match wins (CPO's thresholds on #1255). Pure: the card and
 * Home pass in what's already stored; nothing here reads or changes a campaign, and no action raises a budget or
 * changes targeting (CEO money rule).
 */
export const EVIDENCE_MIN_RESULTS = 5;
export const EVIDENCE_MIN_SPEND = 500;
export const NO_RESULTS_MIN_SPEND = 300;
/** The Analyst's gates (#1255, Oct 28): compare only with ≥ 20 results behind the typical cost; quote a range from 30. */
export const COMPARE_MIN_RESULTS = 20;
export const RANGE_MIN_RESULTS = 30;
/** Bands around the typical cost, wide because n = 20 is only ±40–55%. */
export const COSTLY_RATIO = 1.5;
export const CHEAPER_RATIO = 0.67;
export const OPENS_WORTH_MENTIONING = 10;
const DAY_MS = 86_400_000;

/**
 * What a campaign's ₹ per result is compared with: AdBrain's own runs in the same category and destination (#588 ledger,
 * pooled; `typical` is their median ₹/result, `low`–`high` the interquartile range of the runs' ₹/result), or the owner's
 * last campaign. Either counts only with enough results behind it (COMPARE_MIN_RESULTS).
 */
export type Comparison =
  | { kind: "category"; category: string; results: number; typical: number; low?: number; high?: number }
  | { kind: "own"; results: number; typical: number };

export type VerdictInput = {
  destination: "whatsapp" | "instant_form";
  status: "active" | "paused" | "completed" | string;
  /** When the campaign was last turned on (ISO); null when unknown. */
  liveSince: string | null;
  impressions: number;
  results: number;
  /** Rupees spent, lifetime. */
  spend: number;
  /** WhatsApp opens (people who tapped through); null for forms or when Meta doesn't report it. */
  opens: number | null;
  /** Enquiries AdBrain can see that nobody has contacted yet, from the last 24 h (form leads and logged chats). */
  waiting: number;
  /** #1045's weak-ad rule, already evaluated on the card's per-ad results. */
  weakAd: PauseSuggestion | null;
  comparison: Comparison | null;
  now: number;
};

export type VerdictState =
  | "weak_ad" | "no_results" | "not_showing" | "not_showing_day" | "early" | "costly" | "about_average" | "working" | "measured"
  | "ended_worked" | "ended_costly" | "ended_measured" | "ended_too_few";
export type VerdictAction = "reply" | "pause_ad" | "edit_message" | "meta_status" | "new_ads" | "run_again";

export type Verdict = {
  state: VerdictState;
  /** The row's one-word verdict on lists (CPO: Working · About average · Costly · Early days · Not showing yet · No chats yet · Ended). */
  label: string;
  sentence: string;
  /** The one number: ₹ per result once there's a result, else the count. */
  number: { kind: "cost"; value: number } | { kind: "count"; value: number };
  action: VerdictAction | null;
};

const rupees = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

export function verdict(input: VerdictInput): Verdict {
  const chat = input.destination === "whatsapp" ? "chat" : "enquiry";
  const chats = (n: number) => `${n} ${n === 1 ? chat : input.destination === "whatsapp" ? "chats" : "enquiries"}`;
  const noChats = input.destination === "whatsapp" ? "no chats" : "no enquiries";
  const cost = input.results > 0 ? input.spend / input.results : null;
  const number: Verdict["number"] = cost === null ? { kind: "count", value: input.results } : { kind: "cost", value: Math.round(cost) };
  const evidence = input.results >= EVIDENCE_MIN_RESULTS && input.spend >= EVIDENCE_MIN_SPEND;
  const comparison = input.comparison && input.comparison.results >= COMPARE_MIN_RESULTS && input.comparison.typical > 0 ? input.comparison : null;
  const typical = comparison?.typical ?? null;
  const band = cost === null || typical === null ? null : cost > COSTLY_RATIO * typical ? "more than" : cost < CHEAPER_RATIO * typical ? "less than" : "about the same as";
  const against = (word: "less than" | "about the same as" | "more than") => !comparison ? ""
    : comparison.kind === "own" ? `, ${word} your last campaign (${rupees(comparison.typical)} each)`
      : comparison.results >= RANGE_MIN_RESULTS && comparison.low !== undefined && comparison.high !== undefined
        ? `, ${word} usual for ${comparison.category} ads AdBrain has run (${rupees(comparison.low)}–${Math.round(comparison.high).toLocaleString("en-IN")})`
        : `, ${word} usual for ${comparison.category} ads AdBrain has run (about ${rupees(comparison.typical)} each)`;

  const base = ((): Omit<Verdict, "number"> => {
    if (input.status === "completed") {
      if (!evidence) return { state: "ended_too_few", label: "Ended", sentence: `It ended with ${chats(input.results)}, too few to judge.`, action: null };
      if (band === null) {
        return { state: "ended_measured", label: "Ended", sentence: `It ended with ${chats(input.results)} at ${rupees(cost!)} each. Run it again with the best ad first?`, action: "run_again" };
      }
      if (band !== "more than") {
        return { state: "ended_worked", label: "Ended", sentence: `It worked: ${chats(input.results)} at ${rupees(cost!)} each. Run it again with the best ad first?`, action: "run_again" };
      }
      return { state: "ended_costly", label: "Ended", sentence: `It didn't bring ${input.destination === "whatsapp" ? "chats" : "enquiries"} at a good price. Try new ads?`, action: "new_ads" };
    }
    if (input.weakAd) {
      const { ad, reference } = input.weakAd;
      const sentence = ad.costPerResult !== null && reference.costPerResult
        ? `One ad costs ${Math.round(ad.costPerResult / reference.costPerResult)} times as much per ${chat} as your others. Pausing it leaves more of your budget for the ones that work.`
        : `One ad has spent ${rupees(ad.spend)} with ${noChats} while your others bring them. Pausing it leaves more of your budget for the ones that work.`;
      return { state: "weak_ad", label: "Costly", sentence, action: "pause_ad" };
    }
    if (input.results === 0 && input.spend >= Math.max(NO_RESULTS_MIN_SPEND, COSTLY_RATIO * (typical ?? 0))) {
      const opens = input.destination === "whatsapp" && (input.opens ?? 0) >= OPENS_WORTH_MENTIONING
        ? ` ${input.opens} people opened WhatsApp but didn't send the message.` : "";
      return { state: "no_results", label: input.destination === "whatsapp" ? "No chats yet" : "No enquiries yet",
        sentence: `${rupees(input.spend)} spent, ${noChats} yet.${opens}`, action: input.destination === "whatsapp" ? "edit_message" : null };
    }
    // Only a running campaign is waiting on Meta; a paused one that never showed says so on its card (#173).
    if (input.impressions === 0 && input.status === "active") {
      const since = input.liveSince ? Date.parse(input.liveSince) : Number.NaN;
      if (Number.isFinite(since) && input.now - since >= DAY_MS) {
        return { state: "not_showing_day", label: "Not showing yet", sentence: "Your ads haven't started showing after a day. Check what Meta says.", action: "meta_status" };
      }
      return { state: "not_showing", label: "Not showing yet", sentence: "Meta is checking your ads. They usually start showing within a day.", action: null };
    }
    if (!evidence) {
      return { state: "early", label: "Early days", action: null, sentence: input.results
        ? `Early days: ${chats(input.results)} so far. AdBrain will tell you if it's working after ${EVIDENCE_MIN_RESULTS}.`
        : `Early days: ${noChats} yet.` };
    }
    // No comparison with enough results behind it: the number only, and no word on whether that's good (#1255 gates).
    if (band === null) return { state: "measured", label: "Live", action: null, sentence: `Each ${chat} costs ${rupees(cost!)}.` };
    if (band === "less than") return { state: "working", label: "Working", action: null, sentence: `Working: each ${chat} costs ${rupees(cost!)}${against("less than")}.` };
    if (band === "about the same as") return { state: "about_average", label: "About average", action: null, sentence: `Each ${chat} costs ${rupees(cost!)}${against("about the same as")}.` };
    return { state: "costly", label: "Costly", action: "new_ads", sentence: `Each ${chat} costs ${rupees(cost!)}${against("more than")}.` };
  })();

  // State 1 prefixes any state; its action wins only where the state has none (CPO: "Reply if #1, else none").
  if (input.waiting > 0 && input.status !== "completed") {
    const people = `${input.waiting} ${input.waiting === 1 ? "person is" : "people are"} waiting for your reply.`;
    return { ...base, number, sentence: `${people} ${base.sentence}`, action: base.action ?? "reply" };
  }
  return { ...base, number };
}
