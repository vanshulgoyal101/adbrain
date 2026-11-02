import { GRAPH } from "@/lib/meta/graph-version";
import { createHmac, randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types";
import { decryptMetaToken, encryptMetaToken, fromPostgresBytea, toPostgresBytea } from "./token-store";
import {
  metaVertical,
  provisionManagedAccount,
  type ManagerTokens,
  type ProvisionGraph,
  type ProvisionResult,
  type ProvisionStore,
} from "./managed-provision";

/**
 * #521 wiring (CTO decisions, Oct 25): runs `provisionManagedAccount` for one business inside its
 * ledger lease (claimed with database time before any Meta call, so two runs can't both create).
 * The customer's token creates the child; the parent token provisions; the child's own
 * system-user token is stored encrypted in `private.meta_tokens` and referenced from the ledger.
 */
export interface RunnerDeps {
  config: { parentToken: string; parentBusinessId: string; appId: string; appSecret: string };
  claim(leaseId: string): Promise<boolean>;
  release(leaseId: string): Promise<boolean>;
  business(): Promise<{ name: string; category: string | null }>;
  customerToken(tokenId: string): Promise<string | null>;
  store: ProvisionStore;
  manager: ManagerTokens;
  graph: ProvisionGraph;
  provision: typeof provisionManagedAccount;
}

const LEASE_SECONDS = 300;

export async function runManagedProvisioning(
  input: { businessId: string; customerTokenId: string | null; requestId?: string },
  deps: RunnerDeps,
): Promise<ProvisionResult> {
  // Meta rejects the child-token mint without appsecret_proof (Business On Behalf Of, step 2).
  // #2358: no default parent business, so a missing id stops here instead of provisioning under another BP.
  if (!deps.config.parentToken || !deps.config.parentBusinessId || !deps.config.appId || !deps.config.appSecret) return { ok: false, code: "NOT_CONFIGURED", retryable: false };
  if (!input.customerTokenId) return { ok: false, code: "CUSTOMER_REAUTH_REQUIRED", retryable: false };
  // No ledger row means the Page step hasn't happened; don't report it as a run in progress.
  if (!(await deps.store.get(input.businessId))) return { ok: false, code: "PAGE_NOT_LINKED", retryable: false };
  const leaseId = randomUUID();
  if (!(await deps.claim(leaseId))) return { ok: false, code: "PROVISIONING_IN_PROGRESS", retryable: true };
  try {
    const customer = await deps.customerToken(input.customerTokenId);
    if (!customer) return { ok: false, code: "CUSTOMER_REAUTH_REQUIRED", retryable: false };
    const business = await deps.business();
    return await deps.provision({
      businessId: input.businessId,
      businessName: business.name,
      vertical: metaVertical(business.category),
      parentBusinessId: deps.config.parentBusinessId,
      store: deps.store,
      graph: deps.graph,
      tokens: { customer, parent: deps.config.parentToken },
      manager: deps.manager,
      requestId: input.requestId,
    });
  } finally {
    await deps.release(leaseId).catch(() => false);
  }
}

/**
 * Graph calls with the token in a header (never the URL) and `appsecret_proof` (HMAC of that token
 * with the app secret) on every call; Meta failures carry status/code/subcode only.
 */
export function graphClient(appSecret: string, fetchImpl: typeof fetch = fetch): ProvisionGraph {
  async function call<T>(method: "GET" | "POST", path: string, token: string, form?: Record<string, string>): Promise<T> {
    const proof = createHmac("sha256", appSecret).update(token).digest("hex");
    const url = form ? `${GRAPH}/${path}` : `${GRAPH}/${path}${path.includes("?") ? "&" : "?"}appsecret_proof=${proof}`;
    const response = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: form ? new URLSearchParams({ ...form, appsecret_proof: proof }) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({})) as { error?: { code?: number; error_subcode?: number } };
    if (!response.ok || body.error) {
      throw Object.assign(new Error("Meta request failed."), { status: response.status, code: body.error?.code, subcode: body.error?.error_subcode });
    }
    return body as T;
  }
  return { get: (path, token) => call("GET", path, token), post: (path, form, token) => call("POST", path, token, form) };
}

