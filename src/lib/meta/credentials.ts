import { createClient } from "@/lib/supabase/server";
import {
  MetaClient,
  getMetaCredentialsFromEnv,
  type MetaCredentials,
} from "./client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

/** Non-sensitive view of a business's Meta connection, safe to send to the UI. */
export interface MetaConnection {
  source: "oauth" | "env" | "none";
  /** An OAuth connection exists but no ad account / page has been chosen yet. */
  pending: boolean;
  /** A complete connection ready to run campaigns. */
  ready: boolean;
  adAccountId: string | null;
  pageId: string | null;
  tokenExpiresAt: string | null;
  expired: boolean;
  scopes: string[];
}

interface StoredRow {
  ad_account_id: string | null;
  page_id: string | null;
  access_token: string;
  token_type: string;
  token_expires_at: string | null;
  scopes: string | null;
}

async function getStoredRow(
  businessId: string,
  db?: SupabaseClient<Database>,
): Promise<StoredRow | null> {
  const supabase = db ?? (await createClient());
  const { data } = await supabase
    .from("meta_credentials")
    .select(
      "ad_account_id, page_id, access_token, token_type, token_expires_at, scopes",
    )
    .eq("business_id", businessId)
    .maybeSingle();
  return (data as StoredRow | null) ?? null;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

/**
 * Resolve the Meta credentials to use for a business: a complete, non-expired
 * stored OAuth connection wins; otherwise fall back to single-tenant env creds.
 */
export async function resolveMetaCredentials(
  businessId: string,
  db?: SupabaseClient<Database>,
): Promise<MetaCredentials | null> {
  const row = await getStoredRow(businessId, db);
  if (
    row?.access_token &&
    row.ad_account_id &&
    row.page_id &&
    !isExpired(row.token_expires_at)
  ) {
    return {
      adAccountId: row.ad_account_id,
      pageId: row.page_id,
      accessToken: row.access_token,
    };
  }
  return getMetaCredentialsFromEnv();
}

/** A MetaClient bound to a business's resolved credentials, or null if none. */
export async function metaClientForBusiness(
  businessId: string,
  db?: SupabaseClient<Database>,
): Promise<MetaClient | null> {
  const creds = await resolveMetaCredentials(businessId, db);
  return creds ? new MetaClient(creds) : null;
}

/** Connection status for the settings UI (never includes the token). */
export async function getMetaConnection(
  businessId: string,
): Promise<MetaConnection> {
  const row = await getStoredRow(businessId);
  const scopes = row?.scopes ? row.scopes.split(",").filter(Boolean) : [];

  if (row?.token_type === "oauth" && row.access_token) {
    const expired = isExpired(row.token_expires_at);
    const complete = Boolean(row.ad_account_id && row.page_id);
    return {
      source: "oauth",
      pending: !complete,
      ready: complete && !expired,
      adAccountId: row.ad_account_id,
      pageId: row.page_id,
      tokenExpiresAt: row.token_expires_at,
      expired,
      scopes,
    };
  }

  const env = getMetaCredentialsFromEnv();
  if (env) {
    return {
      source: "env",
      pending: false,
      ready: true,
      adAccountId: env.adAccountId,
      pageId: env.pageId,
      tokenExpiresAt: null,
      expired: false,
      scopes,
    };
  }

  return {
    source: "none",
    pending: false,
    ready: false,
    adAccountId: null,
    pageId: null,
    tokenExpiresAt: null,
    expired: false,
    scopes,
  };
}

/** Whether a business can run Meta campaigns right now. */
export async function isMetaReadyForBusiness(
  businessId: string,
): Promise<boolean> {
  return (await getMetaConnection(businessId)).ready;
}
