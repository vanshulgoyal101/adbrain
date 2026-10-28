"use server";

import { observeAction } from "@/lib/observability/logger";

import { revalidatePath } from "next/cache";
import { logEvent } from "@/lib/audit";
import { fieldList, fieldStr } from "@/lib/brand/fields";
import { brandUsable } from "@/lib/brand/usable";
import { SETUP_FIELDS, SETUP_FIELD_LIMITS, setupFieldsFrom, setupLocations, setupPhone, type SetupBusinessFields } from "@/lib/brand/setup-fields";
import { normalizeWebsite, validateBrandFields } from "@/lib/brand/validation";
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
  return observeAction("server.saveBusiness", async () => {
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
    // Stored as a full link, so Prepare and Meta can use it as typed (#470).
    payload.website = normalizeWebsite(payload.website);

    const query = id
      ? supabase.from("businesses").update(payload).eq("id", id).select("id").single()
      : supabase.from("businesses").insert(payload).select("id").single();

    const { data: saved, error } = await query;
    if (error) return { ok: false, error: error.message };
    if (!saved) return { ok: false, error: "Brand not found or no longer accessible." };

    await logEvent({
      businessId: saved.id,
      action: id ? "business.update" : "business.create",
      entityType: "business",
      entityId: saved.id,
      eventAttributes: { brandUsable: brandUsable(payload) },
    });

    revalidatePath("/brand");
    revalidatePath("/dashboard");
    revalidatePath("/studio");
    return { ok: true };
  });
}

export type SetupSaveResult = { ok: true; id: string; usable: boolean } | { ok: false; error: string };

/**
 * #1269 (WS1 step 1): autosave of the five setup fields only, so nothing else on the Brand is touched.
 * A blank name never overwrites a saved one (a new business needs one first); an unfinished phone isn't
 * written; the first offer is replaced and any others kept.
 */
export async function saveSetupBusiness(id: string | null, input: SetupBusinessFields): Promise<SetupSaveResult> {
  return observeAction("server.saveSetupBusiness", async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated." };
    const fields = Object.fromEntries(SETUP_FIELDS.map((key) => [key, String(input?.[key] ?? "").slice(0, SETUP_FIELD_LIMITS[key])])) as SetupBusinessFields;
    const name = fields.name.trim();
    const phone = setupPhone(fields.phone) ? fields.phone.trim() : undefined;
    const columns = "id, name, vertical, phone, locations, offers";

    if (!id) {
      if (!name) return { ok: false, error: "Add your business name." };
      const offer = fields.offer.trim();
      const { data, error } = await supabase.from("businesses").insert({
        owner_id: user.id, name, vertical: fields.vertical.trim() || undefined, phone: phone ?? null,
        locations: setupLocations(fields.locations), offers: offer ? [offer] : [],
      }).select(columns).single();
      if (error || !data) return { ok: false, error: error?.message ?? "Your business could not be saved." };
      return finish(data, "business.create");
    }

    const { data: current, error: readError } = await supabase.from("businesses").select("offers").eq("id", id).single();
    if (readError || !current) return { ok: false, error: "Brand not found or no longer accessible." };
    const offer = fields.offer.trim();
    const rest = (current.offers ?? []).slice(1);
    const { data, error } = await supabase.from("businesses").update({
      ...(name ? { name } : {}),
      ...(fields.vertical.trim() ? { vertical: fields.vertical.trim() } : {}),
      ...(phone !== undefined || !fields.phone.trim() ? { phone: phone ?? null } : {}),
      locations: setupLocations(fields.locations),
      offers: offer ? [offer, ...rest] : rest,
    }).eq("id", id).select(columns).single();
    if (error || !data) return { ok: false, error: error?.message ?? "Brand not found or no longer accessible." };
    return finish(data, "business.update");
  });

  async function finish(row: { id: string; name: string; vertical: string | null; phone: string | null; locations: string[] | null; offers: string[] | null },
    action: "business.create" | "business.update"): Promise<SetupSaveResult> {
    const usable = brandUsable({ ...row, vertical: setupFieldsFrom(row).vertical });
    await logEvent({ businessId: row.id, action, entityType: "business", entityId: row.id, eventAttributes: { brandUsable: usable } });
    revalidatePath("/brand");
    revalidatePath("/dashboard");
    return { ok: true, id: row.id, usable };
  }
}
