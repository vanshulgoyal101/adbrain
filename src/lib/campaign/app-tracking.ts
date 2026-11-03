/**
 * #2824 (#2595 phase 3, app installs): may an app-install campaign for this store link go to Meta? Channel-neutral:
 * the Meta adapter reads the ad account's registered apps; this rule decides from them. Fails closed: when the
 * apps couldn't be read, none is registered, or the link isn't one of a registered app's store pages, the answer is a blocker.
 */
export type StorePlatform = "ios" | "android" | "amazon" | "windows";
export type StoreLink = { platform: StorePlatform; url: string };
export type RegisteredApp = { id: string; name: string; storeLinks: StoreLink[] };

export type AppBlocker =
  | "unreadable"
  | "no_app"
  | "no_store_link"
  | "link_not_registered"
  | "ambiguous_app";

/** Only https links count (an http link never matches a registered https listing). Ignores host case, `www.` and a trailing slash. */
export function normalizeStoreUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * The one registered app whose store page is this link (and, when given, on this platform), or why none is.
 * `apps` is null when Meta's read failed. Two apps owning the same link is ambiguous, never "the first one".
 */
export function appBlocker(apps: RegisteredApp[] | null, storeUrl: string | null | undefined, platform?: StorePlatform): { blocker: AppBlocker } | { app: RegisteredApp } {
  if (apps === null) return { blocker: "unreadable" };
  if (!apps.length) return { blocker: "no_app" };
  const wanted = storeUrl ? normalizeStoreUrl(storeUrl) : null;
  if (!wanted) return { blocker: "no_store_link" };
  const owners = apps.filter((candidate) => candidate.storeLinks.some((link) => normalizeStoreUrl(link.url) === wanted && (!platform || link.platform === platform)));
  if (owners.length > 1) return { blocker: "ambiguous_app" };
  return owners.length ? { app: owners[0] } : { blocker: "link_not_registered" };
}
