import type { ReviewBlockerReason } from "@/lib/meta/connect-contracts";
import { campaignsTranslator, type Words } from "@/i18n/words";

/**
 * #723: the one-tap fix for a Review blocker. `page` opens the page that fixes it, `connect`
 * opens Connect Facebook, `field` jumps to the first of `targets` (element ids) on screen, and
 * `destination` switches where the ad sends people.
 */
export type ReviewFix =
  | { kind: "page"; label: string; href: string }
  | { kind: "connect"; label: string }
  | { kind: "field"; label: string; targets: string[] }
  | { kind: "destination"; label: string; destination: "whatsapp" };

type Fix<T> = T extends ReviewFix ? Omit<T, "label"> : never;

/** #2333: the label is `campaigns.review.fix.<reason>`, in the owner's language. */
const FIXES: Record<ReviewBlockerReason, Fix<ReviewFix>> = {
  REVIEW_NO_META_CONNECTION: { kind: "connect" },
  REVIEW_CURRENCY: { kind: "connect" },
  REVIEW_META_ACCESS: { kind: "connect" },
  REVIEW_CREATIVES: { kind: "field", targets: ["campaign-ad-picker"] },
  // #847: linking lives in Settings' WhatsApp card (steps + Check again), not on Your business.
  REVIEW_WHATSAPP_NOT_LINKED: { kind: "page", href: "/settings#whatsapp-status-title" },
  REVIEW_NO_LEAD_FORM: { kind: "field", targets: ["leadform"] },
  REVIEW_NO_WEBSITE: { kind: "page", href: "/brand" },
  REVIEW_BUDGET: { kind: "field", targets: ["budget"] },
  REVIEW_NO_AGE_RANGE: { kind: "field", targets: ["age-min", "age-mode"] },
  REVIEW_RADIUS: { kind: "field", targets: ["city-radius", "location-include", "location-mode"] },
  REVIEW_CITY_RADIUS: { kind: "field", targets: ["location-include", "location-mode"] },
  REVIEW_AREAS_UNRESOLVED: { kind: "field", targets: ["planned-areas", "location-include", "location-mode"] },
  REVIEW_NO_AUDIENCE: { kind: "field", targets: ["recommend-audience"] },
  REVIEW_AD_POLICY: { kind: "field", targets: ["campaign-ad-picker"] },
  REVIEW_INTERESTS_UNRESOLVED: { kind: "field", targets: ["audience-interests", "recommend-audience"] },
  REVIEW_WHATSAPP_MESSAGE: { kind: "field", targets: ["whatsapp-message"] },
};

export function reviewBlockerFix(reason: ReviewBlockerReason | undefined, words?: Words<"campaigns">): ReviewFix | null {
  return reason ? { ...FIXES[reason], label: campaignsTranslator(words)(`review.fix.${reason}`) } : null;
}

/** #742: another way past a blocker. WhatsApp chat ads need no website, so a site-less owner isn't stuck. */
export function reviewBlockerAlternative(reason: ReviewBlockerReason | undefined, words?: Words<"campaigns">): ReviewFix | null {
  return reason === "REVIEW_NO_WEBSITE" ? { kind: "destination", label: campaignsTranslator(words)("review.useWhatsApp"), destination: "whatsapp" } : null;
}
