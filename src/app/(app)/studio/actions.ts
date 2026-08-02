"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; error?: string };

export async function setCreativeStatus(
  id: string,
  status: "draft" | "approved",
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("creatives")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/studio");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteCreative(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("creatives").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/studio");
  revalidatePath("/dashboard");
  return { ok: true };
}
