import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { MetaError } from "./client";
import { getManagedAccount } from "./managed-account";

/**
 * #758: a business whose owner must reconnect Meta (dead token) is reported in a cron's
 * `reauth` list instead of failing the whole scheduled run. The repo and workflow logs are
 * public, so the business is named only by an opaque key.
 */
export type ReauthEntry = { key: string; since: string; activeCampaigns: number };

// Thrown by withMetaConnection when the stored token or connection is unusable (connection-access.ts).
const CONNECTION_TOKEN_MESSAGES = new Set(["Meta credentials are unavailable.", "Meta is not connected for this business."]);

/** First 12 hex chars of sha256(business id); docs/OPERATIONS.md maps it back with SQL. */
function reauthKey(businessId: string): string {
  return createHash("sha256").update(businessId).digest("hex").slice(0, 12);
}

/** Graph 190 (any subcode). Same rule as #817's isMetaReauthError, by name so a reloaded module still matches. */
function isGraphTokenError(error: unknown): boolean {
  return error instanceof Error && (error instanceof MetaError || error.name === "MetaError") && (error as MetaError).code === 190;
}

/**
 * A Graph 190, or the connection-access refusal for a stored token or connection that is
 * expired, revoked or awaiting reauthorization. Duck-typed: tests mock connection-access.
 */
export function isTokenFailure(error: unknown): boolean {
  if (isGraphTokenError(error)) return true;
  if (!(error instanceof Error) || error.name !== "ConnectionAccessError") return false;
  return (error as Error & { code?: string }).code === "UNAVAILABLE" && CONNECTION_TOKEN_MESSAGES.has(error.message);
}

const expired = (value: string | null | undefined, now: number) =>
  Boolean(value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now);

/**
 * When the business's own Meta token was first known dead, or null when this failure is not a
 * dead owner token (a managed account, a healthy stored token, or a state that can't be read).
 * Meta steps that swallow their errors still count: the stored connection state decides.
 */
async function reauthSince(businessId: string, errors: readonly unknown[], now = new Date()): Promise<string | null> {
  const at = now.toISOString();
  const graph190 = errors.some(isGraphTokenError);
  try {
    // A managed account runs on AdBrain's token, never the owner's: its failure is ours.
    if (await getManagedAccount(businessId)) return null;
  } catch {
    return null;
  }
  try {
    const admin = createAdminClient();
    const { data: row, error } = await admin.from("meta_connections")
      .select("authorization_status, token_id, updated_at").eq("business_id", businessId).maybeSingle();
    if (error || !row) return graph190 ? at : null;
    const updatedAt = typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at)) ? row.updated_at : at;
    if (row.authorization_status === "reauth_required" || row.authorization_status === "revoked") return updatedAt;
    if (graph190) return at;
    if (row.authorization_status !== "connected") return null;
    if (!row.token_id) return updatedAt;
    const { data: tokens, error: tokenError } = await admin.rpc("meta_token_get", { p_token_id: row.token_id, p_business_id: businessId });
    const token = tokens?.[0];
    if (tokenError || !token) return null;
    if (token.revoked_at) return token.revoked_at;
    if (expired(token.expires_at, now.getTime())) return token.expires_at;
    if (expired(token.data_access_expires_at, now.getTime())) return token.data_access_expires_at;
    return null;
  } catch {
    return graph190 ? at : null;
  }
}

/** The `reauth` entry for a failed business, or null when the failure is a real one. */
export async function reauthEntry(businessId: string, errors: readonly unknown[], activeCampaigns?: number): Promise<ReauthEntry | null> {
  const since = await reauthSince(businessId, errors);
  if (!since) return null;
  return { key: reauthKey(businessId), since, activeCampaigns: activeCampaigns ?? await countActiveCampaigns(businessId) };
}

async function countActiveCampaigns(businessId: string): Promise<number> {
  try {
    const { count, error } = await createAdminClient().from("campaigns")
      .select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "active");
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

/** Records every error a Meta client method throws, for steps that swallow them (lead sync). */
export function recordMetaErrors<Client extends object>(client: Client, errors: unknown[]): Client {
  return new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const record = (error: unknown) => { errors.push(error); throw error; };
        try {
          const result = value.apply(target, args);
          return result instanceof Promise ? result.catch(record) : result;
        } catch (error) {
          return record(error);
        }
      };
    },
  });
}
