"use server";

import { pictureSource } from "@/lib/creative/picture-source";
import { observeAction } from "@/lib/observability/logger";

import { revalidatePath } from "next/cache";
import { logEvent } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { getActiveInstructionsText } from "@/lib/supabase/queries";
import { copyClaimWarnings, editableCopySchema, type EditableCopy } from "@/lib/creative/concept";
import type { Creative } from "@/lib/types";

export type ActionResult = { ok: boolean; error?: string };

export type CopyEditResult = ActionResult & {
  /** Claims the Brand doesn't back up. Shown to the owner; never blocks the save. */
  warnings?: string[];
  liveNotice?: string;
  creative?: Pick<Creative, "headline" | "primary_text" | "cta" | "generation">;
};

const COPY_FIELD_NAMES: Record<string, string> = {
  headline: "Headline",
  primary_text: "Main text",
  description: "Description",
  cta: "Button",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Saves the owner's own wording (#280). No AI call; status is left as it was. */
export async function updateCreativeCopy(
  id: string,
  copy: EditableCopy,
): Promise<CopyEditResult> {
  return observeAction("server.updateCreativeCopy", async () => {
    const parsed = editableCopySchema.safeParse(copy);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = COPY_FIELD_NAMES[String(issue.path[0])] ?? "This field";
      const max = issue.code === "too_big" ? Number(issue.maximum) : null;
      return {
        ok: false,
        error: issue.code === "too_small"
          ? `${field} can't be empty.`
          : max !== null
            ? `${field} must be ${max} characters or fewer.`
            : `${field} isn't valid.`,
      };
    }
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated." };

    const { data: creative, error } = await supabase
      .from("creatives")
      .select("business_id, generation")
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!creative) return { ok: false, error: "We couldn't find this ad. It may have been deleted; refresh the page." };
    const { data: business } = await supabase
      .from("businesses")
      .select("name, vertical, description, target_audience, usps, offers, locations")
      .eq("id", creative.business_id)
      .maybeSingle();
    if (!business) return { ok: false, error: "We couldn't find this ad. It may have been deleted; refresh the page." };

    const { headline, primary_text, description, cta } = parsed.data;
    const generation = isRecord(creative.generation) ? creative.generation : {};
    const concept = isRecord(generation.concept) ? generation.concept : {};
    const quotes = Array.isArray(concept.sourceQuotes)
      ? concept.sourceQuotes.filter((quote): quote is string => typeof quote === "string")
      : [];
    const instructions = await getActiveInstructionsText(creative.business_id).catch(() => "");
    const warnings = copyClaimWarnings(
      parsed.data,
      [
        business.name,
        business.description,
        business.target_audience,
        ...(business.usps ?? []),
        ...(business.offers ?? []),
        ...(business.locations ?? []),
        instructions,
        ...quotes,
      ],
      business.vertical,
      // #1617: an AI picture can't be called "our work"; the owner's own photo can (#1901: the tile badge's flag).
      { ownPicture: pictureSource(generation) === "yours" },
    );

    const nextGeneration = {
      ...generation,
      concept: { ...concept, headline, primary_text, description, cta },
      editedAt: new Date().toISOString(),
    };
    const { data: saved, error: saveError } = await supabase
      .from("creatives")
      .update({ headline, primary_text, cta, generation: nextGeneration })
      .eq("id", id)
      .select("headline, primary_text, cta, generation")
      .maybeSingle();
    if (saveError) return { ok: false, error: saveError.message };
    if (!saved) return { ok: false, error: "We couldn't find this ad. It may have been deleted; refresh the page." };

    const { data: live } = await supabase
      .from("campaigns")
      .select("id")
      .eq("business_id", creative.business_id)
      .contains("creative_ids", [id])
      .not("meta_campaign_id", "is", null)
      .limit(1);

    await logEvent({
      businessId: creative.business_id,
      action: "creative.edit",
      entityType: "creative",
      entityId: id,
      details: { warnings: warnings.length },
    });
    revalidatePath("/studio");
    revalidatePath("/dashboard");
    revalidatePath("/campaigns");
    return {
      ok: true,
      warnings,
      creative: saved,
      ...(live?.length ? { liveNotice: "This ad is live on Meta; your edit applies to new campaigns." } : {}),
    };
  });
}

export async function setCreativeStatus(
  id: string,
  status: "draft" | "approved",
): Promise<ActionResult> {
  return observeAction("server.setCreativeStatus", async () => {
    const supabase = await createClient();
    if (status !== "draft" && status !== "approved") return { ok: false, error: "Invalid creative status." };
    const { data: creative, error } = await supabase
      .from("creatives")
      .update({ status })
      .eq("id", id)
      .select("business_id")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!creative) return { ok: false, error: "We couldn't find this ad. It may have been deleted; refresh the page." };
    if (creative) {
      await logEvent({
        businessId: creative.business_id,
        action: status === "approved" ? "creative.approve" : "creative.unapprove",
        entityType: "creative",
        entityId: id,
      });
    }
    revalidatePath("/studio");
    revalidatePath("/dashboard");
    revalidatePath("/campaigns");
    return { ok: true };
  });
}

export async function deleteCreative(id: string): Promise<ActionResult> {
  return observeAction("server.deleteCreative", async () => {
    const supabase = await createClient();
    const { data: creative, error } = await supabase
      .from("creatives")
      .delete()
      .select("business_id")
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!creative) return { ok: false, error: "We couldn't find this ad. It may have been deleted; refresh the page." };
    if (creative) {
      await logEvent({
        businessId: creative.business_id,
        action: "creative.delete",
        entityType: "creative",
        entityId: id,
      });
    }
    revalidatePath("/studio");
    revalidatePath("/dashboard");
    revalidatePath("/campaigns");
    return { ok: true };
  });
}
