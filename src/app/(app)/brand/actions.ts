"use server";

import { observeAction } from "@/lib/observability/logger";

import { revalidatePath } from "next/cache";
import { logEvent } from "@/lib/audit";
import { fieldList, fieldStr } from "@/lib/brand/fields";
import { brandUsable } from "@/lib/brand/usable";
import { SETUP_FIELDS, SETUP_FIELD_LIMITS, setupFieldErrors, setupFieldsFrom, setupLocations, setupPhone, type SetupBusinessFields } from "@/lib/brand/setup-fields";
import { normalizeWebsite, validateBrandFields } from "@/lib/brand/validation";
import { BRAND_LANGUAGE_NAME, CREATE_LANGUAGES } from "@/lib/languages";
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
    if (!saved) return { ok: false, error: "We couldn't find your business details. Reload the page." };

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
 * #1269 (WS1 step 1): autosave of the five setup fields and optional selling point (#1966).
 * A blank name never overwrites a saved one (a new business needs one first); an unfinished phone isn't
 * written; the first offer and optional USP are replaced and any others kept.
 */
export async function saveSetupBusiness(id: string | null, input: SetupBusinessFields): Promise<SetupSaveResult> {
  return observeAction("server.saveSetupBusiness", async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated." };
    const fields = Object.fromEntries(SETUP_FIELDS.map((key) => [key, String(input?.[key] ?? "").slice(0, SETUP_FIELD_LIMITS[key])])) as SetupBusinessFields;
    const usp = String(input?.usp ?? "").trim();
    const uspError = setupFieldErrors({ ...fields, usp }).usp;
    if (uspError) return { ok: false, error: uspError };
    const name = fields.name.trim();
    const phone = setupPhone(fields.phone) ? fields.phone.trim() : undefined;
    const columns = "id, name, vertical, phone, locations, offers";

    if (!id) {
      if (!name) return { ok: false, error: "Add your business name." };
      const offer = fields.offer.trim();
      const { data, error } = await supabase.from("businesses").insert({
        owner_id: user.id, name, vertical: fields.vertical.trim() || undefined, phone: phone ?? null,
        locations: setupLocations(fields.locations), offers: offer ? [offer] : [],
        ...(usp ? { usps: [usp] } : {}),
      }).select(columns).single();
      if (error || !data) {
        // #1657: the owner sees plain words; the database's own message goes to the logs only.
        console.error("[business.create]", error?.message ?? "no row");
        return { ok: false, error: "Your business details weren't saved. Check your connection and try again." };
      }
      return finish(data, "business.create");
    }

    const offer = fields.offer.trim();
    // #1401: a blank box (mid-retype) never touches saved offers; a typed one replaces only the first.
    let offers: string[] | undefined;
    let usps: string[] | undefined;
    if (offer || usp) {
      const { data: current, error: readError } = await supabase.from("businesses").select("offers, usps").eq("id", id).single();
      if (readError || !current) return { ok: false, error: "We couldn't find your business details. Reload the page." };
      if (offer) offers = [offer, ...(current.offers ?? []).slice(1)];
      if (usp) usps = [usp, ...(current.usps ?? []).slice(1)];
    }
    const { data, error } = await supabase.from("businesses").update({
      ...(name ? { name } : {}),
      ...(fields.vertical.trim() ? { vertical: fields.vertical.trim() } : {}),
      ...(phone !== undefined || !fields.phone.trim() ? { phone: phone ?? null } : {}),
      locations: setupLocations(fields.locations),
      ...(offers ? { offers } : {}),
      ...(usps ? { usps } : {}),
    }).eq("id", id).select(columns).single();
    if (error || !data) {
      console.error("[business.update]", error?.message ?? "no row");
      return { ok: false, error: error ? "Your business details weren't saved. Check your connection and try again." : "We couldn't find your business details. Reload the page." };
    }
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

/** #1681: the ad language picked before a first batch goes first in the Brand's languages, so later batches use it. */
export async function saveAdLanguage(id: string, language: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return observeAction("server.saveAdLanguage", async () => {
    const choice = CREATE_LANGUAGES.find((item) => item.id === language)?.id;
    if (!choice) return { ok: false, error: "Pick a language." };
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated." };
    const { data: current, error: readError } = await supabase.from("businesses").select("languages").eq("id", id).eq("owner_id", user.id).single();
    if (readError || !current) return { ok: false, error: "We couldn't find your business details. Reload the page." };
    const name = BRAND_LANGUAGE_NAME[choice];
    const rest = (current.languages ?? []).filter((item) => item.trim().toLowerCase() !== name.toLowerCase());
    const { error } = await supabase.from("businesses").update({ languages: [name, ...rest] }).eq("id", id).eq("owner_id", user.id);
    return error ? { ok: false, error: "Your language wasn't saved. Try again." } : { ok: true };
  });
}
