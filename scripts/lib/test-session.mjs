// #2574: sign a test login in without the password grant, so Supabase CAPTCHA (#1777) can stay on.
// The service role mints a one-time sign-in token (admin API: no email is sent, no CAPTCHA) and /verify trades it for
// a session (no CAPTCHA either). The token is a `recovery` one: for an existing user GoTrue stores it exactly as a magic
// link, but for an unknown email it answers 404, where `magiclink` would sign a new user up in production. Scripts, e2e and CI only: the app never imports this, and the key never reaches a page.
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/** @typedef {{ url: string, serviceRoleKey: string, apikey: string }} TestSessionConfig */

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
 * Where and how to mint. CI needs only SUPABASE_SERVICE_ROLE_KEY: the project URL comes from the key, and without
 * a publishable key the server client sends the service key as `apikey` (the session's own token still decides access).
 * @param {Record<string, string | undefined>} [env]
 * @returns {TestSessionConfig}
 */
export function testSessionConfig(env = process.env) {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() || projectUrlFromKey(serviceRoleKey);
  if (!serviceRoleKey || !url) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL for a non-JWT key) to sign a test login in (#2574).");
  }
  return { url, serviceRoleKey, apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || serviceRoleKey };
}

/**
 * A fresh session for `email`, plus the `@supabase/ssr` cookies the app reads it from. Errors carry only a code,
 * never the email or a token: CI logs are public.
 * @param {string | undefined} email
 * @param {{ config?: TestSessionConfig, fetch?: typeof globalThis.fetch }} [options]
 * @returns {Promise<{ session: import("@supabase/supabase-js").Session, user: import("@supabase/supabase-js").User,
 *   cookies: { name: string, value: string }[], supabase: string, apikey: string }>}
 */
export async function mintTestSession(email, { config = testSessionConfig(), fetch } = {}) {
  if (!email?.trim()) throw new Error("test sign-in: no email");
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
