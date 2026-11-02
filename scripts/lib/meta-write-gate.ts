// #1324: Meta recorders write to a real ad account (validate_only checks, PAUSED parents deleted after).
// Imported first by every scripts/record-meta-*.ts: a non-GET Graph call needs ADBRAIN_ALLOW_META_WRITES=1
// in the shell, so a headless or automated run can't write by accident; a person sets it on purpose.
import { createHmac } from "node:crypto";

const realFetch = globalThis.fetch;
// #1649: MetaClient adds `appsecret_proof` when it sees the app secret, and recorders tape what it sends, so the
// proof would land in public fixtures and break their replay. Hide the secret from the client; this gate adds the
// proof to the real request only, so recordings still work with Meta's 'Require app secret' on.
const appSecret = process.env.META_APP_SECRET;
delete process.env.META_APP_SECRET;

function graphToken(url: URL, init?: RequestInit): string | null {
  const bearer = new Headers(init?.headers).get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const body = init?.body;
  const form = body instanceof URLSearchParams || body instanceof FormData ? body
    : typeof body === "string" && !body.trimStart().startsWith("{") ? new URLSearchParams(body) : null;
  const fromBody = form?.get("access_token");
  return bearer ?? url.searchParams.get("access_token") ?? (typeof fromBody === "string" ? fromBody : null);
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.hostname === "graph.facebook.com" && method !== "GET") {
    // #1513: a headless supervisor run can set the flag itself, so it never writes.
    if (process.env.ADBRAIN_HEADLESS === "1") throw new Error(`Refusing ${method} ${url.pathname}: Meta writes are refused in a headless supervisor run.`);
    if (process.env.ADBRAIN_ALLOW_META_WRITES !== "1") {
      throw new Error(`Refusing ${method} ${url.pathname}: set ADBRAIN_ALLOW_META_WRITES=1 to let this recorder write to Meta.`);
    }
  }
  const token = url.hostname === "graph.facebook.com" && appSecret && !(input instanceof Request) ? graphToken(url, init) : null;
  if (token && !url.searchParams.has("appsecret_proof")) {
    url.searchParams.set("appsecret_proof", createHmac("sha256", appSecret!).update(token).digest("hex"));
    return realFetch(url, init);
  }
  return realFetch(input, init);
};

export {};
