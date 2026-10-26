import type { ReviewBlockerReason } from "@/lib/meta/connect-contracts";

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

const FIXES: Record<ReviewBlockerReason, ReviewFix> = {
  REVIEW_NO_META_CONNECTION: { kind: "connect", label: "Connect Facebook" },
  REVIEW_CURRENCY: { kind: "connect", label: "Choose another ad account" },
  REVIEW_META_ACCESS: { kind: "connect", label: "Connect Facebook again" },
  REVIEW_CREATIVES: { kind: "field", label: "Choose your ads", targets: ["campaign-ad-picker"] },
  REVIEW_WHATSAPP_NOT_LINKED: { kind: "page", label: "Link your WhatsApp number", href: "/brand" },
  REVIEW_NO_LEAD_FORM: { kind: "field", label: "Choose a lead form", targets: ["leadform"] },
  REVIEW_NO_WEBSITE: { kind: "page", label: "Add your website", href: "/brand" },
  REVIEW_BUDGET: { kind: "field", label: "Set the daily budget", targets: ["budget"] },
  REVIEW_NO_AGE_RANGE: { kind: "field", label: "Set the age range", targets: ["age-min", "age-mode"] },
  REVIEW_RADIUS: { kind: "field", label: "Set the city radius", targets: ["city-radius", "location-include", "location-mode"] },
  REVIEW_CITY_RADIUS: { kind: "field", label: "Choose the locations again", targets: ["location-include", "location-mode"] },
  REVIEW_AREAS_UNRESOLVED: { kind: "field", label: "Fix the areas", targets: ["planned-areas", "location-include", "location-mode"] },
  REVIEW_NO_AUDIENCE: { kind: "field", label: "Go to Recommend audience", targets: ["recommend-audience"] },
  REVIEW_AD_POLICY: { kind: "field", label: "Edit the ad's wording", targets: ["campaign-ad-picker"] },
  REVIEW_INTERESTS_UNRESOLVED: { kind: "field", label: "Edit the interests", targets: ["audience-interests", "recommend-audience"] },
};

export function reviewBlockerFix(reason: ReviewBlockerReason | undefined): ReviewFix | null {
  return reason ? FIXES[reason] : null;
}

/** #742: another way past a blocker. WhatsApp chat ads need no website, so a site-less owner isn't stuck. */
export function reviewBlockerAlternative(reason: ReviewBlockerReason | undefined): ReviewFix | null {
  return reason === "REVIEW_NO_WEBSITE" ? { kind: "destination", label: "Use WhatsApp chat instead (no website needed)", destination: "whatsapp" } : null;
}
