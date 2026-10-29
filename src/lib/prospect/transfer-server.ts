import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// The transfer functions aren't in the generated database types yet.
const untyped = (client: unknown) => client as SupabaseClient;

export type PendingClaim = { transferId: string; businessName: string; ads: number; images: string[] };

/** #1670: the hand-over waiting for the signed-in user's confirmed address (Home asks about it); null when none or unreadable. */
export async function myPendingTransfer(): Promise<PendingClaim | null> {
  const supabase = untyped(await createClient());
  const { data, error } = await supabase.rpc("business_transfer_mine");
  const row = !error && Array.isArray(data) ? data[0] : null;
  if (!row?.transfer_id) return null;
  return { transferId: row.transfer_id, businessName: row.business_name, ads: row.ads ?? 0, images: (row.images ?? []).slice(0, 3) };
}

export type RepTransferState = {
  blocker: string | null;
  latest: { targetEmail: string; state: "pending" | "claimed" | "cancelled" | "declined" | "expired"; expiresAt: string; updatedAt: string } | null;
};

/** #1670: what the rep's Settings shows for their prospect business: the pre-check and the latest hand-over. */
export async function repTransferState(businessId: string): Promise<RepTransferState | null> {
  const admin = untyped(createAdminClient());
  const [check, status] = await Promise.all([
    admin.rpc("business_transfer_check", { p_business_id: businessId }),
    admin.rpc("business_transfer_status", { p_business_id: businessId }),
  ]);
  if (check.error || status.error) return null;
  const row = Array.isArray(status.data) ? status.data[0] : null;
  return {
    blocker: typeof check.data === "string" ? check.data : null,
    latest: row ? { targetEmail: row.target_email, state: row.state, expiresAt: row.expires_at, updatedAt: row.updated_at } : null,
  };
}
