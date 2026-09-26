import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { z } from "zod";
import { LeadSyncError, syncMetaLeads } from "@/lib/leads/sync";
import { friendlyMetaError } from "@/lib/meta/client";
import {
  ConnectionAccessError,
  requireOwnedBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import type { Lead } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Pull instant-form leads from Meta into the leads inbox (dedup by meta id). */
export const POST = observeRoute("/api/leads/sync", "POST", handlePOST);

async function handlePOST(request?: Request) {
  const signal = AbortSignal.timeout(40_000);
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

  let syncId: string | undefined;
  try {
    const input = request ? await request.text() : "";
    if (input.length > 1024) throw new Error("Invalid input");
    syncId = z.object({ syncId: z.uuid().optional() }).strict().parse(input ? JSON.parse(input) : {}).syncId;
  } catch {
    return NextResponse.json({ error: "Provide a valid syncId or an empty request." }, { status: 400 });
  }
  let synced;
  try {
    const context = await requireOwnedBusiness(business.id);
    synced = await withMetaConnection(
      context,
      { purpose: "read_leads", signal },
      (meta, connection) => syncMetaLeads(context, connection, meta, syncId, signal),
    );
  } catch (err) {
    if (err instanceof LeadSyncError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof ConnectionAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 400 });
    }
    return NextResponse.json(
      { error: friendlyMetaError(err, "Could not sync leads.") },
      { status: 502 },
    );
  }

  const { imported, failedForms, sync, error, status } = synced;
  if (status === 404 || status === 409) return NextResponse.json({ error, imported, failedForms, sync }, { status });

  const { data: fresh, error: readError } = await supabase
    .from("leads")
    .select("*")
    .eq("business_id", business.id)
    .order("created_time", { ascending: false, nullsFirst: false })
    .limit(200)
    .abortSignal(AbortSignal.timeout(3_000));
  if (readError) return NextResponse.json({ error: "Could not reload saved leads. Your existing enquiries are still available.", imported, failedForms, sync }, { status: 503 });

  await logEvent({
    businessId: business.id,
    action: "leads.sync",
    entityType: "lead",
    reason: `Imported ${imported} new lead(s); ${failedForms.length} form(s) failed`,
    details: { imported, failedForms: failedForms.length, state: sync.state },
  });

  return NextResponse.json({ leads: (fresh ?? []) as Lead[], imported, failedForms, sync, error }, { status });
}
