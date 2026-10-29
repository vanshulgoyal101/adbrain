import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { observeRoute, recordProductEvent } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ownerError } from "@/i18n/request-locale";

export const runtime = "nodejs";

/**
 * "Ask for Facebook access" (#692, #725): the owner's request is written to the audit log before the
 * page says "Request sent", so a dropped analytics beacon can't lose a lead. One record per user per
 * UTC day; `/api/cron/access-requests` reads it.
 */
export const POST = observeRoute("/api/meta/access-request", "POST", handlePOST);

async function handlePOST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);
  const limited = await rateLimitResponse(`meta-access-request:${user.id}`, { limit: 5, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const parsed = z.object({ businessId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("A business is required.", 400);

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing, error: readError } = await admin.from("audit_log").select("id")
    .eq("action", "meta.access_request").eq("actor_id", user.id).gte("created_at", `${today}T00:00:00Z`)
    .limit(1).abortSignal(AbortSignal.timeout(5_000));
  if (readError) return apiError(await ownerError("requestNotSent"), 503);
  if (!existing?.length) {
    // The RPC refuses a business this user doesn't own.
    const { error } = await admin.rpc("append_verified_audit_event", {
      p_business_id: parsed.data.businessId, p_actor_id: user.id, p_action: "meta.access_request",
      p_entity_type: "business", p_entity_id: parsed.data.businessId,
    }).abortSignal(AbortSignal.timeout(5_000));
    if (error) {
      return error.code === "42501" ? apiError(await ownerError("businessMissing"), 404) : apiError(await ownerError("requestNotSent"), 503);
    }
    recordProductEvent({ kind: "workflow", name: "meta.access_request", outcome: "success", businessId: parsed.data.businessId });
  }
  return NextResponse.json({ ok: true });
}
