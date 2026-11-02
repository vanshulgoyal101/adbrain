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

/** #2599: a website ad opens the advertiser's own site, so the site must exist, answer and stay on its own domain. */
export function websiteBlockerMessage(website: string | null, reach: WebsiteReach | undefined): { missing: boolean; message: string } | null {
  // Launch's own rule (isWebsiteLink), so a site Review passes is never refused at launch.
  const link = websiteAdLink(website);
  if (!link || !isAdvertiserWebsite(website) || !isWebsiteLink(link)) {
    return { missing: true, message: "Add your business website on the Your business page. A website ad opens your own site, so AdBrain needs its address." };
  }
  // CPO on #2634: only a check of this exact link counts, never one of another page or an older address.
  const checked = reach?.url === link ? reach : undefined;
  if (checked?.ok) return null;
  const host = new URL(link).hostname;
  const check = "Check the address on the Your business page, or make sure the site is up, then review again.";
  const message = !checked || checked.problem === "unreachable" ? `AdBrain couldn't open your website ${host}. ${check}`
    : checked.problem === "status" ? `Your website ${host} answered with an error${checked.status ? ` (${checked.status})` : ""} when AdBrain opened it. ${check}`
    : checked.problem === "blocked" ? `${host} isn't a public website address. Add your business's public site on the Your business page.`
    : `Your website ${host} sends visitors on to ${checked.finalHost ?? "another site"}. Add the address of your own site on the Your business page, so the ad opens your business.`;
  return { missing: false, message };
}
