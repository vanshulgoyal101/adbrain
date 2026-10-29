import { verdictTranslator, type Words } from "@/i18n/words";
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

/** #1795: 'Live' and 'Ended' only restate a campaign's status, so a list row shows no word for them. */
export function restatesStatus(state: VerdictState): boolean {
  return state === "measured" || state.startsWith("ended_");
}

/**
 * #1841 (Designer): the stage word (Early days, Working, Ended) is the card's status line; the sentence starts at the fact.
 * #1438: the words come from `messages/` (`verdict`); pass the owner's Hindi words for Hindi, English otherwise.
 */
export function verdict(input: VerdictInput, words?: Words<"verdict">): Verdict {
  const t = verdictTranslator(words);
  const whatsapp = input.destination === "whatsapp";
  const chat = whatsapp ? t("chat") : t("enquiry");
  const chats = (n: number) => whatsapp ? t("chats", { n }) : t("enquiries", { n });
  const none = whatsapp ? t("noChats") : t("noEnquiries");
  const cost = input.results > 0 ? input.spend / input.results : null;
  const number: Verdict["number"] = cost === null ? { kind: "count", value: input.results } : { kind: "cost", value: Math.round(cost) };
  const evidence = input.results >= EVIDENCE_MIN_RESULTS && input.spend >= EVIDENCE_MIN_SPEND;
  const comparison = input.comparison && input.comparison.results >= COMPARE_MIN_RESULTS && input.comparison.typical > 0 ? input.comparison : null;
  const typical = comparison?.typical ?? null;
  const band = cost === null || typical === null ? null : cost > COSTLY_RATIO * typical ? "more" : cost < CHEAPER_RATIO * typical ? "less" : "same";
  const against = (word: "less" | "same" | "more") => !comparison ? ""
    : comparison.kind === "own" ? t("againstOwn", { word: t(word), cost: rupees(comparison.typical) })
      : comparison.results >= RANGE_MIN_RESULTS && comparison.low !== undefined && comparison.high !== undefined
        ? t("againstRange", { word: t(word), category: comparison.category, low: rupees(comparison.low), high: Math.round(comparison.high).toLocaleString("en-IN") })
        : t("againstTypical", { word: t(word), category: comparison.category, typical: rupees(comparison.typical) });

  const base = ((): Omit<Verdict, "number"> => {
    if (input.status === "completed") {
      const label = t("label.ended");
      // #1625 (CPO, #1603): too few to judge isn't a bad result, and these are the only ads with data; run them longer.
      // Nobody tapped at all (no result, no WhatsApp open): that's the ads, so make new ones.
      if (!evidence && input.results === 0 && (input.opens ?? 0) === 0)
        return { state: "ended_too_few", label, sentence: t("endedNone", { chats: chats(0) }), action: "new_ads" };
      if (!evidence) return { state: "ended_too_few", label, sentence: t("endedFew", { chats: chats(input.results) }), action: "run_again" };
      if (band === null) {
        return { state: "ended_measured", label, sentence: t("endedMeasured", { chats: chats(input.results), cost: rupees(cost!) }), action: "run_again" };
      }
      if (band !== "more") {
        return { state: "ended_worked", label, sentence: t("endedWorked", { chats: chats(input.results), cost: rupees(cost!) }), action: "run_again" };
      }
      return { state: "ended_costly", label, sentence: whatsapp ? t("endedCostlyChats") : t("endedCostlyEnquiries"), action: "new_ads" };
    }
    if (input.weakAd) {
      const { ad, reference } = input.weakAd;
      const sentence = ad.costPerResult !== null && reference.costPerResult
        ? t("weakAd", { k: String(Math.round(ad.costPerResult / reference.costPerResult)), chat })
        : t("weakAdNone", { amount: rupees(ad.spend), none });
      return { state: "weak_ad", label: t("label.costly"), sentence, action: "pause_ad" };
    }
    if (input.results === 0 && input.spend >= Math.max(NO_RESULTS_MIN_SPEND, COSTLY_RATIO * (typical ?? 0))) {
      const opens = whatsapp && (input.opens ?? 0) >= OPENS_WORTH_MENTIONING ? t("opens", { opens: String(input.opens) }) : "";
      return { state: "no_results", label: whatsapp ? t("label.noChats") : t("label.noEnquiries"),
        sentence: t("noResults", { amount: rupees(input.spend), none, opens }), action: whatsapp ? "edit_message" : null };
    }
    // Only a running campaign is waiting on Meta; a paused one that never showed says so on its card (#173).
    if (input.impressions === 0 && input.status === "active") {
      const since = input.liveSince ? Date.parse(input.liveSince) : Number.NaN;
      if (Number.isFinite(since) && input.now - since >= DAY_MS) {
        return { state: "not_showing_day", label: t("label.notShowing"), sentence: t("notShowingDay"), action: "meta_status" };
      }
      return { state: "not_showing", label: t("label.notShowing"), sentence: t("notShowing"), action: null };
    }
    if (!evidence) {
      return { state: "early", label: t("label.early"), action: null, sentence: input.results
        ? t("early", { chats: chats(input.results), min: String(EVIDENCE_MIN_RESULTS) })
        : whatsapp ? t("earlyNoChats") : t("earlyNoEnquiries") };
    }
    const each = (word: "less" | "same" | "more" | null) => t("cost", { chat, cost: rupees(cost!), against: word ? against(word) : "" });
    // No comparison with enough results behind it: the number only, and no word on whether that's good (#1255 gates).
    if (band === null) return { state: "measured", label: t("label.live"), action: null, sentence: each(null) };
    if (band === "less") return { state: "working", label: t("label.working"), action: null, sentence: each("less") };
    if (band === "same") return { state: "about_average", label: t("label.aboutAverage"), action: null, sentence: each("same") };
    return { state: "costly", label: t("label.costly"), action: "new_ads", sentence: each("more") };
  })();

  // State 1 prefixes any state; its action wins only where the state has none (CPO: "Reply if #1, else none").
  if (input.waiting > 0 && input.status !== "completed") {
    return { ...base, number, sentence: `${t("waiting", { n: input.waiting })} ${base.sentence}`, action: base.action ?? "reply" };
  }
  return { ...base, number };
}
