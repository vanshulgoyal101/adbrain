import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { parseLeadFields } from "@/lib/leads/parse";
import { friendlyMetaError } from "@/lib/meta/client";
import {
  ConnectionAccessError,
  requireOwnedBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import type { Json, Lead, LeadInsert } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Pull instant-form leads from Meta into the leads inbox (dedup by meta id). */
export const POST = observeRoute("/api/leads/sync", "POST", handlePOST);

async function handlePOST() {
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

  let forms;
  let rows: LeadInsert[];
  let failedForms: { id: string; name: string }[] = [];
  try {
    const context = await requireOwnedBusiness(business.id);
    const synced = await withMetaConnection(
      context,
      { purpose: "read_leads" },
      async (meta) => {
        const availableForms = await meta.listLeadForms();
        const imported: LeadInsert[] = [];
        const failed: { id: string; name: string }[] = [];
        for (let offset = 0; offset < availableForms.length; offset += 3) {
          const batch = await Promise.all(availableForms.slice(offset, offset + 3).map(async (form) => {
            try {
              return { form, leads: await meta.listLeadsForForm(form.id) };
            } catch {
              return { form, leads: null };
            }
          }));
          for (const { form, leads } of batch) {
            if (!leads) {
              failed.push({ id: form.id, name: form.name });
              continue;
            }
            for (const lead of leads) {
              const parsed = parseLeadFields(lead.field_data);
              imported.push({
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
        }
        return { forms: availableForms, rows: imported, failedForms: failed };
      },
    );
    forms = synced.forms;
    rows = synced.rows;
    failedForms = synced.failedForms;
  } catch (err) {
    if (err instanceof ConnectionAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 400 });
    }
    return NextResponse.json(
      { error: friendlyMetaError(err, "Could not sync leads.") },
      { status: 502 },
    );
  }

  if (forms.length > 0 && failedForms.length === forms.length) {
    return NextResponse.json({ error: "Could not read leads from any form. Check Meta lead access and retry.", failedForms }, { status: 502 });
  }

  let imported = 0;
  if (rows.length) {
    const { error: upsertError, count } = await supabase
      .from("leads")
      .upsert(rows, { onConflict: "business_id,meta_lead_id", ignoreDuplicates: true, count: "exact" });
    if (upsertError) {
      return serverError("leads.sync", upsertError, "Could not save leads.");
    }
    if (count === null) return NextResponse.json({ error: "Leads were saved, but the import count could not be verified. Retry to refresh your inbox." }, { status: 503 });
    imported = count;
  }

  const { data: fresh, error: readError } = await supabase
    .from("leads")
    .select("*")
    .eq("business_id", business.id)
    .order("created_time", { ascending: false, nullsFirst: false });
  if (readError) return serverError("leads.sync", readError, "Could not reload saved leads. Your existing enquiries are still available.");

  await logEvent({
    businessId: business.id,
    action: "leads.sync",
    entityType: "lead",
    reason: `Imported ${imported} new lead(s); ${failedForms.length} form(s) failed`,
    details: { forms: forms.length, fetched: rows.length, imported, failedForms: failedForms.length },
  });

  return NextResponse.json({ leads: (fresh ?? []) as Lead[], imported, failedForms });
}
