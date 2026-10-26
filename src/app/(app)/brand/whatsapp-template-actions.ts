"use server";

import { revalidatePath } from "next/cache";
import { observeAction } from "@/lib/observability/logger";
import { logEvent } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { copyClaimWarnings } from "@/lib/creative/concept";
import { whatsappTemplateSchema } from "@/lib/campaign/whatsapp-template";
import type { Json } from "@/lib/types";

export type WhatsAppTemplateResult = { ok: boolean; error?: string; field?: "greeting" | "prefill" | "questions" };

const LINK_OR_PHONE = /(https?:\/\/|www\.|\b\S+\.(com|in|net|org)\b|\+?\d[\d\s-]{7,}\d)/i;

/**
 * #840: save (or clear, with `template: null`) the business's WhatsApp message. Same checks as ad
 * copy: claims must be in the Brand or reworded; questions carry no links or phone numbers.
 * Never touches a running campaign.
 */
export async function saveWhatsAppTemplate(input: { businessId: string; template: unknown }): Promise<WhatsAppTemplateResult> {
  return observeAction("server.saveWhatsAppTemplate", async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in again to save." };

    let stored: Json | null = null;
    if (input.template !== null) {
      const parsed = whatsappTemplateSchema.safeParse(input.template);
      if (!parsed.success) {
        const path = String(parsed.error.issues[0]?.path[0] ?? "");
        const field = path === "greeting" ? "greeting" : (parsed.error.issues[0]?.path.includes("questions") ? "questions" : "prefill");
        return { ok: false, field, error: field === "questions" ? "Use 1 to 3 different questions of up to 40 characters." : field === "greeting" ? "Write a welcome of up to 300 characters." : "Write a pre-typed message of up to 300 characters." };
      }
      const template = parsed.data;
      if (template.opening.kind === "ice_breakers" && template.opening.questions.some((question) => LINK_OR_PHONE.test(question))) {
        return { ok: false, field: "questions", error: "Questions can't contain links or phone numbers." };
      }
      const { data: business } = await supabase.from("businesses").select("offers, usps, description, vertical").eq("id", input.businessId).maybeSingle();
      if (!business) return { ok: false, error: "Business not found." };
      const facts = [...(business.offers ?? []), ...(business.usps ?? []), business.description];
      const texts: [WhatsAppTemplateResult["field"], string][] = [
        ["greeting", template.greeting],
        ...(template.opening.kind === "prefill" ? [["prefill", template.opening.prefill] as [WhatsAppTemplateResult["field"], string]] : template.opening.questions.map((question) => ["questions", question] as [WhatsAppTemplateResult["field"], string])),
      ];
      for (const [field, text] of texts) {
        const warning = copyClaimWarnings({ headline: "", primary_text: text, description: "" }, facts, business.vertical)[0];
        if (warning) return { ok: false, field, error: warning };
      }
      stored = template as unknown as Json;
    }

    const { data: saved, error } = await supabase.from("businesses").update({ whatsapp_template: stored })
      .eq("id", input.businessId).select("id").maybeSingle();
    if (error || !saved) return { ok: false, error: "Couldn't save your WhatsApp message. Try again." };
    await logEvent({
      businessId: input.businessId, action: stored ? "whatsapp_template.save" : "whatsapp_template.reset",
      entityType: "business", entityId: input.businessId, reason: stored ? "Saved WhatsApp message" : "Back to the suggested message",
    });
    revalidatePath("/brand");
    revalidatePath("/campaigns");
    return { ok: true };
  });
}
