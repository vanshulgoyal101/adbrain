import type { DraftInput, TargetingInputDTO, WebsiteCta } from "@/lib/campaign/connect-contracts";
import type { WhatsAppLanguage } from "@/lib/campaign/whatsapp-greeting";
import type { WhatsAppTemplate } from "@/lib/campaign/whatsapp-template";
import type { LeadDestination } from "@/lib/types/campaign";

/** The WhatsApp button number the composer uses: the owner's pick when Meta still offers it, else Meta's first ready number. */
export function pickWhatsAppNumber(options: readonly { masked: string }[], wanted: string): string {
  return options.some(({ masked }) => masked === wanted) ? wanted : options[0]?.masked ?? wanted;
}

/** The draft a manual composer saves (campaigns.tsx and setup Go live, #1271): one shape for both. */
export function buildManualDraftInput(fields: {
  businessId: string;
  name: string;
  goal: string;
  mode: DraftInput["mode"];
  creativeIds: string[];
  dailyBudgetRupees: number;
  destination: Exclude<LeadDestination, "call">;
  /** #2595: the website ad's button. */
  websiteCta?: WebsiteCta;
  leadFormId: string;
  whatsappNumber: string;
  whatsappLanguage: WhatsAppLanguage;
  whatsappMessage: WhatsAppTemplate | null;
  targeting: TargetingInputDTO;
  abTest: boolean;
  /** #2273: the internal-only no-Reels test. */
  excludeFacebookReels?: boolean;
}): DraftInput {
  const { destination, whatsappNumber, whatsappLanguage, whatsappMessage } = fields;
  return {
    businessId: fields.businessId,
    name: fields.name,
    goal: fields.goal,
    mode: fields.mode,
    creativeIds: fields.creativeIds,
    dailyBudgetRupees: Math.max(0, fields.dailyBudgetRupees),
    leadFormId: destination === "instant_form" ? fields.leadFormId || null : null,
    destination,
    ...(destination === "website" ? { websiteCta: fields.websiteCta ?? "learn_more" } : {}),
    ...(destination === "whatsapp" && whatsappNumber ? { whatsappNumber } : {}),
    ...(destination === "whatsapp" && whatsappLanguage !== "ad" ? { whatsappLanguage } : {}),
    ...(destination === "whatsapp" && whatsappMessage ? { whatsappMessage } : {}),
    targeting: fields.targeting,
    abTest: fields.abTest,
    ...(fields.excludeFacebookReels ? { excludeFacebookReels: true } : {}),
  };
}
