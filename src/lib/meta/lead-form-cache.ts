import type { ConnectionDTO } from "@/lib/meta/connect-contracts";
import type { LeadForm, MetaClient } from "@/lib/meta/client";

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { forms: LeadForm[]; expiresAt: number }>();

/**
 * A Page's active lead forms, kept for ten minutes per business, Page and connection
 * generation (#271). A reconnect changes the generation; `fresh` re-reads Meta (retry).
 * Callers pass the connection `withMetaConnection` verified, so a hit is never shared
 * across businesses or connections.
 */
export async function cachedLeadForms(meta: MetaClient, connection: ConnectionDTO | undefined, options: { fresh?: boolean } = {}): Promise<LeadForm[]> {
  const pageId = connection?.selected?.pageId;
  if (!connection || !pageId) return meta.listLeadForms();
  const key = `${connection.businessId}:${pageId}:${connection.generation}`;
  const hit = cache.get(key);
  if (!options.fresh && hit && hit.expiresAt > Date.now()) return hit.forms;
  const forms = await meta.listLeadForms();
  cache.delete(key);
  cache.set(key, { forms, expiresAt: Date.now() + TTL_MS });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return forms;
}

export function resetLeadFormCache() {
  cache.clear();
}
