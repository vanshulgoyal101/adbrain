import type { DraftInput, TargetingInputDTO } from "@/lib/campaign/connect-contracts";
import type { WhatsAppLanguage } from "@/lib/campaign/whatsapp-greeting";
import type { WhatsAppTemplate } from "@/lib/campaign/whatsapp-template";
import { maskedWhatsAppNumberPattern } from "@/lib/meta/whatsapp-status-shared";
import type { LeadDestination, WebsiteGoal, WhatsAppNumberChoice, WhatsAppNumberSource } from "@/lib/types/campaign";

/** Keep an owner's previous choice even if the latest Meta read cannot offer it. */
export function pickWhatsAppNumber(options: readonly { masked: string }[], wanted: string): string {
  return wanted || options[0]?.masked || "";
}

export function selectedWhatsAppNumberChoice(
  options: readonly WhatsAppNumberChoice[],
  wanted: string,
  mask: string,
  source: WhatsAppNumberSource | undefined,
  businessUnavailable: boolean,
  choiceId?: string,
): WhatsAppNumberChoice | undefined {
  if (!wanted) {
    const first = options[0];
    return first && !businessUnavailable && options.filter((choice) => choice.masked === first.masked).length === 1 ? first : undefined;
  }
  if (!maskedWhatsAppNumberPattern.test(wanted) || !source || !choiceId) return undefined;
  return options.find((choice) => choice.masked === mask && choice.source === source && choice.choiceId === choiceId);
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
  websiteGoal?: WebsiteGoal;
  leadFormId: string;
  whatsappNumber: string;
  whatsappNumberSource?: WhatsAppNumberSource;
  whatsappNumberChoiceId?: string;
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
    ...(destination === "website" && fields.websiteGoal && fields.websiteGoal !== "visits" ? { websiteGoal: fields.websiteGoal } : {}),
    ...(destination === "whatsapp" && whatsappNumber ? { whatsappNumber } : {}),
    ...(destination === "whatsapp" && whatsappNumber && fields.whatsappNumberSource ? { whatsappNumberSource: fields.whatsappNumberSource } : {}),
    ...(destination === "whatsapp" && whatsappNumber && fields.whatsappNumberSource && fields.whatsappNumberChoiceId
      ? { whatsappNumberChoiceId: fields.whatsappNumberChoiceId } : {}),
    ...(destination === "whatsapp" && whatsappLanguage !== "ad" ? { whatsappLanguage } : {}),
    ...(destination === "whatsapp" && whatsappMessage ? { whatsappMessage } : {}),
    targeting: fields.targeting,
    abTest: fields.abTest,
    ...(fields.excludeFacebookReels ? { excludeFacebookReels: true } : {}),
  };
}
