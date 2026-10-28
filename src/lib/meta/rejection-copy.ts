import type { AdReviewFeedback } from "./client";

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
};

type Row = { row: string; policy: RegExp; words?: RegExp; sentence: string; actions: RejectionAction[] };

const ROWS: Row[] = [
  { row: "personal_attributes", policy: /personal attribute/i, words: /\bare you (?:suffering|struggling)|\byour (?:weight|debt|condition|illness)/i,
    sentence: "The ad talks about the reader's own health or problem (\"Are you…?\"). Meta doesn't allow that.", actions: ["edit_words"] },
  { row: "health_appearance", policy: /personal health|appearance|body image/i, words: /before[- ]and[- ]after|before\/after|body image/i,
    sentence: "The picture or words compare \"before and after\" or focus on someone's body.", actions: ["change_picture", "edit_words"] },
  { row: "misleading", policy: /misleading|unrealistic|deceptive|false/i, words: /\bguarantee|\b100%|unrealistic/i,
    sentence: "It promises a result Meta thinks can't be proven, like a guaranteed saving.", actions: ["edit_words"] },
  { row: "political", policy: /social issue|election|politic/i, words: /\bpolitical\b|social issues?/i,
    sentence: "Meta may treat a government scheme name as a political ad, which needs extra verification.", actions: ["edit_words"] },
  { row: "special_category", policy: /special ad categor|housing|credit|employment|financial products/i, words: /special ad categor|housing|credit|employment/i,
    sentence: "Ads for property, loans or jobs need a special Meta setting AdBrain doesn't support yet.", actions: ["message_us"] },
  { row: "destination", policy: /landing page|destination|non[- ]functional/i, words: /landing page|broken link|destination|isn'?t working|not working/i,
    sentence: "People who tap can't reach you: the WhatsApp number or link isn't working.", actions: ["check_whatsapp"] },
  { row: "low_quality", policy: /low[- ]quality|sensational|clickbait|engagement bait/i, words: /sensational|clickbait|engagement bait/i,
    sentence: "The headline reads like clickbait to Meta.", actions: ["edit_words"] },
  { row: "brand_ip", policy: /brand usage|intellectual property|trademark|copyright/i, words: /trademark|copyright|logo/i,
    sentence: "The picture uses a logo Meta doesn't allow, like a changed WhatsApp icon.", actions: ["change_picture"] },
  { row: "prohibited", policy: /prohibited|restricted|drugs|alcohol|tobacco|weight loss|supplement/i, words: /prescription|weight[- ]loss|alcohol|tobacco/i,
    sentence: "Meta doesn't allow ads for this product or service.", actions: ["message_us"] },
  { row: "adult", policy: /adult|sexual|nudity|suggestive/i, words: /adult|nudity|suggestive|sexual/i,
    sentence: "Meta thinks the picture shows too much skin.", actions: ["change_picture"] },
];

const matchRow = (item: AdReviewFeedback) =>
  ROWS.find((row) => item.policy && row.policy.test(item.policy)) ?? ROWS.find((row) => row.words?.test(item.message));

/** The owner's sentence and fix for an ad's review feedback; null when Meta gave no reason at all. */
export function rejectionCopy(feedback: AdReviewFeedback[]): RejectionCopy | null {
  const reasons = feedback.filter((item) => item.message.trim());
  if (!reasons.length) return null;
  const matched = reasons.map((item) => ({ item, row: matchRow(item) })).find((entry) => entry.row);
  if (matched?.row) return { row: matched.row.row, sentence: matched.row.sentence, actions: matched.row.actions, message: matched.item.message, more: reasons.length - 1 };
  const first = reasons[0];
  return {
    row: "other",
    sentence: `Meta didn't say exactly why. Here's their message: "${first.message.slice(0, 300)}"`,
    actions: ["edit_words", "change_picture", "ask_meta_review"],
    message: first.message,
    more: reasons.length - 1,
  };
}

/** #1255's sentence for a campaign with rejected ads: "Meta didn't approve 1 ad: … Nothing was spent." */
export function rejectedAdsSentence(count: number, copy: RejectionCopy, spent: number): string {
  const ads = `${count} ${count === 1 ? "ad" : "ads"}`;
  const more = copy.more > 0 ? ` (+${copy.more} more)` : "";
  return `Meta didn't approve ${ads}: ${copy.sentence}${more}${spent > 0 ? "" : " Nothing was spent."}`;
}
