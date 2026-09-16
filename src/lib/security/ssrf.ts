/**
 * SSRF guard for user-supplied URLs (e.g. "autofill from website"). Blocks
 * loopback, private, link-local, and other non-public hosts so a fetch on the
 * server can't be pointed at internal infrastructure or cloud metadata.
 *
 * URL parsing checks literals; the shared transport also validates DNS answers
 * at connection time and re-validates every redirect hop.
 */

import ipaddr from "ipaddr.js";
import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";

export const lookupPublicHost: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    if (!addresses.length || addresses.some(({ address }) => isBlockedHost(address))) {
      return callback(new SafeFetchError("blocked"), "", 4);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

const publicDispatcher = new Agent({ connect: { lookup: lookupPublicHost } });

/** True if the hostname must not be fetched from the server. */
export function isBlockedHost(hostname: string): boolean {
  const host = (hostname ?? "").trim().toLowerCase()
    .replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!host) return true;

  // Named hosts that resolve to internal networks.
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return true;
  }

  if (ipaddr.isValid(host)) return ipaddr.process(host).range() !== "unicast";
  return host.includes(":") || /^[\d.]+$/.test(host);
}

/**
 * Parse and validate a user-supplied website URL. Adds https:// if missing,
 * enforces http(s), and blocks private hosts. Returns the parsed URL or null.
 */
export function parsePublicUrl(input: string): URL | null {
  let raw = (input ?? "").trim();
  if (!raw) return null;

  // A scheme has no dots (host:port does), so a dotless prefix before ":" is a
  // real scheme — reject anything that isn't http(s). Otherwise assume https.
  const scheme = raw.match(/^([a-z][a-z0-9+-]*):/i)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme !== "http" && scheme !== "https") return null;
  } else {
    raw = `https://${raw}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  if (isBlockedHost(parsed.hostname)) return null;
  return parsed;
}

/** Resolve a redirect Location against its base and re-validate it (SSRF). */
export function resolveRedirectTarget(
  location: string,
  base: URL,
): URL | null {
  let absolute: string;
  try {
    absolute = new URL(location, base).toString();
  } catch {
    return null;
  }
  return parsePublicUrl(absolute);
}

export type SafeFetchErrorCode =
  | "blocked" // initial or redirect target is a non-public host
  | "redirect" // malformed redirect (missing/looping Location)
  | "too_big" // response exceeded the byte cap
  | "status" // upstream returned a non-2xx status
  | "fetch"; // network/timeout error

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    readonly status?: number,
  ) {
    super(code);
    this.name = "SafeFetchError";
  }
}

/**
 * Fetch a user-supplied URL with SSRF protection on EVERY hop. Redirects are
 * followed manually so each new Location is re-validated against isBlockedHost
 * — closing the redirect-to-internal-IP bypass that `redirect: "follow"` has.
 * Returns the response body text (capped), or throws a SafeFetchError.
 */
export async function fetchPublicUrl(
  input: string,
  opts: {
    maxRedirects?: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const {
    maxRedirects = 5,
    timeoutMs = 10_000,
    headers,
  } = opts;

  let current = parsePublicUrl(input);
  if (!current) throw new SafeFetchError("blocked");
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res: Response;
    try {
      const init: RequestInit & { dispatcher: Agent } = {
        headers,
        redirect: "manual",
        cache: "no-store",
        signal,
        dispatcher: publicDispatcher,
      };
      res = await fetch(current.toString(), init);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof Error && error.cause instanceof SafeFetchError) throw error.cause;
      throw new SafeFetchError("fetch");
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new SafeFetchError("redirect");
      const next = resolveRedirectTarget(location, current);
      if (!next) throw new SafeFetchError("blocked");
      if (next.origin !== current.origin && headers &&
          Object.keys(headers).some((name) => /^(authorization|cookie|proxy-authorization)$/i.test(name))) {
        throw new SafeFetchError("blocked");
      }
      current = next;
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel();
      throw new SafeFetchError("status", res.status);
    }
    return res;
  }

  throw new SafeFetchError("redirect");
}

export async function fetchPublicUrlText(
  input: string,
  opts: Parameters<typeof fetchPublicUrl>[1] & { maxBytes?: number } = {},
): Promise<string> {
  const maximum = opts.maxBytes ?? 2_000_000;
  const response = await fetchPublicUrl(input, opts);
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw new SafeFetchError("too_big");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > maximum) throw new SafeFetchError("too_big");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

