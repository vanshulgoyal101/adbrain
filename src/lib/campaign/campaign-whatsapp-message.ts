import { savedGenerationSettings } from "@/lib/creative/receipt";
import type { DraftInput } from "./connect-contracts";
import { draftAreaNames } from "./draft-targeting";
import { quotedAsk, whatsappGreeting } from "./whatsapp-greeting";
import { resolveWhatsAppMessage, type ResolvedWhatsAppMessage } from "./whatsapp-template";

export type WhatsAppMessageBusiness = { name: string; offers?: string[] | null; locations?: string[] | null; whatsapp_template?: unknown };
export type WhatsAppMessageCreative = { headline?: string | null; primary_text?: string | null; generation?: unknown };

/**
 * #840: the WhatsApp message a campaign sends. Review shows it and launch sends it, from the same
 * inputs: this campaign's edit, else the saved message, else the greeting and prefill AdBrain
 * writes from the ads, areas and language (#493), using the ads' own quoted ask when they share one (#418 rule 7).
 */
export function campaignWhatsAppMessage(input: { draft: DraftInput; business: WhatsAppMessageBusiness; creatives: WhatsAppMessageCreative[] }): ResolvedWhatsAppMessage {
  const { draft, business, creatives } = input;
  return resolveWhatsAppMessage({
    edited: draft.whatsappMessage,
    saved: business.whatsapp_template,
    suggest: () => whatsappGreeting(
      business,
      creatives.flatMap(creative => [creative.headline ?? "", creative.primary_text ?? ""]),
      draftAreaNames(draft, business.locations ?? []),
      creatives.map(creative => savedGenerationSettings(creative.generation).language),
      draft.whatsappLanguage ?? "ad",
      creatives.map(creative => quotedAsk(creative.primary_text)),
    ),
  });
}
