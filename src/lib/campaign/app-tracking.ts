/**
 * #2824 (#2595 phase 3, app installs): may an app-install campaign for this store link go to Meta? Channel-neutral:
 * the Meta adapter reads the ad account's registered apps; this rule decides from them. Fails closed: when the
 * apps couldn't be read, none is registered, or the link isn't one of a registered app's store pages, the answer is a blocker.
 */
export type RegisteredApp = { id: string; name: string; storeUrls: string[] };

export type AppBlocker =
  | "unreadable"
  | "no_app"
  | "no_store_link"
  | "link_not_registered";

/** Compares links ignoring case in the host, a trailing slash, `www.` and the scheme's http/https difference. */
export function normalizeStoreUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return null;
  }
}

/** The registered app whose store page is this link, or why none matches. `apps` is null when Meta's read failed. */
export function appBlocker(apps: RegisteredApp[] | null, storeUrl: string | null | undefined): { blocker: AppBlocker } | { app: RegisteredApp } {
  if (apps === null) return { blocker: "unreadable" };
  if (!apps.length) return { blocker: "no_app" };
  const wanted = storeUrl ? normalizeStoreUrl(storeUrl) : null;
  if (!wanted) return { blocker: "no_store_link" };
  const app = apps.find((candidate) => candidate.storeUrls.some((url) => normalizeStoreUrl(url) === wanted));
  return app ? { app } : { blocker: "link_not_registered" };
}
