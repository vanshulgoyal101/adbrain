"use server";

import { revalidatePath } from "next/cache";
import { logEvent } from "@/lib/audit";
import { fieldList, fieldStr } from "@/lib/brand/fields";
import { validateBrandFields } from "@/lib/brand/validation";
import { createClient } from "@/lib/supabase/server";
import type { BusinessInsert } from "@/lib/types";

export type SaveState = { ok: boolean; error?: string };

function str(fd: FormData, key: string): string | null {
  return fieldStr(fd.get(key));
}

/** One-per-line fields. Commas are legitimate content ("Austin, Texas"). */
function lines(fd: FormData, key: string): string[] {
  return fieldList(fd.get(key), /\n/);
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
    vertical: str(formData, "vertical") ?? undefined,
    website: str(formData, "website"),
    description: str(formData, "description"),
    brand_voice: str(formData, "brand_voice"),
    primary_color: str(formData, "primary_color"),
    secondary_color: str(formData, "secondary_color"),
    font: str(formData, "font"),
    target_audience: str(formData, "target_audience"),
    phone: str(formData, "phone"),
    email: str(formData, "email"),
    address: str(formData, "address"),
    languages: lines(formData, "languages"),
    locations: lines(formData, "locations"),
    usps: lines(formData, "usps"),
    offers: lines(formData, "offers"),
    logo_url: str(formData, "logo_url"),
  };

  // The browser's native validation is a convenience, not a guarantee.
  const issues = validateBrandFields(payload);
  if (issues.length) {
    return { ok: false, error: issues.map((i) => i.message).join(" ") };
  }

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
