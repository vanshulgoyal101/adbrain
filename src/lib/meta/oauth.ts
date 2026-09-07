import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { MetaError } from "./client";

const GRAPH = "https://graph.facebook.com/v21.0";
const OAUTH_DIALOG = "https://www.facebook.com/v21.0/dialog/oauth";

/**
 * Permissions requested from the business owner. These cover reading their ad
 * accounts + pages, creating lead campaigns, and pulling leads/insights. Going
 * live for users outside your test list requires Meta App Review for these.
 */
export const META_LOGIN_SCOPES = [
  "ads_management",
  "ads_read",
  "leads_retrieval",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
  "business_management",
] as const;

/** Verified state payload carried through the OAuth round-trip. */
export interface MetaOAuthState {
  businessId: string;
  userId: string;
  issuedAt: number;
  nonce: string;
  flow?: "instant";
}

export interface MetaAdAccountOption {
  id: string; // "act_123"
  accountId: string; // "123"
  name: string;
  currency?: string;
  /** Meta account_status: 1 = active. */
  status?: number;
  disabled: boolean;
  metaBusinessId?: string;
  timezoneName?: string;
}

export interface MetaPageOption {
  id: string;
  name: string;
  tasks?: string[];
  metaBusinessId?: string;
}

export interface MetaDiscoverySnapshot {
  adAccounts: MetaAdAccountOption[];
  pages: MetaPageOption[];
  relationshipPairs: Array<{ adAccountId: string; pageId: string; metaBusinessId: string }>;
  complete: boolean;
}

export interface MetaTokenInspection {
  metaUserId: string;
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
  grantedScopes: string[];
}

export interface MetaSignedRequest {
  userId: string;
  issuedAt?: number;
}

/** Whether the Facebook-Login connect flow is configured (app id + secret). */
export function metaOAuthConfigured(): boolean {
  const env = getEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_TOKEN_ENCRYPTION_KEY) return false;
  return Buffer.from(env.META_TOKEN_ENCRYPTION_KEY, "base64").length === 32;
}

/** The redirect URI Meta calls back — must be whitelisted in the Meta app. */
export function oauthRedirectUri(): string {
  return `${getEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/api/meta/oauth/callback`;
}

/** Build the Facebook login dialog URL. Pure. */
export function buildLoginUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
  configId?: string;
  scopes?: readonly string[];
}): string {
  const q = new URLSearchParams({
    client_id: params.appId,
    redirect_uri: params.redirectUri,
    state: params.state,
    response_type: "code",
    scope: (params.scopes ?? META_LOGIN_SCOPES).join(","),
  });
  if (params.configId) q.set("config_id", params.configId);
  return `${OAUTH_DIALOG}?${q.toString()}`;
}

function stateSecret(): string {
  const env = getEnv();
  // The app secret is a strong, always-present key when OAuth is configured.
  const secret = env.META_APP_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new MetaError("Meta OAuth is not configured.");
  return secret;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function verifyMetaSignedRequest(value: string): MetaSignedRequest | null {
  const [encodedSignature, encodedPayload] = value.split(".");
  if (!encodedSignature || !encodedPayload) return null;
  const signature = Buffer.from(encodedSignature.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const expected = createHmac("sha256", stateSecret())
    .update(encodedPayload)
    .digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    ) as { algorithm?: string; user_id?: string; issued_at?: number };
    if (payload.algorithm !== "HMAC-SHA256" || !payload.user_id) return null;
    return { userId: payload.user_id, issuedAt: payload.issued_at };
  } catch {
    return null;
  }
}

