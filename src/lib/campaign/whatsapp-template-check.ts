import { bannedTermKind, bannedTermsIn } from "@/lib/campaign/ad-policy";
import { copyClaimWarnings } from "@/lib/creative/concept";
import { policyFindings } from "@/lib/creative/policy-rules";
import type { WhatsAppTemplate } from "@/lib/campaign/whatsapp-template";
import type { WhatsAppOpening } from "@/lib/meta/client";

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

const OPENING_FIELD_NAMES = { greeting: "welcome", prefill: "pre-typed message", questions: "quick question" } as const;

/**
 * #2422: Meta reviews the welcome, pre-typed message and quick questions with the ad (`page_welcome_message`), so
 * Review holds whatever message launch will send (suggested, saved or edited) to the ad text's rules: the industry's
 * banned claims and #738's policy rules, against the same Brand facts the save check uses. Null when it's fine.
 */
export function whatsappOpeningProblem(opening: WhatsAppOpening, business: WhatsAppTemplateBusiness): { field: WhatsAppTemplateField; error: string } | null {
  const facts = [...(business.offers ?? []), ...(business.usps ?? []), business.description].filter((fact): fact is string => typeof fact === "string" && fact.trim() !== "");
  const texts: [WhatsAppTemplateField, string][] = [
    ["greeting", opening.greeting],
    ...(opening.iceBreakers?.length
      ? opening.iceBreakers.map((question) => ["questions", question] as [WhatsAppTemplateField, string])
      : [["prefill", opening.autofill] as [WhatsAppTemplateField, string]]),
  ];
  for (const [field, text] of texts) {
    if (!text?.trim()) continue;
    const term = bannedTermsIn(text, business.vertical)[0];
    if (term) return { field, error: `"${term}" in the ${OPENING_FIELD_NAMES[field]} is ${bannedTermKind(term, business.vertical)} Meta rejects. Reword it.` };
    const finding = policyFindings(text, { vertical: business.vertical, facts })[0];
    if (finding) return { field, error: `"${finding.detail}" in the ${OPENING_FIELD_NAMES[field]}: Meta often rejects this. ${finding.fix[0].toUpperCase()}${finding.fix.slice(1)}.` };
  }
  return null;
}
