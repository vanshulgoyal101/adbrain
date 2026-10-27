import { getConnectionStatus, requireOwnedBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import { setupChecklist, type SetupRow } from "@/lib/meta/setup-checklist";

/** #1016: the owner's Meta setup checklist, read through the owned connection (GETs only). Null before a connection. */
export async function readSetupChecklist(businessId: string): Promise<SetupRow[] | null> {
  const context = await requireOwnedBusiness(businessId);
  const connection = await getConnectionStatus(context);
  if (connection.authorization !== "connected" || !connection.selected) return null;
  const selected = connection.selected;
  const reads = await withMetaConnection(context, { purpose: "read_insights" }, (meta) => meta.setupReads());
  return setupChecklist(reads, selected);
}
