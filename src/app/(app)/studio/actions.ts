"use server";

import { observeAction } from "@/lib/observability/logger";

import { revalidatePath } from "next/cache";
import { logEvent } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; error?: string };

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
  if (!creative) return { ok: false, error: "Creative not found or no longer accessible." };
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
  if (!creative) return { ok: false, error: "Creative not found or no longer accessible." };
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
