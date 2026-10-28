/**
 * #1565 (#1315): one leave-behind landing per pilot segment, linked from the WhatsApp leave-behind image.
 * Words follow the CPO's pilot kit: free first campaign, the owner pays Meta from their own ad account, then ₹999 a
 * month with the first month free. No margin or split (#1235), no promised results or 'guaranteed' (#1500).
 */
export type Segment = {
  slug: string;
  /** Who it's for, as the page title says it. */
  trade: string;
  headline: string;
  description: string;
  hinglish: string;
  /** The static chat: the business's welcome, and what a customer sends. */
  chatName: string;
  welcome: string;
  ask: string;
  /** What the 3 ads lead with, in the owner's terms. */
  angles: string[];
  /** Pre-typed in the WhatsApp button. */
  whatsappText: string;
};

export const SEGMENTS: Segment[] = [
  {
    slug: "solar",
    trade: "rooftop solar installers",
    headline: "Rooftop solar enquiries, straight to your WhatsApp.",
    description: "Facebook and Instagram ads for homeowners near you who are thinking about solar. They tap the ad and message you on WhatsApp.",
    hinglish: "Aapke area ke ghar-maalik, ad dekh ke seedha aapke WhatsApp pe.",
    chatName: "Your solar business",
    welcome: "Thanks for messaging us! Tell us your area and your monthly bill, and we'll book your free site survey.",
    ask: "I'd like a free site survey",
    angles: ["Your free site survey, up front", "Lower power bills, in your customers' words", "Subsidy help, if you're a registered PM Surya Ghar vendor"],
    whatsappText: "Hi, I saw AdBrain for solar installers. I'd like to try the free first campaign.",
  },
  {
    slug: "ielts",
    trade: "IELTS and study-abroad coaching",
    headline: "Students asking about your next IELTS batch, on your WhatsApp.",
    description: "Facebook and Instagram ads for students near your centre. They tap the ad and message you on WhatsApp to ask about batches and fees.",
    hinglish: "Aapke centre ke paas ke students, ad dekh ke seedha aapke WhatsApp pe.",
    chatName: "Your coaching centre",
    welcome: "Thanks for messaging us! Which test are you preparing for, and when would you like to start?",
    ask: "I'd like to book a free demo class",
    angles: ["A free demo class, up front", "Your next batch dates and timings", "Small batches and mock tests"],
    whatsappText: "Hi, I saw AdBrain for IELTS coaching. I'd like to try the free first campaign.",
  },
  {
    slug: "interiors",
    trade: "interior designers and modular kitchens",
    headline: "Homeowners planning a kitchen or interior, messaging you on WhatsApp.",
    description: "Facebook and Instagram ads for people near you who are doing up a home. They tap the ad and message you on WhatsApp.",
    hinglish: "Ghar banwa rahe log, ad dekh ke seedha aapke WhatsApp pe.",
    chatName: "Your design studio",
    welcome: "Thanks for messaging us! Tell us your area and which rooms you're planning, and we'll set up a free consultation.",
    ask: "I'd like a free design consultation",
    angles: ["A free consultation or site visit, up front", "Your real finished work", "Modular kitchens and wardrobes, in your area"],
    whatsappText: "Hi, I saw AdBrain for interior designers. I'd like to try the free first campaign.",
  },
];

export const segmentBySlug = (slug: string) => SEGMENTS.find((segment) => segment.slug === slug) ?? null;

const SEGMENT_MATCH: Array<[RegExp, string]> = [
  [/solar/i, "solar"],
  [/\b(ielts|pte|toefl)\b|study[\s-]*abroad/i, "ielts"],
  [/interior|modular|kitchen|wardrobe/i, "interiors"],
];

/** #1582: the pilot segment for a Brand category (free text), or null outside the three. */
export function segmentForCategory(category: string | null | undefined): Segment | null {
  const slug = SEGMENT_MATCH.find(([pattern]) => pattern.test(category ?? ""))?.[1];
  return slug ? segmentBySlug(slug) : null;
}

/**
 * #1582: the closing block of a sales visit's pack (`copy.txt`): the CPO's WhatsApp follow-up to send the owner after
 * the visit, ending with the segment's landing link. `{owner name}` stays for the rep to type.
 */
export function leaveBehindBlock(segment: Segment, { businessName, origin = "https://adbrain.vanshul.com" }: { businessName?: string | null; origin?: string } = {}): string {
  return [
    "----------------------------------------",
    "",
    "After the visit, send the owner this on WhatsApp:",
    "",
    `Hi {owner name}, thanks for your time today. Here are the 3 sample ads I made for ${businessName?.trim() || "{business name}"}.`,
    segment.headline,
    segment.hinglish,
    "Your first campaign is set up free. You pay Meta directly, only for the ads you approve.",
    `See how it works: ${origin}/for/${segment.slug}`,
    "",
  ].join("\n");
}

/** The owner's business WhatsApp (#796), read at build time; unset means no WhatsApp button. */
export function segmentWhatsAppHref(segment: Segment, number = process.env.SUPPORT_WHATSAPP || process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP): string | null {
  const digits = (number ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(segment.whatsappText)}`;
}
