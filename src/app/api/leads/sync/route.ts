import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { parseLeadFields } from "@/lib/leads/parse";
import { MetaError, metaClientFromEnv } from "@/lib/meta/client";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import type { Json, Lead, LeadInsert } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Pull instant-form leads from Meta into the leads inbox (dedup by meta id). */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const business = await getPrimaryBusiness();
  if (!business) {
    return NextResponse.json({ error: "No business found" }, { status: 400 });
  }

  const meta = metaClientFromEnv();
  if (!meta) {
    return NextResponse.json({ error: "Meta is not configured" }, { status: 400 });
  }

  let forms;
  try {
    forms = await meta.listLeadForms();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof MetaError ? err.message : (err as Error).message },
      { status: 502 },
    );
  }

  const rows: LeadInsert[] = [];
  for (const form of forms) {
    let leads;
    try {
      leads = await meta.listLeadsForForm(form.id);
    } catch {
      // A form the token can't read (missing leads_retrieval) — skip it.
      continue;
    }
    for (const lead of leads) {
      const parsed = parseLeadFields(lead.field_data);
      rows.push({
        business_id: business.id,
        meta_lead_id: lead.id,
        form_id: form.id,
        form_name: form.name,
        full_name: parsed.fullName,
        phone: parsed.phone,
        email: parsed.email,
        city: parsed.city,
        field_data: parsed.fields as unknown as Json,
        created_time: lead.created_time ?? null,
      });
    }
  }

  if (rows.length === 0) {
    const { data } = await supabase
      .from("leads")
      .select("*")
      .eq("business_id", business.id)
      .order("created_time", { ascending: false, nullsFirst: false });
    return NextResponse.json({ leads: (data ?? []) as Lead[], imported: 0 });
  }

  const { error: upsertError } = await supabase
    .from("leads")
    .upsert(rows, { onConflict: "business_id,meta_lead_id", ignoreDuplicates: true });
  if (upsertError) {
    return serverError("leads.sync", upsertError, "Could not save leads.");
  }

  const { data: fresh } = await supabase
    .from("leads")
    .select("*")
    .eq("business_id", business.id)
    .order("created_time", { ascending: false, nullsFirst: false });

  await logEvent({
    businessId: business.id,
    action: "leads.sync",
    entityType: "lead",
    reason: `Synced ${rows.length} lead(s) from ${forms.length} form(s)`,
    details: { forms: forms.length, fetched: rows.length },
  });

  return NextResponse.json({ leads: (fresh ?? []) as Lead[], imported: rows.length });
}
