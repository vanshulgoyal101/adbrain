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
}

export interface MetaAdAccountOption {
  id: string; // "act_123"
  accountId: string; // "123"
  name: string;
  currency?: string;
  /** Meta account_status: 1 = active. */
  status?: number;
  disabled: boolean;
}

export interface MetaPageOption {
  id: string;
  name: string;
}

/** Whether the Facebook-Login connect flow is configured (app id + secret). */
export function metaOAuthConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.META_APP_ID && env.META_APP_SECRET);
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
  scopes?: readonly string[];
}): string {
  const q = new URLSearchParams({
    client_id: params.appId,
    redirect_uri: params.redirectUri,
    state: params.state,
    response_type: "code",
    scope: (params.scopes ?? META_LOGIN_SCOPES).join(","),
  });
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

/** Sign an HMAC-protected, self-verifying state token (no DB round-trip). */
export function signState(payload: {
  businessId: string;
  userId: string;
}): string {
  const body = b64url(
    JSON.stringify({
      b: payload.businessId,
      u: payload.userId,
      t: Date.now(),
      n: randomBytes(8).toString("hex"),
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
    ) as { b?: string; u?: string; t?: number };
    if (!json.b || !json.u || typeof json.t !== "number") return null;
    if (Date.now() - json.t > maxAgeMs) return null;
    return { businessId: json.b, userId: json.u, issuedAt: json.t };
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
): Promise<{ accessToken: string; expiresInSec: number }> {
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
    expiresInSec: data.expires_in ?? 60 * 24 * 60 * 60,
  };
}

/** List ad accounts the connected user can manage. */
export async function fetchAdAccounts(
  userToken: string,
): Promise<MetaAdAccountOption[]> {
  const data = await graphGet<{
    data?: {
      id?: string;
      account_id?: string;
      name?: string;
      currency?: string;
      account_status?: number;
    }[];
  }>(
    "me/adaccounts?fields=account_id,name,currency,account_status&limit=200",
    userToken,
  );
  return (data.data ?? [])
    .filter((a) => a.account_id)
    .map((a) => ({
      id: a.id ?? `act_${a.account_id}`,
      accountId: a.account_id!,
      name: a.name ?? `Account ${a.account_id}`,
      currency: a.currency,
      status: a.account_status,
      disabled: a.account_status !== undefined && a.account_status !== 1,
    }));
}

/** List Facebook pages the connected user can manage. */
export async function fetchPages(userToken: string): Promise<MetaPageOption[]> {
  const data = await graphGet<{
    data?: { id?: string; name?: string }[];
  }>("me/accounts?fields=id,name&limit=200", userToken);
  return (data.data ?? [])
    .filter((p) => p.id)
    .map((p) => ({ id: p.id!, name: p.name ?? `Page ${p.id}` }));
}
