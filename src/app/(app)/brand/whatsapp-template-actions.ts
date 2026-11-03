"use server";

import { revalidatePath } from "next/cache";
import { observeAction } from "@/lib/observability/logger";
import { logEvent } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { ownerWords } from "@/i18n/request-locale";
import { whatsappTemplateProblem } from "@/lib/campaign/whatsapp-template-check";
import { whatsappTemplateSchema } from "@/lib/campaign/whatsapp-template";
import type { Json } from "@/lib/types";

export type WhatsAppTemplateResult = { ok: boolean; error?: string; field?: "greeting" | "prefill" | "questions" };

/**
 * #840: save (or clear, with `template: null`) the business's WhatsApp message. Same checks as ad
 * copy: claims must be in the Brand or reworded; questions carry no links or phone numbers.
 * Never touches a running campaign. Its own refusals are in the owner's language (#1438); the claim checks stay English.
 */
export async function saveWhatsAppTemplate(input: { businessId: string; template: unknown }): Promise<WhatsAppTemplateResult> {
  return observeAction("server.saveWhatsAppTemplate", async () => {
    const [supabase, say] = await Promise.all([createClient(), ownerWords()]);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: say("whatsappSignIn") };

    let stored: Json | null = null;
    if (input.template !== null) {
      const parsed = whatsappTemplateSchema.safeParse(input.template);
      if (!parsed.success) {
        const path = String(parsed.error.issues[0]?.path[0] ?? "");
        const field = path === "greeting" ? "greeting" : (parsed.error.issues[0]?.path.includes("questions") ? "questions" : "prefill");
        return { ok: false, field, error: say(field === "questions" ? "whatsappQuestions" : field === "greeting" ? "whatsappGreetingLength" : "whatsappPrefillLength") };
      }
      const template = parsed.data;
      const { data: business } = await supabase.from("businesses").select("offers, usps, description, vertical").eq("id", input.businessId).maybeSingle();
      if (!business) return { ok: false, error: say("businessMissing") };
      const problem = whatsappTemplateProblem(template, business);
      if (problem) return { ok: false, ...problem };
      stored = template as unknown as Json;
    }

    const { data: saved, error } = await supabase.from("businesses").update({ whatsapp_template: stored })
      .eq("id", input.businessId).select("id").maybeSingle();
    if (error || !saved) return { ok: false, error: say("whatsappSaveFailed") };
    await logEvent({
      businessId: input.businessId, action: stored ? "whatsapp_template.save" : "whatsapp_template.reset",
      entityType: "business", entityId: input.businessId, reason: stored ? "Saved WhatsApp message" : "Back to the suggested message",
    });
    revalidatePath("/brand");
    revalidatePath("/campaigns");
    return { ok: true };
  });
}
