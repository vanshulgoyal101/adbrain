import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { isInternalUser } from "@/lib/internal-accounts";
import { observeRoute } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * #1670: the owner answers Home's "Make {business} yours?": `accept` moves the business to their own login, `decline`
 * ("This isn't my business") turns it down so the rep sees it. The database checks the signed-in user's confirmed
 * address is the one the rep typed, the expiry, single use, one business per account and the pre-checks.
 */
export const POST = observeRoute("/api/prospect/claim", "POST", handlePOST);

const schema = z.object({ transferId: z.uuid(), decision: z.enum(["accept", "decline"]) }).strict();

async function handlePOST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("Invalid request.", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);
  // Reviewer, point 5: a team or listed account would keep the business internal.
  if (parsed.data.decision === "accept" && isInternalUser(user)) return apiError("Sign in with the owner's own email, not a team account.", 403);
  // The transfer functions aren't in the generated database types yet.
  const db = supabase as unknown as SupabaseClient;
  if (parsed.data.decision === "decline") {
    const { error } = await db.rpc("business_transfer_decline", { p_transfer_id: parsed.data.transferId });
    return error ? apiError("Couldn't answer. Try again.", 503) : NextResponse.json({ ok: true });
  }
  const { data: businessId, error } = await db.rpc("business_transfer_claim", { p_transfer_id: parsed.data.transferId });
  if (error || typeof businessId !== "string") {
    if (error?.code === "23505") return apiError(error.message, 409);
    if (error?.code === "22023" || error?.code === "42501") return apiError(error.message, 409);
    if (error?.code === "23514") return apiError("This business can't be handed over right now. Ask the person from AdBrain.", 409);
    return apiError("Couldn't make it yours. Try again.", 503);
  }
  return NextResponse.json({ ok: true, businessId });
}
