import type { AdReviewFeedback } from "./client";
import { segmentForCategory } from "@/lib/segments";
import { verdictTranslator, type Words } from "@/i18n/words";
import type en from "../../../messages/en.json";

/**
 * #1305 (CPO's table on #1299): Meta's likeliest rejections of local-service ads in one owner sentence and one
 * fix. Matched on the policy key of `ad_review_feedback` first, then on words in Meta's message. The key names
 * are from Meta's Advertising Standards; the one real sample so far ("Lead Ads", a generic message, recorded
 * Oct 28) falls to the fallback, which quotes Meta. Meta's own message always stays available under Details.
 */
export type RejectionAction = "edit_words" | "change_picture" | "message_us" | "check_whatsapp" | "ask_meta_review";

export type RejectionCopy = {
  row: string;
  sentence: string;
  actions: RejectionAction[];
  /** Meta's own words for the matched reason, shown under Details. */
  message: string;
  /** Further reasons beyond the first matched one ("+2 more"). */
  more: number;
  /** #1645: a line for the words editor this row opens ("Add your licence number…"). */
  editHint?: string;
};

/** #1645 (CPO, #1622): the pilot segment (`segmentForCategory`) a row's words can be tailored to. */
type Segment = "solar" | "ielts" | "interiors";
/** #1438: each row's words live in `messages/` (`verdict.rejected`), keyed by the row or its segment variant. */
type Reason = keyof typeof en.verdict.rejected.reasons;
type Hint = keyof typeof en.verdict.rejected.hints;
type Wording = { sentence?: Reason; actions?: RejectionAction[]; editHint?: Hint };
type Row = { row: Reason; policy: RegExp; words?: RegExp; actions: RejectionAction[];
  /** Only for these segments (a row other businesses never get). */
  only?: Segment[];
  bySegment?: Partial<Record<Segment, Wording>> };

const ROWS: Row[] = [
  { row: "personal_attributes", policy: /personal attribute/i,
    words: /\bare you (?:suffering|struggling)|\byour (?:weight|debt|condition|illness)|failed (?:your )?(?:ielts|pte|exam)|low band|weak (?:in )?english|visa (?:was |got )?(?:refused|rejected)/i,
    actions: ["edit_words"],
    // #1770: no quoted example; Meta may have objected to other words.
    bySegment: { ielts: { sentence: "personal_attributes_ielts" } } },
  { row: "health_appearance", policy: /personal health|appearance|body image/i, words: /before[- ]and[- ]after|before\/after|body image/i,
    actions: ["change_picture", "edit_words"] },
  { row: "misleading", policy: /misleading|unrealistic|deceptive|false/i, words: /\bguarantee|\b100%|unrealistic/i,
    actions: ["edit_words"],
    bySegment: {
      solar: { sentence: "misleading_solar" },
      // #1770: a licence line doesn't take a guarantee out; name what to remove.
      ielts: { sentence: "misleading_ielts", editHint: "misleading_ielts" },
      interiors: { sentence: "misleading_interiors" },
    } },
  { row: "political", policy: /social issue|election|politic/i, words: /\bpolitical\b|social issues?/i, actions: ["edit_words"] },
  { row: "job_or_visa_offer", only: ["ielts"], policy: /employment|unacceptable business|fraud|scam/i,
    words: /work permit|jobs? (?:abroad|in \w+)|job guarantee|\bPR\b|settle abroad/i,
    actions: ["edit_words"], bySegment: { ielts: { editHint: "licence" } } },
  { row: "special_category", policy: /special ad categor|housing|credit|employment|financial products/i, words: /special ad categor|housing|credit|employment/i,
    actions: ["message_us"],
    bySegment: { interiors: { sentence: "special_category_interiors", actions: ["edit_words"] } } },
  { row: "destination", policy: /landing page|destination|non[- ]functional/i, words: /landing page|broken link|destination|isn'?t working|not working/i,
    actions: ["check_whatsapp"] },
  { row: "low_quality", policy: /low[- ]quality|sensational|clickbait|engagement bait/i, words: /sensational|clickbait|engagement bait/i, actions: ["edit_words"] },
  { row: "brand_ip", policy: /brand usage|intellectual property|trademark|copyright/i, words: /trademark|copyright|logo/i, actions: ["change_picture"] },
  { row: "prohibited", policy: /prohibited|restricted|drugs|alcohol|tobacco|weight loss|supplement/i, words: /prescription|weight[- ]loss|alcohol|tobacco/i,
    actions: ["message_us"] },
  { row: "adult", policy: /adult|sexual|nudity|suggestive/i, words: /adult|nudity|suggestive|sexual/i, actions: ["change_picture"] },
];

const matchRow = (item: AdReviewFeedback, segment: Segment | null) => {
  const rows = ROWS.filter((row) => !row.only || (segment !== null && row.only.includes(segment)));
  return rows.find((row) => item.policy && row.policy.test(item.policy)) ?? rows.find((row) => row.words?.test(item.message));
};

/**
 * The owner's sentence and fix for an ad's review feedback; null when Meta gave no reason at all.
 * #1645: `vertical` (the Brand's category) tailors the words for the IELTS and interiors pilots.
 * #1438: `words` gives the owner's language; English without.
 */
export function rejectionCopy(feedback: AdReviewFeedback[], { vertical, words }: { vertical?: string | null; words?: Words<"verdict"> } = {}): RejectionCopy | null {
  const reasons = feedback.filter((item) => item.message.trim());
  if (!reasons.length) return null;
  const segment = (segmentForCategory(vertical)?.slug ?? null) as Segment | null;
  const matched = reasons.map((item) => ({ item, row: matchRow(item, segment) })).find((entry) => entry.row);
  const t = verdictTranslator(words);
  if (matched?.row) {
    const wording = (segment && matched.row.bySegment?.[segment]) || {};
    return {
      row: matched.row.row, sentence: t(`rejected.reasons.${wording.sentence ?? matched.row.row}`), actions: wording.actions ?? matched.row.actions,
      message: matched.item.message, more: reasons.length - 1, ...(wording.editHint ? { editHint: t(`rejected.hints.${wording.editHint}`) } : {}),
    };
  }
  const first = reasons[0];
  return {
    row: "other",
    sentence: t("rejected.other", { message: first.message.slice(0, 300) }),
    actions: ["edit_words", "change_picture", "ask_meta_review"],
    message: first.message,
    more: reasons.length - 1,
  };
}

/**
 * #1255's sentence for a campaign with rejected ads (CPO words check on #1255: the reasons are full sentences, so
 * they follow a full stop): "Meta didn't approve 1 ad. {reason} Your other 2 ads are running." or
 * "Meta didn't approve your 3 ads. {reason} Nothing was spent."
 */
export function rejectedAdsSentence(copy: RejectionCopy, { rejected, total = rejected, spent, running = false, words }: {
  rejected: number; total?: number; spent: number; running?: boolean; words?: Words<"verdict">;
}): string {
  const t = verdictTranslator(words);
  const head = rejected >= total ? (total === 1 ? t("rejected.headOne") : t("rejected.headAll", { n: total })) : t("rejected.headSome", { n: rejected });
  const more = copy.more > 0 ? ` ${t("rejected.more", { more: copy.more })}` : "";
  const others = total - rejected;
  const tail = others > 0 && running ? ` ${t("rejected.othersRunning", { n: others })}` : spent > 0 ? "" : ` ${t("rejected.nothingSpent")}`;
  return `${head} ${copy.sentence}${more}${tail}`;
}
