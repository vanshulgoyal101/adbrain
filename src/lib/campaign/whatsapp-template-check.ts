import { copyClaimWarnings } from "@/lib/creative/concept";
import type { WhatsAppTemplate } from "@/lib/campaign/whatsapp-template";

export type WhatsAppTemplateField = "greeting" | "prefill" | "questions";
export type WhatsAppTemplateBusiness = { offers?: string[] | null; usps?: string[] | null; description?: string | null; vertical?: string | null };

const LINK_OR_PHONE = /(https?:\/\/|www\.|\b\S+\.(com|in|net|org)\b|\+?\d[\d\s-]{7,}\d)/i;

/**
 * #840: the same checks as ad copy, for a saved or per-campaign WhatsApp message: claims must be
 * in the Brand or reworded; questions carry no links or phone numbers. Null when it's fine.
 */
export function whatsappTemplateProblem(template: WhatsAppTemplate, business: WhatsAppTemplateBusiness): { field: WhatsAppTemplateField; error: string } | null {
  if (template.opening.kind === "ice_breakers" && template.opening.questions.some((question) => LINK_OR_PHONE.test(question))) {
    return { field: "questions", error: "Questions can't contain links or phone numbers." };
  }
  const facts = [...(business.offers ?? []), ...(business.usps ?? []), business.description];
  const texts: [WhatsAppTemplateField, string][] = [
    ["greeting", template.greeting],
    ...(template.opening.kind === "prefill"
      ? [["prefill", template.opening.prefill] as [WhatsAppTemplateField, string]]
      : template.opening.questions.map((question) => ["questions", question] as [WhatsAppTemplateField, string])),
  ];
  for (const [field, text] of texts) {
    const warning = copyClaimWarnings({ headline: "", primary_text: text, description: "" }, facts, business.vertical)[0];
    if (warning) return { field, error: warning };
  }
  return null;
}
