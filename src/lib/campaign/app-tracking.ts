/**
 * #2824 (#2595 phase 3, app installs): may an app-install campaign for this store link go to Meta? Channel-neutral:
 * the Meta adapter reads the ad account's registered apps; this rule decides from them. Fails closed: when the
 * apps couldn't be read, none is registered, or the link isn't one of a registered app's store pages, the answer is a blocker.
 */
export type AppOs = "android" | "ios";
export type StoreLink = { os: AppOs; url: string };
export type RegisteredApp = { id: string; name: string; storeUrls: StoreLink[] };

export type AppBlocker =
  | "unreadable"
  | "no_app"
  | "no_store_link"
  | "unsafe_link"
  | "app_not_available"
  | "os_mismatch"
  | "link_not_registered"
  | "ambiguous";

export type AppChoice = { appId: string; os: AppOs; storeUrl: string | null | undefined };

const STORE_HOSTS: Record<AppOs, string> = { android: "play.google.com", ios: "apps.apple.com" };

/** The comparable form of an official store link, or null when it isn't one (https only, exact store host, no credentials or port). */
export function normalizeStoreUrl(raw: string, os?: AppOs): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (os ? host !== STORE_HOSTS[os] : !Object.values(STORE_HOSTS).includes(host)) return null;
    return `${host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * Whether the selected app may be promoted with this store link on this OS. `apps` is null when Meta's read failed.
 * Matches the selected app id, then that app's link for that OS; two apps owning the link is ambiguous, never "the first".
 */
export function appBlocker(apps: RegisteredApp[] | null, choice: AppChoice): { blocker: AppBlocker } | { app: RegisteredApp } {
  if (apps === null) return { blocker: "unreadable" };
  if (!apps.length) return { blocker: "no_app" };
  if (!choice.storeUrl?.trim()) return { blocker: "no_store_link" };
  const wanted = normalizeStoreUrl(choice.storeUrl, choice.os);
  if (!wanted) return { blocker: "unsafe_link" };
  const app = apps.find((candidate) => candidate.id === choice.appId);
  if (!app) return { blocker: "app_not_available" };
  const owns = (candidate: RegisteredApp, os?: AppOs) =>
    candidate.storeUrls.some((link) => (!os || link.os === os) && normalizeStoreUrl(link.url) === wanted);
  if (!owns(app)) return { blocker: "link_not_registered" };
  if (!owns(app, choice.os)) return { blocker: "os_mismatch" };
  if (apps.filter((candidate) => owns(candidate, choice.os)).length > 1) return { blocker: "ambiguous" };
  return { app };
}
