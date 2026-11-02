// #2574: sign a test login in without the password grant, so Supabase CAPTCHA (#1777) can stay on.
// CI and production: with TEST_SESSION_SECRET, the app's /api/internal/test-session mints the session for an
// allowlisted email (the service key stays in Vercel). Locally: the service role in .env.local mints a one-time
// `recovery` token (admin API: no email, no CAPTCHA) and /verify trades it for a session. `recovery`, not `magiclink`:
// for an unknown email GoTrue answers 404, where `magiclink` would sign a new user up in production.
// Scripts, e2e and CI only: the app never imports this, and no key reaches a page.
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/** @typedef {{ session: { access_token: string, refresh_token?: string }, user: { id: string, email?: string, email_confirmed_at?: string },
 *   cookies: { name: string, value: string }[], supabase: string, apikey: string }} MintedSession */
/** @typedef {{ route: string, secret: string } | { url: string, serviceRoleKey: string, apikey: string }} TestSessionConfig */

const ownerCheckout = "/Users/vanshulgoyal/Development/copilot/adbrain";

/**
 * The owner's `.env.local` and `.env.smoke` (AGENTS.md: the only two env files), under `process.env`, which wins.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<Record<string, string | undefined>>}
 */
export async function localEnv(env = process.env) {
  const files = await Promise.all([".env.local", ".env.smoke"].map((name) => readFile(`${ownerCheckout}/${name}`, "utf8").then(parseEnv, () => ({}))));
  return Object.assign({}, ...files, Object.fromEntries(Object.entries(env).filter(([, value]) => value)));
}

/** `https://<ref>.supabase.co` from a legacy (JWT) service-role key, or null for any other key. */
export function projectUrlFromKey(key) {
  const payload = String(key ?? "").split(".")[1];
  if (!payload) return null;
  try {
    const { ref } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof ref === "string" && /^[a-z0-9]{20}$/.test(ref) ? `https://${ref}.supabase.co` : null;
  } catch {
    return null;
  }
}

/**
 * Where and how to mint: through the app at `origin` when TEST_SESSION_SECRET is set (CI), else with the local
 * service role. Without a publishable key the local server client sends the service key as `apikey` (the session's
 * own token still decides access).
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [origin] the app to sign in to; needed for the TEST_SESSION_SECRET route
 * @returns {TestSessionConfig}
 */
export function testSessionConfig(env = process.env, origin) {
  const secret = env.TEST_SESSION_SECRET?.trim();
  if (secret && origin) return { route: new URL("/api/internal/test-session", origin).href, secret };
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() || projectUrlFromKey(serviceRoleKey);
  if (!serviceRoleKey || !url) {
    throw new Error("Set TEST_SESSION_SECRET (CI) or SUPABASE_SERVICE_ROLE_KEY (local) to sign a test login in (#2574).");
  }
  return { url, serviceRoleKey, apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || serviceRoleKey };
}

/** `name=value` from each Set-Cookie header, skipping deletions. */
function responseCookies(response) {
  return response.headers.getSetCookie().flatMap((header) => {
    const [pair, ...attributes] = header.split(";");
    const at = pair.indexOf("=");
    const value = decodeURIComponent(pair.slice(at + 1).trim());
    const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
    return at > 0 && value && !expired ? [{ name: pair.slice(0, at).trim(), value }] : [];
  });
}

/**
 * Mints through the app's /api/internal/test-session (#2574): the app writes the session cookie itself.
 * @param {string} email
 * @param {{ route: string, secret: string }} config
 * @param {typeof globalThis.fetch} fetch
 */
async function mintThroughApp(email, { route, secret }, fetch) {
  const response = await fetch(route, { method: "POST", redirect: "manual",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ email }) });
  if (!response.ok) throw new Error(`test sign-in: the app refused (${response.status})`);
  const body = await response.json();
  const cookies = responseCookies(response);
  if (!cookies.length || !body?.accessToken || !body.user?.id) throw new Error("test sign-in: no session cookie written");
  // #2396: the route returns only id and email; the smoke's free-pictures guard needs Supabase's own record
  // (email_confirmed_at), the one the app's freeImagesOnly() reads.
  const read = await fetch(new URL("/auth/v1/user", body.supabase), {
    headers: { apikey: body.apikey, authorization: `Bearer ${body.accessToken}` }, signal: AbortSignal.timeout(15_000),
  });
  const user = read.ok ? await read.json().catch(() => null) : null;
  if (user?.id !== body.user.id) throw new Error(`test sign-in: user not read (${read.ok ? "mismatch" : read.status})`);
  return { session: { access_token: body.accessToken }, user, cookies, supabase: body.supabase, apikey: body.apikey };
}

/**
 * A fresh session for `email`, plus the `@supabase/ssr` cookies the app reads it from. Errors carry only a code,
 * never the email or a token: CI logs are public.
 * @param {string | undefined} email
 * @param {{ config?: TestSessionConfig, fetch?: typeof globalThis.fetch }} [options]
 * @returns {Promise<MintedSession>}
 */
export async function mintTestSession(email, { config = testSessionConfig(), fetch } = {}) {
  if (!email?.trim()) throw new Error("test sign-in: no email");
  if ("route" in config) return mintThroughApp(email.trim(), config, fetch ?? globalThis.fetch);
  const global = fetch ? { fetch } : undefined;
  const admin = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false }, global });
  const link = await admin.auth.admin.generateLink({ type: "recovery", email: email.trim() });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) throw new Error(`test sign-in: no sign-in token (${link.error?.code ?? link.error?.status ?? "empty"})`);

  const jar = new Map();
  const client = createServerClient(config.url, config.apikey, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (updates) => {
      for (const { name, value } of updates) {
        if (value) jar.set(name, value);
        else jar.delete(name);
      }
    } },
    global,
  });
  const { data, error } = await client.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error || !data.session) throw new Error(`test sign-in: verify failed (${error?.code ?? error?.status ?? "no session"})`);
  if (!jar.size) throw new Error("test sign-in: no session cookie written");
  return {
    session: data.session,
    user: data.user ?? data.session.user,
    cookies: [...jar].map(([name, value]) => ({ name, value })),
    supabase: config.url,
    apikey: config.apikey,
  };
}

/**
 * The session cookies as Playwright `context.addCookies` input for the app at `origin`.
 * @param {{ name: string, value: string }[]} cookies
 * @param {string} origin
 * @returns {{ name: string, value: string, domain: string, path: string, sameSite: "Lax", secure: boolean }[]}
 */
export function browserCookies(cookies, origin) {
  const { hostname, protocol } = new URL(origin);
  return cookies.map(({ name, value }) => ({ name, value, domain: hostname, path: "/", sameSite: "Lax", secure: protocol === "https:" }));
}

/**
 * Signs a Playwright browser context in as `email` for `origin`; returns the minted session.
 * @param {import("@playwright/test").BrowserContext} context
 * @param {string} origin
 * @param {string | undefined} email
 * @param {{ config?: TestSessionConfig, fetch?: typeof globalThis.fetch }} [options]
 */
export async function signInBrowser(context, origin, email, options) {
  const minted = await mintTestSession(email, options);
  await context.addCookies(browserCookies(minted.cookies, origin));
  return minted;
}
