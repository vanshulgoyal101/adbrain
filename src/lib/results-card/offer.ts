import type { CreateLanguageId } from "@/lib/languages";
import { setupPhone } from "@/lib/brand/setup-fields";

/**
 * #2036 (CPO spec #2018): the weekly results card an owner can put on WhatsApp Status. Offered on Home when the
 * owner logged at least 5 real enquiries (Add an enquiry, #1624) in the last 7 days; raw chats never count. Share
 * or Not this week hides it for 7 days. The card never shows money, budgets or customers.
 */
export const RESULTS_CARD_FLOOR = 5;
export const RESULTS_CARD_WINDOW_MS = 7 * 86_400_000;
export const RESULTS_CARD_EVENTS = {
  shown: "results_card.shown",
  shared: "results_card.shared",
  dismissed: "results_card.dismissed",
} as const;

type CardEvent = { name: string; created_at: string };

export function resultsCardOffered({ enquiries, area, events, now }: {
  /** Enquiries the owner logged in the last 7 days. */
  enquiries: number; area: string | null; events: CardEvent[]; now: number;
}): boolean {
  if (enquiries < RESULTS_CARD_FLOOR || !area) return false;
  const answered = events
    .filter((event) => event.name === RESULTS_CARD_EVENTS.shared || event.name === RESULTS_CARD_EVENTS.dismissed)
    .map((event) => Date.parse(event.created_at))
    .filter(Number.isFinite);
  return !answered.length || now - Math.max(...answered) >= RESULTS_CARD_WINDOW_MS;
}

/** The business's first area, as the owner wrote it (e.g. "Sector 70"). */
export function cardArea(business: { locations: string[] }): string | null {
  const area = business.locations.map((location) => location.trim()).find(Boolean);
  return area ? area.slice(0, 60) : null;
}

/** The owner's own WhatsApp number as "+91 98765 43210", or null when it isn't an Indian mobile. */
export function cardPhone(phone: string | null | undefined): string | null {
  const local = phone ? setupPhone(phone) : null;
  return local ? `+91 ${local.slice(0, 5)} ${local.slice(5)}` : null;
}

// The CPO's lines on #2018, in the owner's ad language. Punjabi gets a native read before its first pilot.
const LINES: Record<CreateLanguageId, { main: (n: number, area: string) => string; contact: (phone: string) => string }> = {
  en: { main: (n, area) => `${n} people in ${area} enquired with us this week`, contact: (phone) => `WhatsApp us: ${phone}` },
  hinglish: { main: (n, area) => `Is hafte ${area} ke ${n} logon ne humse enquiry ki`, contact: (phone) => `WhatsApp karein: ${phone}` },
  hi: { main: (n, area) => `इस हफ़्ते ${area} के ${n} लोगों ने हमसे पूछताछ की`, contact: (phone) => `WhatsApp करें: ${phone}` },
  pa: { main: (n, area) => `ਇਸ ਹਫ਼ਤੇ ${area} ਦੇ ${n} ਲੋਕਾਂ ਨੇ ਸਾਡੇ ਤੋਂ ਪੁੱਛਗਿੱਛ ਕੀਤੀ`, contact: (phone) => `WhatsApp ਕਰੋ: ${phone}` },
};

export type CardLines = { main: string; contact: string | null };

export function cardLines(language: CreateLanguageId, { n, area, phone }: { n: number; area: string; phone: string | null }): CardLines {
  const lines = LINES[language];
  return { main: lines.main(n, area), contact: phone ? lines.contact(phone) : null };
}

/** The ad with the most chats; an owner-photo ad first when tied, then the campaign's own order. */
export function pickThumbnail(ads: { id: string; imageUrl: string | null; yours: boolean }[], chats: Map<string, number>): string | null {
  const ranked = ads
    .map((ad, index) => ({ ...ad, index, chats: chats.get(ad.id) ?? 0 }))
    .filter((ad) => ad.imageUrl)
    .sort((a, b) => b.chats - a.chats || Number(b.yours) - Number(a.yours) || a.index - b.index);
  return ranked[0]?.imageUrl ?? null;
}
