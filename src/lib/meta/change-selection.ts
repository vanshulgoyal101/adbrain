import { randomBytes } from "node:crypto";
import type { AttemptDTO, ConnectIntent } from "./connect-contracts";
import { getConnectionStatus, type AuthorizedBusiness } from "./connection-access";
import {
  attachAttemptToken,
  createBrowserBinding,
  createConnectionAttempt,
  markAttemptDiscovering,
} from "./connection-repository";
import { runAttemptDiscovery } from "./retry-discovery";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 'Change' on a connected business: list the Page / ad-account pairs the saved Facebook grant
 * already allows, without a new Facebook login (#474). Returns null when there is no usable
 * saved grant, so the caller asks for a reconnect instead. The selection is committed through
 * the normal attempt select path.
 */
export async function startSelectionChange(business: AuthorizedBusiness, intent: ConnectIntent): Promise<AttemptDTO | null> {
  const connection = await getConnectionStatus(business);
  if (connection.authorization !== "connected" || !connection.selected) return null;
  const { data: row, error } = await createAdminClient()
    .from("meta_connections")
    .select("token_id, generation")
    .eq("business_id", business.businessId)
    .maybeSingle();
  if (error || !row?.token_id || row.generation !== connection.generation) return null;

  // No OAuth callback ever claims this attempt, so its state is a random value nobody holds.
  const { attemptId } = await createConnectionAttempt({
    businessId: business.businessId,
    userId: business.userId,
    intent,
    state: randomBytes(32).toString("base64url"),
    browserBinding: createBrowserBinding(),
    expectedGeneration: connection.generation,
  });
  await markAttemptDiscovering(attemptId);
  await attachAttemptToken(attemptId, row.token_id);
  return runAttemptDiscovery(attemptId, business.userId);
}
