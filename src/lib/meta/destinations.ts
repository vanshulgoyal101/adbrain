// #2598: where an ad sends people, and the Meta ad-set plan and button for each destination.
import type { LeadDestination, WebsiteGoal } from "@/lib/types/campaign";

/** Where people land: an in-ad instant form, a WhatsApp chat, a phone call, or the business's website (#2595). */
export type AdDestination = LeadDestination;

/** #680: WhatsApp and lead-form ads get the 9:16 placement creative, so an A/B differs only in destination. */
export function hasPlacementCreative(destination: AdDestination): boolean {
  return destination === "whatsapp" || destination === "instant_form";
}

/** #906: Audience Network taps were mostly accidental; on a website ad (#2598) each one is a paid click, so it stays out too. */
export function leavesAudienceNetworkOut(destination: AdDestination): boolean {
  return hasPlacementCreative(destination) || destination === "website";
}

/** #2598: the UTM tags on every website ad, so the advertiser's analytics credit the visit to this campaign. */
export function websiteUrlTags(campaignId: string): string {
  return `utm_source=meta&utm_medium=paid&utm_campaign=${campaignId}`;
}

/** Meta's and WhatsApp's own domains (and every subdomain): never an advertiser's website. */
const PLATFORM_DOMAINS = ["facebook.com", "fb.com", "fb.me", "messenger.com", "m.me", "instagram.com", "instagr.am", "whatsapp.com", "wa.me", "wa.link"];

/** #2598: a website ad needs the advertiser's own https link; anything else is refused before Meta is called. */
export function isWebsiteLink(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return url.protocol === "https:" && !url.username && !url.password && host.includes(".")
    && !PLATFORM_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export interface DestinationPlan {
  optimizationGoal: string;
  destinationType: string;
}

/** #2713: the pixel event a website leads/sales goal optimises for; visits has none. */
export function websiteConversionEvent(goal: WebsiteGoal | undefined): "LEAD" | "PURCHASE" | null {
  return goal === "leads" ? "LEAD" : goal === "sales" ? "PURCHASE" : null;
}

/** #2713: the campaign objective for a destination; a website leads/sales goal gets Meta's leads/sales objective. */
export function campaignObjective(dest: AdDestination, goal?: WebsiteGoal): string {
  if (dest === "whatsapp") return "OUTCOME_ENGAGEMENT";
  if (dest !== "website") return "OUTCOME_LEADS";
  return goal === "leads" ? "OUTCOME_LEADS" : goal === "sales" ? "OUTCOME_SALES" : "OUTCOME_TRAFFIC";
}

/** Ad-set optimisation goal + destination type for a lead destination (a website leads/sales goal optimises for the pixel event, #2713). */
export function destinationPlan(dest: AdDestination, goal?: WebsiteGoal): DestinationPlan {
  switch (dest) {
    case "call":
      return { optimizationGoal: "QUALITY_CALL", destinationType: "PHONE_CALL" };
    case "whatsapp":
      return { optimizationGoal: "CONVERSATIONS", destinationType: "WHATSAPP" };
    case "website":
      return { optimizationGoal: websiteConversionEvent(goal) ? "OFFSITE_CONVERSIONS" : "LANDING_PAGE_VIEWS", destinationType: "WEBSITE" };
    default:
      return { optimizationGoal: "LEAD_GENERATION", destinationType: "ON_AD" };
  }
}

/** #2598: a website ad's button from the ad's own button words: Shop now, Sign up, else Learn more. */
function websiteCtaType(label: string | null | undefined): "SHOP_NOW" | "SIGN_UP" | "LEARN_MORE" {
  const words = (label ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (/^(shop|buy|order) now$/.test(words)) return "SHOP_NOW";
  if (/^(sign up|register)$/.test(words)) return "SIGN_UP";
  return "LEARN_MORE";
}

/** The creative call-to-action for a destination. */
export function destinationCTA(
  dest: AdDestination,
  opts: { leadFormId?: string; phone?: string; ctaLabel?: string | null; link?: string },
): { type: string; value: Record<string, unknown> } {
  if (dest === "website") {
    return { type: websiteCtaType(opts.ctaLabel), value: { link: opts.link } };
  }
  if (dest === "call" && opts.phone) {
    return { type: "CALL_NOW", value: { link: `tel:${opts.phone}` } };
  }
  if (dest === "whatsapp") {
    return { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP", ...(opts.phone ? { link: `https://wa.me/${opts.phone.replace(/^\+/, "")}` } : {}) } };
  }
  // A human creative CTA is presentation copy, not a safe Graph API CTA. In
  // particular, BOOK_NOW is not accepted for every instant-form lead ad.
  return {
    type: "LEARN_MORE",
    value: { lead_gen_form_id: opts.leadFormId },
  };
}
