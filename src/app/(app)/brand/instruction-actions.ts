"use server";

import { observeAction } from "@/lib/observability/logger";

import { revalidatePath } from "next/cache";
import { logEvent } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";

export type InstructionResult = { ok: boolean; error?: string };

export async function saveInstruction(input: {
  id?: string;
  businessId: string;
  title: string;
  content: string;
  isActive: boolean;
}): Promise<InstructionResult> {
  return observeAction("server.saveInstruction", async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title is required." };

  const payload = {
    business_id: input.businessId,
    title,
    content: input.content,
    is_active: input.isActive,
  };

  const query = input.id
    ? supabase
        .from("ad_instructions")
        .update(payload)
        .eq("id", input.id)
        .eq("business_id", input.businessId)
        .select("id")
        .single()
    : supabase.from("ad_instructions").insert(payload).select("id").single();

  const { data: saved, error } = await query;
  if (error) return { ok: false, error: error.message };
  if (!saved) return { ok: false, error: "Instruction not found or no longer accessible." };

  if (saved) {
    await logEvent({
      businessId: input.businessId,
      action: input.id ? "instruction.update" : "instruction.create",
      entityType: "instruction",
      entityId: saved.id,
      reason: title,
      details: { is_active: input.isActive },
    });
  }

  revalidatePath("/brand");
  revalidatePath("/studio");
  return { ok: true };

  });
}

export async function deleteInstruction(
  id: string,
  businessId: string,
): Promise<InstructionResult> {
  return observeAction("server.deleteInstruction", async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const { data: deleted, error } = await supabase
    .from("ad_instructions")
    .delete()
    .eq("id", id)
    .eq("business_id", businessId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!deleted) return { ok: false, error: "Instruction not found or no longer accessible." };

  await logEvent({
    businessId,
    action: "instruction.delete",
    entityType: "instruction",
    entityId: id,
  });

  revalidatePath("/brand");
  revalidatePath("/studio");
  return { ok: true };

  });
}