/** Sign an HMAC-protected, self-verifying state token (no DB round-trip). */
export function signState(payload: {
  businessId: string;
  userId: string;
  flow?: "instant";
}): string {
  const body = b64url(
    JSON.stringify({
      b: payload.businessId,
      u: payload.userId,
      t: Date.now(),
      n: randomBytes(8).toString("hex"),
      ...(payload.flow ? { f: payload.flow } : {}),
    }),
  );
  const sig = b64url(createHmac("sha256", stateSecret()).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Verify a state token and return its payload, or null if it is malformed,
 * tampered, or older than `maxAgeMs` (default 10 minutes).
 */
export function verifyState(
  token: string,
  maxAgeMs = 10 * 60_000,
): MetaOAuthState | null {
  const parts = token?.split(".");
  if (!parts || parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = b64url(
    createHmac("sha256", stateSecret()).update(body).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    ) as { b?: string; u?: string; t?: number; n?: string; f?: string };
    if (!json.b || !json.u || typeof json.t !== "number" || !json.n) return null;
    if (json.t > Date.now() + 30_000) return null;
    if (Date.now() - json.t > maxAgeMs) return null;
    if (json.f !== undefined && json.f !== "instant") return null;
    return { businessId: json.b, userId: json.u, issuedAt: json.t, nonce: json.n, ...(json.f === "instant" ? { flow: "instant" as const } : {}) };
  } catch {
    return null;
  }
}

async function graphGet<T>(path: string, token: string): Promise<T> {
  const url = token
    ? `${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`
    : `${GRAPH}/${path}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as { error?: unknown }).error) {
    const err = (json as { error?: { message?: string } }).error;
    throw new MetaError(err?.message || `Meta HTTP ${res.status}`, res.status);
  }
  return json as T;
}

async function graphGetNext<T>(next: string, token: string): Promise<T> {
  const url = new URL(next);
  if (url.origin !== "https://graph.facebook.com") {
    throw new MetaError("Meta returned an invalid paging URL.");
  }
  url.searchParams.delete("access_token");
  url.searchParams.set("access_token", token);
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as { error?: unknown }).error) {
    const err = (json as { error?: { message?: string } }).error;
    throw new MetaError(err?.message || `Meta HTTP ${res.status}`, res.status);
  }
  return json as T;
}

const MAX_DISCOVERY_PAGES = 20;

type AccountPage = {
  data?: {
    id?: string;
    account_id?: string;
    name?: string;
    currency?: string;
    account_status?: number;
    timezone_name?: string;
    business?: { id?: string };
  }[];
  paging?: { next?: string };
};

type PagePage = {
  data?: { id?: string; name?: string; tasks?: string[]; business?: { id?: string } }[];
  paging?: { next?: string };
};

async function fetchAdAccountsDetailed(userToken: string): Promise<{
  items: MetaAdAccountOption[];
  complete: boolean;
}> {
  let data = await graphGet<AccountPage>(
    "me/adaccounts?fields=account_id,name,currency,account_status,timezone_name,business&limit=200",
    userToken,
  );
  const rows = Array.isArray(data.data) ? [...data.data] : [];
  let page = 1;
  while (data.paging?.next) {
    if (page >= MAX_DISCOVERY_PAGES) return { items: mapAdAccounts(rows), complete: false };
    data = await graphGetNext<AccountPage>(data.paging.next, userToken);
    if (Array.isArray(data.data)) rows.push(...data.data);
    page += 1;
  }
  return { items: mapAdAccounts(rows), complete: true };
}

function mapAdAccounts(rows: NonNullable<AccountPage["data"]>): MetaAdAccountOption[] {
  const unique = new Map<string, NonNullable<AccountPage["data"]>[number]>();
  for (const row of rows) {
    const key = row.account_id ?? row.id;
    if (key && !unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()]
    .filter((account) => account.account_id)
    .map((account) => ({
      id: account.id ?? `act_${account.account_id}`,
      accountId: account.account_id!,
      name: account.name ?? `Account ${account.account_id}`,
      currency: account.currency,
      status: account.account_status,
      disabled: account.account_status !== 1,
      ...(account.business?.id ? { metaBusinessId: account.business.id } : {}),
      ...(account.timezone_name ? { timezoneName: account.timezone_name } : {}),
    }));
}

async function fetchPagesDetailed(userToken: string): Promise<{
  items: MetaPageOption[];
  complete: boolean;
}> {
  let data = await graphGet<PagePage>(
    "me/accounts?fields=id,name,tasks,business&limit=200",
    userToken,
  );
  const rows = Array.isArray(data.data) ? [...data.data] : [];
  let page = 1;
  while (data.paging?.next) {
    if (page >= MAX_DISCOVERY_PAGES) return { items: mapPages(rows), complete: false };
    data = await graphGetNext<PagePage>(data.paging.next, userToken);
    if (Array.isArray(data.data)) rows.push(...data.data);
    page += 1;
  }
  return { items: mapPages(rows), complete: true };
}

function mapPages(rows: NonNullable<PagePage["data"]>): MetaPageOption[] {
  const unique = new Map<string, NonNullable<PagePage["data"]>[number]>();
  for (const row of rows) if (row.id && !unique.has(row.id)) unique.set(row.id, row);
  return [...unique.values()]
    .filter((page) => page.id)
    .map((page) => ({
      id: page.id!,
      name: page.name ?? `Page ${page.id}`,
      ...(page.tasks ? { tasks: page.tasks } : {}),
      ...(page.business?.id ? { metaBusinessId: page.business.id } : {}),
    }));
}

/** Exchange an OAuth `code` for a short-lived user token. */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<string> {
  const env = getEnv();
  const q = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    redirect_uri: redirectUri,
    code,
  });
  const data = await graphGet<{ access_token?: string }>(
    `oauth/access_token?${q.toString()}`,
    "",
  );
  if (!data.access_token) {
    throw new MetaError("Could not exchange code for a token.");
  }
  return data.access_token;
}

/** Upgrade a short-lived token to a long-lived (~60 day) user token. */
export async function exchangeForLongLivedToken(
  shortToken: string,
): Promise<{ accessToken: string; expiresInSec: number | null }> {
  const env = getEnv();
  const q = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    fb_exchange_token: shortToken,
  });
  const data = await graphGet<{ access_token?: string; expires_in?: number }>(
    `oauth/access_token?${q.toString()}`,
    "",
  );
  if (!data.access_token) {
    throw new MetaError("Could not obtain a long-lived token.");
  }
  return {
    accessToken: data.access_token,
    expiresInSec: typeof data.expires_in === "number" ? data.expires_in : null,
  };
}

/** Validate the token subject and record provider-reported expiry/grants. */
export async function inspectMetaToken(userToken: string): Promise<MetaTokenInspection> {
  const env = getEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new MetaError("Meta OAuth is not configured.");
  }
  const [identity, permissions, debug] = await Promise.all([
    graphGet<{ id?: string }>("me?fields=id", userToken),
    graphGet<{ data?: { permission?: string; status?: string }[] }>(
      "me/permissions?limit=200",
      userToken,
    ),
    graphGet<{
      data?: {
        is_valid?: boolean;
        app_id?: string;
        user_id?: string;
        expires_at?: number;
        data_access_expires_at?: number;
        data_access_expiration_time?: number;
      };
    }>("debug_token?input_token=" + encodeURIComponent(userToken), `${env.META_APP_ID}|${env.META_APP_SECRET}`),
  ]);
  if (!identity.id || debug.data?.is_valid !== true || debug.data.app_id !== env.META_APP_ID
    || debug.data.user_id !== identity.id) throw new MetaError("Meta identity could not be verified.");
  const grantedScopes = (permissions.data ?? [])
    .filter((entry) => entry.permission && entry.status === "granted")
    .map((entry) => entry.permission as string);
  const debugData = debug.data;
  const dataAccessExpiry = debugData.data_access_expires_at ?? debugData.data_access_expiration_time;
  if ([debugData.expires_at, dataAccessExpiry].some(expiry => expiry && expiry * 1000 <= Date.now())) {
    throw new MetaError("Meta authorization has expired.");
  }
  return {
    metaUserId: identity.id,
    grantedScopes,
    expiresAt: debugData?.expires_at
      ? new Date(debugData.expires_at * 1000).toISOString()
      : null,
    dataAccessExpiresAt: dataAccessExpiry
      ? new Date(dataAccessExpiry * 1000).toISOString()
      : null,
  };
}

/** List ad accounts the connected user can manage. */
export async function fetchAdAccounts(
  userToken: string,
): Promise<MetaAdAccountOption[]> {
  return (await fetchAdAccountsDetailed(userToken)).items;
}

/** List Facebook pages the connected user can manage. */
export async function fetchPages(userToken: string): Promise<MetaPageOption[]> {
  return (await fetchPagesDetailed(userToken)).items;
}

export async function discoverMetaAssets(userToken: string): Promise<MetaDiscoverySnapshot> {
  const [accounts, pageResults] = await Promise.all([
    fetchAdAccountsDetailed(userToken),
    fetchPagesDetailed(userToken),
  ]);
  const adAccounts = accounts.items;
  const pages = pageResults.items;
  const relationshipPairs = adAccounts.flatMap((account) =>
    pages.flatMap((page) =>
      account.metaBusinessId && account.metaBusinessId === page.metaBusinessId
        ? [{ adAccountId: account.id, pageId: page.id, metaBusinessId: account.metaBusinessId }]
        : [],
    ),
  );
  return { adAccounts, pages, relationshipPairs, complete: accounts.complete && pageResults.complete };
}
