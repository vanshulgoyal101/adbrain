import type { PauseSuggestion } from "./ad-pause";
import { BEST_AD_MIN_RESULTS } from "@/lib/meta/insights";

/**
 * #1273 (#1255 WS2 slice 1): a campaign's results as one sentence, one number and at most one action, by
 * fixed rules (no AI). Pure: the caller passes stored results, unreplied enquiries, #1045's pause
 * suggestion and AdBrain's own ₹-per-result range for this kind of business (#588 ledger), when it has one.
 * Never suggests raising budget or changing targeting (CEO money rule). Thresholds are placeholders until
 * the CPO sets them (#1255).
 */
export const SPENT_NO_RESULTS_RATIO = 1.5;
export const IN_REVIEW_MS = 24 * 60 * 60 * 1000;
/** The evidence bar: #1045's and "Best"'s minimum results before AdBrain calls a campaign good or bad. */
export const EVIDENCE_MIN_RESULTS = BEST_AD_MIN_RESULTS;

export type VerdictInput = {
  status: "live" | "paused" | "ended";
  destination: "whatsapp" | "instant_form";
  /** When the campaign went live (ISO); null when it never did. */
  liveSince: string | null;
  now: Date;
  impressions: number;
  spend: number;
  /** Chats for WhatsApp, enquiries for a form. */
  results: number;
  /** People who opened WhatsApp from the ad (WhatsApp only). */
  opens?: number | null;
  /** Chats or enquiries from the last 24 h nobody has replied to (#1049). */
  unreplied: number;
  /** #1045's rule on this campaign's ads, from `pauseSuggestion`. */
  weakAd: PauseSuggestion | null;
  /** ₹ per result across AdBrain's runs for the same kind of business; null when the ledger has none. */
  ledger: { low: number; high: number } | null;
};

export type VerdictState = "ended_worked" | "ended_poor" | "weak_ad" | "spent_no_results" | "in_review" | "early" | "expensive" | "working";
export type VerdictAction = "reply" | "pause_ad" | "edit_message" | "try_new_ads" | "run_again";

export type Verdict = {
  state: VerdictState;
  /** The one number: ₹ per result once there is one, else the result count. */
  number: { kind: "cost_per_result"; value: number } | { kind: "count"; value: number };
  /** At most one action; a waiting reply wins, because a person is on the other end. */
  action: VerdictAction | null;
  /** State 1 of #1255: shown before the sentence of any state. */
  waiting: number;
};

const typical = (ledger: NonNullable<VerdictInput["ledger"]>) => (ledger.low + ledger.high) / 2;

export function verdict(input: VerdictInput): Verdict {
  const costPerResult = input.results > 0 ? input.spend / input.results : null;
  const number: Verdict["number"] = costPerResult === null ? { kind: "count", value: input.results } : { kind: "cost_per_result", value: Math.round(costPerResult * 100) / 100 };
  const done = (state: VerdictState, action: VerdictAction | null): Verdict => ({
    state, number, waiting: input.unreplied, action: input.unreplied > 0 ? "reply" : action,
  });
  const proven = input.results >= EVIDENCE_MIN_RESULTS;
  const withinLedger = costPerResult !== null && (!input.ledger || costPerResult <= input.ledger.high);
  // A finished run is judged as a whole; pausing an ad or waiting for Meta no longer applies.
  if (input.status === "ended") return proven && withinLedger ? done("ended_worked", "run_again") : done("ended_poor", "try_new_ads");
  if (input.status === "live" && input.weakAd) return done("weak_ad", "pause_ad");
  if (input.results === 0 && input.ledger && input.spend >= SPENT_NO_RESULTS_RATIO * typical(input.ledger)) {
    return done("spent_no_results", input.destination === "whatsapp" ? "edit_message" : null);
  }
  const since = input.liveSince ? Date.parse(input.liveSince) : NaN;
  if (input.status === "live" && input.impressions === 0 && (Number.isNaN(since) || input.now.getTime() - since < IN_REVIEW_MS)) return done("in_review", null);
  if (!proven) return done("early", null);
  if (input.ledger && costPerResult !== null && costPerResult > input.ledger.high) return done("expensive", "try_new_ads");
  return done("working", null);
}
