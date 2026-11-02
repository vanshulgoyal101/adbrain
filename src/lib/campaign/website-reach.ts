import { getDomain } from "tldts";
import { fetchPublicUrl, SafeFetchError } from "@/lib/security/ssrf";

/** #2599: whether a website ad's link opens the advertiser's own site, as a visitor would land on it. */
export type WebsiteReach =
  | { ok: true; finalUrl: string }
  | { ok: false; problem: "blocked" | "unreachable" | "status" | "other_domain"; status?: number; finalHost?: string };

/** The registrable domain ("shop.example.co.in" → "example.co.in"); hosting suffixes like vercel.app count as public. */
function registrableDomain(url: string): string | null {
  return getDomain(url, { allowPrivateDomains: true });
}

export function sameRegistrableDomain(left: string, right: string): boolean {
  const domain = registrableDomain(left);
  return domain !== null && domain === registrableDomain(right);
}

/**
 * GET, not HEAD (many sites refuse HEAD), following redirects with the SSRF check on every hop. Reachable means the
 * last hop answered 2xx on the same registrable domain as the Brand's website; the body is never read.
 */
export async function checkWebsiteReach(website: string, options: { timeoutMs?: number } = {}): Promise<WebsiteReach> {
  let response: Response;
  try {
    response = await fetchPublicUrl(website, {
      headers: { "User-Agent": "AdBrainBot/1.0 (+https://adbrain.vanshul.com)", Accept: "text/html,*/*;q=0.8" },
      timeoutMs: options.timeoutMs ?? 8_000,
    });
  } catch (error) {
    if (error instanceof SafeFetchError && error.code === "blocked") return { ok: false, problem: "blocked" };
    if (error instanceof SafeFetchError && error.code === "status") return { ok: false, problem: "status", status: error.status };
    return { ok: false, problem: "unreachable" };
  }
  await response.body?.cancel().catch(() => undefined);
  const finalUrl = response.url || website;
  if (!sameRegistrableDomain(finalUrl, website)) {
    return { ok: false, problem: "other_domain", finalHost: new URL(finalUrl).hostname };
  }
  return { ok: true, finalUrl };
}
