import { normalizeWebsite } from "@/lib/brand/validation";
import type { WebsiteReach } from "@/lib/campaign/website-reach";
import { isWebsiteLink } from "@/lib/meta/destinations";

/** Review's website rules, kept apart from the server-only reachability fetch so the browser can share them. */
export function isAdvertiserWebsite(website: string | null): boolean {
  // Brands saved before #470 may hold a bare domain.
  const normalized = normalizeWebsite(website);
  if (!normalized) return false;
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return (url.protocol === "https:" || url.protocol === "http:") &&
    !["facebook.com", "fb.com", "fb.me", "instagram.com", "m.me", "wa.me"].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/** #2599: the link a website ad sends people to: Review opens it, hashes it, and launch sends it. Meta's website ads need https. */
export function websiteAdLink(website: string | null | undefined): string | null {
  const normalized = normalizeWebsite(website ?? null);
  return normalized?.startsWith("http://") ? `https://${normalized.slice("http://".length)}` : normalized;
}

/** #2599: why a website ad can't open the advertiser's site, by its `review` message key (#2333); null when it can. */
export type WebsiteBlocker =
  | { missing: true; key: "websiteMissing" }
  | { missing: false; key: "websiteUnreachable" | "websiteBlocked"; host: string }
  | { missing: false; key: "websiteStatus"; host: string; status: string }
  | { missing: false; key: "websiteRedirect"; host: string; finalHost: string };

/** #2599: a website ad opens the advertiser's own site, so the site must exist, answer and stay on its own domain. */
export function websiteBlocker(website: string | null, reach: WebsiteReach | undefined): WebsiteBlocker | null {
  // Launch's own rule (isWebsiteLink), so a site Review passes is never refused at launch.
  const link = websiteAdLink(website);
  if (!link || !isAdvertiserWebsite(website) || !isWebsiteLink(link)) return { missing: true, key: "websiteMissing" };
  // CPO on #2634: only a check of this exact link counts, never one of another page or an older address.
  const checked = reach?.url === link ? reach : undefined;
  if (checked?.ok) return null;
  const host = new URL(link).hostname;
  if (!checked || checked.problem === "unreachable") return { missing: false, key: "websiteUnreachable", host };
  if (checked.problem === "status") return { missing: false, key: "websiteStatus", host, status: checked.status ? String(checked.status) : "" };
  if (checked.problem === "blocked") return { missing: false, key: "websiteBlocked", host };
  return { missing: false, key: "websiteRedirect", host, finalHost: checked.finalHost ?? "" };
}
