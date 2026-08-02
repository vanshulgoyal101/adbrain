"use server";

import { revalidatePath } from "next/cache";
import { logEvent } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import type { BusinessInsert } from "@/lib/types";

export type SaveState = { ok: boolean; error?: string };

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
}

function list(fd: FormData, key: string): string[] {
  const v = fd.get(key);
  if (typeof v !== "string") return [];
  return v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function saveBusiness(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const name = str(formData, "name");
  if (!name) return { ok: false, error: "Business name is required." };

  const id = str(formData, "id");
  const payload: BusinessInsert = {
    owner_id: user.id,
    name,
    website: str(formData, "website"),
    description: str(formData, "description"),
    brand_voice: str(formData, "brand_voice"),
    primary_color: str(formData, "primary_color"),
    secondary_color: str(formData, "secondary_color"),
    font: str(formData, "font"),
    target_audience: str(formData, "target_audience"),
    languages: list(formData, "languages"),
    locations: list(formData, "locations"),
    usps: list(formData, "usps"),
    offers: list(formData, "offers"),
    logo_url: str(formData, "logo_url"),
  };

  const query = id
    ? supabase.from("businesses").update(payload).eq("id", id).select("id").single()
    : supabase.from("businesses").insert(payload).select("id").single();

  const { data: saved, error } = await query;
  if (error) return { ok: false, error: error.message };

  if (saved) {
    await logEvent({
      businessId: saved.id,
      action: id ? "business.update" : "business.create",
      entityType: "business",
      entityId: saved.id,
    });
  }

  revalidatePath("/brand");
  revalidatePath("/dashboard");
  revalidatePath("/studio");
  return { ok: true };
}
