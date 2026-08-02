"use server";

import { revalidatePath } from "next/cache";
import { logEvent } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; error?: string };

export async function setCreativeStatus(
  id: string,
  status: "draft" | "approved",
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: creative } = await supabase
    .from("creatives")
    .select("business_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("creatives")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
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
  return { ok: true };
}

export async function deleteCreative(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: creative } = await supabase
    .from("creatives")
    .select("business_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("creatives").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
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
  return { ok: true };
}
