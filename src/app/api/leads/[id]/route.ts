import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { leadUpdateSchema } from "@/lib/leads/filters";
import { observeRoute } from "@/lib/observability/logger";
import { logEvent } from "@/lib/audit";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { recordCustomerMark } from "@/lib/leads/customer-event";
import { ownerError } from "@/i18n/request-locale";

export const PATCH = observeRoute("/api/leads/[id]", "PATCH", async (
  request: Request, context: { params: Promise<{ id: string }> },
) => {
  try {
    const database = await createClient();
    const { data: { user } } = await database.auth.getUser();
    if (!user) return NextResponse.json({ error: await ownerError("signInRequired") }, { status: 401 });
    const id = z.uuid().parse((await context.params).id);
    const update = leadUpdateSchema.parse(await request.json());
    const business = await getPrimaryBusiness();
    if (!business) return NextResponse.json({ error: await ownerError("businessMissing") }, { status: 404 });
    const { contacted, ...fields } = update;
    if (contacted) {
      // #1049: the first tap only; later taps keep the first time. A new enquiry becomes "contacted".
      // #1140: only a still-new enquiry gets a first reply time, so a tap on an older lead can't record weeks as a reply.
      const now = new Date().toISOString();
      const first = await database.from("leads").update({ first_contacted_at: now, workflow_status: "contacted" })
        .eq("id", id).eq("business_id", business.id).eq("workflow_status", "new").is("first_contacted_at", null);
      const status = await database.from("leads").update({ workflow_status: "contacted" })
        .eq("id", id).eq("business_id", business.id).eq("workflow_status", "new");
      if (first.error || status.error) throw new Error("Save failed");
    }
    // #2026: the status before the save, so a change to or from "customer" is recorded once it's saved.
    const before = fields.workflow_status === undefined ? null
      : (await database.from("leads").select("workflow_status").eq("id", id).eq("business_id", business.id).maybeSingle()).data;
    const query = Object.keys(fields).length
      ? database.from("leads").update(fields).eq("id", id).eq("business_id", business.id).select("*").maybeSingle()
      : database.from("leads").select("*").eq("id", id).eq("business_id", business.id).maybeSingle();
    const { data, error } = await query;
    if (error) throw new Error("Save failed");
    if (!data) return NextResponse.json({ error: await ownerError("enquiryNotFound") }, { status: 404 });
    if (before && (before.workflow_status === "customer") !== (data.workflow_status === "customer")) {
      recordCustomerMark({ businessId: business.id, campaignId: data.campaign_id, source: "inbox", undone: data.workflow_status !== "customer" });
    }
    return NextResponse.json({ lead: data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    return NextResponse.json({ error: invalid ? "Invalid follow-up." : "Your status and note weren't saved. Try again." }, { status: invalid ? 400 : 503 });
  }
});

/**
 * #1761 (DPDP erasure, #1758): the owner deletes one enquiry for good. `leads_erase` runs under RLS (their own
 * business only) and leaves a hashed tombstone so lead sync never brings it back. The audit row holds ids only.
 */
export const DELETE = observeRoute("/api/leads/[id]", "DELETE", async (
  _request: Request, context: { params: Promise<{ id: string }> },
) => {
  const database = await createClient();
  const { data: { user } } = await database.auth.getUser();
  if (!user) return NextResponse.json({ error: await ownerError("signInRequired") }, { status: 401 });
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ error: "Invalid enquiry." }, { status: 400 });
  const limited = await rateLimitResponse(`lead-erase:${user.id}`, { limit: 60, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const business = await getPrimaryBusiness();
  if (!business) return NextResponse.json({ error: await ownerError("businessMissing") }, { status: 404 });
  const { data, error } = await database.rpc("leads_erase", { p_business_id: business.id, p_lead_id: id.data });
  if (error) return NextResponse.json({ error: await ownerError("enquiryNotDeleted") }, { status: 503 });
  if (!data) return NextResponse.json({ error: await ownerError("enquiryNotFound") }, { status: 404 });
  await logEvent({ businessId: business.id, action: "lead.deleted", entityType: "lead", entityId: id.data, details: { count: data } });
  return NextResponse.json({ ok: true, deleted: data });
});

