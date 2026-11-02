import { getDomain } from "tldts";
import { fetchPublicUrl, SafeFetchError } from "@/lib/security/ssrf";

/** #2599: whether a website ad's link (`url`, exactly as opened) reaches the advertiser's own site, as a visitor would land on it. */
export type WebsiteReach =
  | { url: string; ok: true; finalUrl: string }
  | { url: string; ok: false; problem: "blocked" | "unreachable" | "status" | "other_domain"; status?: number; finalHost?: string };

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
    if (error instanceof SafeFetchError && error.code === "blocked") return { url: website, ok: false, problem: "blocked" };
    if (error instanceof SafeFetchError && error.code === "status") return { url: website, ok: false, problem: "status", status: error.status };
    return { url: website, ok: false, problem: "unreachable" };
  }
  await response.body?.cancel().catch(() => undefined);
  const finalUrl = response.url || website;
  if (!sameRegistrableDomain(finalUrl, website)) {
    return { url: website, ok: false, problem: "other_domain", finalHost: new URL(finalUrl).hostname };
  }
  return { url: website, ok: true, finalUrl };
}
