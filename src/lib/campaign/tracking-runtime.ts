import {
  ConnectionAccessError,
  getConnectionStatus,
  requireOwnedBusiness,
  withMetaConnection,
  type AuthorizedBusiness,
} from "@/lib/meta/connection-access";
import { cachedTrackingStatus } from "@/lib/meta/pixels";
import { accountTrackingDtoSchema } from "@/lib/meta/tracking-contracts";

export { ConnectionAccessError, requireOwnedBusiness };

export async function readAccountTracking(actor: AuthorizedBusiness, fresh: boolean) {
  const before = await getConnectionStatus(actor);
  if (before.businessId !== actor.businessId) {
    throw new ConnectionAccessError("CONFLICT", "Meta connection changed.");
  }
  if (before.authorization === "reauth_required" || before.authorization === "revoked") {
    return { kind: "reauth_required" } as const;
  }
  if (before.authorization !== "connected" || !before.selected) {
    throw new ConnectionAccessError("CONFLICT", "Meta connection changed.");
  }
  const binding = { adAccountId: before.selected.adAccountId, pageId: before.selected.pageId };
  const data = await withMetaConnection(actor, {
    purpose: "read_insights", expectedGeneration: before.generation, binding, event: false,
  }, async (meta, connection) => {
    if (connection.businessId !== actor.businessId || connection.generation !== before.generation
      || connection.selected?.adAccountId !== binding.adAccountId || connection.selected?.pageId !== binding.pageId) {
      throw new ConnectionAccessError("CONFLICT", "Meta connection changed.");
    }
    const status = await cachedTrackingStatus(meta, connection, { fresh });
    return accountTrackingDtoSchema.parse({ businessId: actor.businessId, connectionGeneration: connection.generation, binding, status });
  });
  const current = await getConnectionStatus(actor);
  if (current.businessId !== actor.businessId || current.authorization !== "connected"
    || current.generation !== data.connectionGeneration || current.selected?.adAccountId !== data.binding.adAccountId
    || current.selected?.pageId !== data.binding.pageId) {
    throw new ConnectionAccessError("CONFLICT", "Meta connection changed.");
  }
  return { kind: "ok", data } as const;
}
