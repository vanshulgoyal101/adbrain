import type { ReviewDTO } from "@/lib/campaign/connect-contracts";
import { campaignWhatsAppMessage, type WhatsAppMessageBusiness, type WhatsAppMessageCreative } from "@/lib/campaign/campaign-whatsapp-message";
import { setupDraftInput } from "@/lib/campaign/setup-go-live-flow";

export type SetupWelcome = NonNullable<ReviewDTO["whatsappMessage"]>;

/**
 * #1529: the WhatsApp welcome step 3's Go live will send, worked out as Review does (`campaignWhatsAppMessage`) from
 * Go live's own draft and the same ads, in order, that have a picture and a headline. Budget and number don't change it.
 */
export function setupWelcome(business: WhatsAppMessageBusiness & { id: string },
  ads: (WhatsAppMessageCreative & { id: string; image_url?: string | null })[]): SetupWelcome {
  const used = ads.filter((ad) => ad.image_url && ad.headline);
  const draft = setupDraftInput({ businessId: business.id, name: business.name, adIds: used.map((ad) => ad.id), dailyBudgetRupees: 0, whatsappNumber: "" });
  const { source, opening, language } = campaignWhatsAppMessage({ draft, business, creatives: used });
  return {
    source, language, greeting: opening.greeting, autofill: opening.autofill,
    ...(opening.callButton !== undefined ? { callButton: opening.callButton } : {}),
    ...(opening.iceBreakers?.length ? { iceBreakers: opening.iceBreakers } : {}),
  };
}