type Admin = ReturnType<typeof createAdminClient>;
type ManagedUpdate = Database["public"]["Tables"]["managed_meta_accounts"]["Update"];

export async function readToken(admin: Admin, tokenId: string, businessId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("meta_token_get", { p_token_id: tokenId, p_business_id: businessId });
  const row = data?.[0];
  if (error || !row || row.revoked_at || [row.expires_at, row.data_access_expires_at].some((at: string | null) => at && new Date(at).getTime() <= Date.now())) return null;
  return decryptMetaToken({
    ciphertext: fromPostgresBytea(row.ciphertext), nonce: fromPostgresBytea(row.nonce),
    authTag: fromPostgresBytea(row.auth_tag), keyId: row.key_id, formatVersion: row.format_version,
  }, { tokenId: row.id, businessId: row.business_id });
}

/** The real dependencies: Supabase service role, the encrypted token store and Meta's Graph API. */
export function runnerDeps(businessId: string, userId: string): RunnerDeps {
  const env = getEnv();
  const admin = createAdminClient();
  const table = () => admin.from("managed_meta_accounts");
  const fail = (what: string, error: { code?: string } | null) => Object.assign(new Error(`Managed account ${what} failed.`), { code: error?.code });
  return {
    config: { parentToken: env.META_PARENT_SYSTEM_TOKEN, parentBusinessId: env.META_PARENT_BUSINESS_ID ?? "", appId: env.META_APP_ID, appSecret: env.META_APP_SECRET },
    claim: async (leaseId) => {
      const { data, error } = await admin.rpc("managed_meta_account_claim", { p_business_id: businessId, p_lease_id: leaseId, p_seconds: LEASE_SECONDS });
      if (error) throw fail("lease", error);
      return data === true;
    },
    release: async (leaseId) => (await admin.rpc("managed_meta_account_release", { p_business_id: businessId, p_lease_id: leaseId })).data === true,
    business: async () => {
      const { data, error } = await admin.from("businesses").select("name, vertical").eq("id", businessId).maybeSingle();
      if (error || !data) throw fail("business read", error);
      return { name: data.name, category: data.vertical };
    },
    customerToken: (tokenId) => readToken(admin, tokenId, businessId),
    store: {
      get: async () => {
        const { data, error } = await table().select("business_id,state,page_id,child_business_id,ad_account_id,step_keys,manager_user_id,manager_token_id").eq("business_id", businessId).maybeSingle();
        if (error) throw fail("read", error);
        return data;
      },
      // States written here are the ledger's own (#519 enforces the transitions).
      update: async (values) => { const { error } = await table().update(values as ManagedUpdate).eq("business_id", businessId); if (error) throw fail("update", error); },
      event: async (values) => { const { error } = await admin.from("managed_meta_account_events").insert(values); if (error) throw fail("event", error); },
    },
    manager: {
      appId: env.META_APP_ID,
      save: async (token, systemUserId) => {
        const tokenId = randomUUID();
        const encrypted = encryptMetaToken(token, { tokenId, businessId });
        const { data, error } = await admin.rpc("meta_token_insert", {
          p_id: tokenId, p_business_id: businessId, p_authorized_by: userId, p_subject_id: systemUserId, p_token_kind: "business_system_user",
          p_ciphertext: toPostgresBytea(encrypted.ciphertext), p_nonce: toPostgresBytea(encrypted.nonce), p_auth_tag: toPostgresBytea(encrypted.authTag),
          p_key_id: encrypted.keyId, p_format_version: encrypted.formatVersion, p_granted_scopes: ["ads_management", "business_management"],
          p_granted_assets: [], p_expires_at: null, p_validated_at: new Date().toISOString(), p_data_access_expires_at: null,
        });
        if (error || data !== tokenId) throw fail("token save", error);
        return tokenId;
      },
      load: (tokenId) => readToken(admin, tokenId, businessId),
      remove: async (tokenId) => { await admin.rpc("meta_token_delete", { p_token_id: tokenId, p_business_id: businessId }); },
    },
    graph: graphClient(env.META_APP_SECRET),
    provision: provisionManagedAccount,
  };
}
