/**
 * #2824 (#2595 phase 3): the apps registered with Meta for this ad account (`act_/advertisable_applications`),
 * the only apps an OUTCOME_APP_PROMOTION campaign can promote. Read-only and adapter-shaped (ADR-001, #1792):
 * Graph in, channel-neutral `RegisteredApp`s out. A failed or malformed read is `null` (unreadable), never an empty list.
 */
import type { RegisteredApp } from "@/lib/campaign/app-tracking";
import type { MetaGraph } from "./media";

/** Meta's `object_store_urls` also lists `fb_canvas` and `instant_game`, which aren't install pages: only these keys count. */
const STORE_KEYS = ["itunes", "itunes_ipad", "google_play", "amazon_appstore", "windows_10_store", "windows_phone_store"] as const;

type RawApp = { id?: string; name?: string; object_store_urls?: Record<string, unknown> };

export async function readRegisteredApps(graph: MetaGraph, adAccountId: string): Promise<RegisteredApp[] | null> {
  try {
    const page = await graph<{ data?: RawApp[]; paging?: { next?: string } }>(
      `${adAccountId}/advertisable_applications?fields=id,name,object_store_urls&limit=25`);
    // More than one page of apps means a partial list could miss the right one, so it can't be trusted.
    if (!Array.isArray(page.data) || page.paging?.next) return null;
    return page.data.flatMap((raw) => {
      if (typeof raw.id !== "string" || !/^\d+$/.test(raw.id)) return [];
      const storeUrls = STORE_KEYS.flatMap((key) => (typeof raw.object_store_urls?.[key] === "string" ? [raw.object_store_urls[key] as string] : []));
      return [{ id: raw.id, name: raw.name ?? "", storeUrls }];
    });
  } catch {
    return null;
  }
}
