import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { isProspectAccount } from "@/lib/internal-accounts";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * #1670: a rep hands a prepared `+prospect` business to its owner (CTO design + Reviewer's points). POST starts a
 * 30-minute hand-over to the owner's email; DELETE cancels it. Only the business's own `+prospect` session may do
 * either; the database re-checks that and the #1486 pre-checks (no Meta, campaigns, payments or alerts).
 */
export const POST = observeRoute("/api/prospect/transfer", "POST", handlePOST);
export const DELETE = observeRoute("/api/prospect/transfer", "DELETE", handleDELETE);

const startSchema = z.object({ businessId: z.uuid(), ownerEmail: z.email().max(254) }).strict();
const cancelSchema = z.object({ businessId: z.uuid() }).strict();

type Found = { refused: Response } | { refused: null; user: User; business: { id: string; name: string } };

/** The rep's own prospect business, or the response that refuses. */
async function prospectBusiness(businessId: string): Promise<Found> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { refused: apiError("Unauthorized", 401) };
  if (!isProspectAccount(user)) return { refused: apiError("Only a sales prospect account can hand its business over.", 403) };
  const { data: business } = await supabase.from("businesses").select("id, name, owner_id").eq("id", businessId).maybeSingle();
  if (!business || business.owner_id !== user.id) return { refused: apiError("Business not found.", 404) };
  return { refused: null, user, business };
}

// The transfer functions aren't in the generated database types yet.
const transfers = () => createAdminClient() as unknown as SupabaseClient;

/** The pre-check that blocked, in the rep's words. */
const REASONS: Record<string, string> = {
  "public.meta_connections": "it has a Meta connection",
  "public.campaigns": "it has a campaign",
  "private.meta_tokens": "it has Meta access saved",
  "private.meta_connection_attempts": "someone started connecting Meta",
  "public.managed_meta_accounts": "it has an AdBrain-managed ad account",
  "public.owner_alert_prefs": "WhatsApp alerts were set up",
  "private.production_payment_orders": "it has payments",
  "private.razorpay_test_orders": "it has test payments",
};

async function handlePOST(req: Request) {
  const parsed = startSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("Type the owner's email address.", 400);
  const found = await prospectBusiness(parsed.data.businessId);
  if (found.refused) return found.refused;
  const limited = await rateLimitResponse(`prospect-transfer:${found.user.id}`, { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

  // 32 random bytes; only the SHA-256 is stored (Reviewer, point 3).
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: transferId, error } = await transfers().rpc("business_transfer_start", {
    p_business_id: found.business.id, p_from_user_id: found.user.id, p_target_email: parsed.data.ownerEmail, p_token_hash: tokenHash,
  });
  if (error || typeof transferId !== "string") {
    if (error?.code === "23514") {
      const why = REASONS[error.details ?? ""];
      return apiError(`This business can't be handed over yet${why ? `: ${why}` : ""}. Ask AdBrain.`, 409);
    }
    if (error?.code === "42501") return apiError("Only a sales prospect account can hand its business over.", 403);
    if (error?.code === "22023") return apiError(error.message, 400);
    return apiError("Couldn't start the hand-over. Try again.", 503);
  }
  return NextResponse.json({ ok: true, ownerEmail: parsed.data.ownerEmail.trim().toLowerCase(), expiresInMinutes: 30 });
}

async function handleDELETE(req: Request) {
  const parsed = cancelSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("Invalid business.", 400);
  const found = await prospectBusiness(parsed.data.businessId);
  if (found.refused) return found.refused;
  const { error } = await transfers().rpc("business_transfer_cancel", { p_business_id: found.business.id, p_from_user_id: found.user.id });
  if (error) return apiError("Couldn't cancel the hand-over. Try again.", 503);
  return NextResponse.json({ ok: true });
}
