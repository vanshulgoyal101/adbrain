import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/app-promotion.json";
import { appBlocker } from "@/lib/campaign/app-tracking";
import { readRegisteredApps } from "@/lib/meta/app-promotion";

// #2824 (#2595 phase 3): real answers from the test ad account (scripts/record-meta-app-promotion.ts, scrubbed).
// Its only registered app has no iOS/Android store URL, so Meta refuses every app-install ad set: there is no
// success tape for the ad set until a mobile test app is registered. The campaign (validate_only) is accepted.
type Exchange = { name: string; method: string; path: string; form?: Record<string, string> | null; status: number; body: unknown };
type Apps = { data: { id: string }[] };
type Refusal = { error: { error_subcode: number } };
const tape = recorded.tape as Exchange[];
const byName = (name: string) => tape.find((exchange) => exchange.name === name)!;
const appsCall = byName("apps");
const account = appsCall.path.split("/")[0];

afterEach(() => vi.restoreAllMocks());

const graphReturning = (body: unknown, fail = false) =>
  vi.fn(async () => {
    if (fail) throw new Error("Graph down");
    return body;
  }) as never;

describe("readRegisteredApps", () => {
  it("reads the recorded app and keeps only real store links (not fb_canvas / instant_game)", async () => {
    const graph = vi.fn(async (path: string) => {
      expect(path).toBe(appsCall.path);
      return appsCall.body;
    });
    const apps = await readRegisteredApps(graph as never, account);
    expect(apps).toEqual([{ id: (appsCall.body as Apps).data[0].id, name: "adBrain", storeUrls: [] }]);
  });

  it("keeps iOS and Android links", async () => {
    const apps = await readRegisteredApps(
      graphReturning({ data: [{ id: "1", name: "A", object_store_urls: { itunes: "https://apps.apple.com/app/id1", google_play: "https://play.google.com/store/apps/details?id=a.b", fb_canvas: "https://x.test/" } }] }),
      account);
    expect(apps?.[0].storeUrls).toEqual([
      { os: "ios", url: "https://apps.apple.com/app/id1" },
      { os: "android", url: "https://play.google.com/store/apps/details?id=a.b" },
    ]);
  });

  it("is null (unreadable) when any row is malformed, so a bad row can't hide a second owner of the link", async () => {
    const good = { id: "1", name: "A", object_store_urls: { itunes: "https://apps.apple.com/app/id1" } };
    expect(await readRegisteredApps(graphReturning({ data: [good, { name: "B", object_store_urls: good.object_store_urls }] }), account)).toBeNull();
    expect(await readRegisteredApps(graphReturning({ data: [good, null] }), account)).toBeNull();
  });

  it("is null (unreadable), never an empty list, when Graph fails, answers oddly or has more pages", async () => {
    expect(await readRegisteredApps(graphReturning(null, true), account)).toBeNull();
    expect(await readRegisteredApps(graphReturning({}), account)).toBeNull();
    expect(await readRegisteredApps(graphReturning({ data: [], paging: { next: "https://graph.facebook.com/next" } }), account)).toBeNull();
  });
});

describe("appBlocker", () => {
  const ios = "https://apps.apple.com/app/id1";
  const play = "https://play.google.com/store/apps/details?id=a.b";
  const app = { id: "1", name: "A", storeUrls: [{ os: "ios" as const, url: ios }, { os: "android" as const, url: play }] };
  const pick = (over: Partial<{ appId: string; os: "ios" | "android"; storeUrl: string | null }> = {}) => ({ appId: "1", os: "ios" as const, storeUrl: ios, ...over });

  it("blocks the recorded account: its app has no mobile store link", async () => {
    const apps = await readRegisteredApps(graphReturning(appsCall.body), account);
    const id = (appsCall.body as Apps).data[0].id;
    expect(appBlocker(apps, { appId: id, os: "android", storeUrl: play })).toEqual({ blocker: "link_not_registered" });
    expect(appBlocker(apps, { appId: id, os: "ios", storeUrl: recorded.foreignStoreUrl })).toEqual({ blocker: "unsafe_link" });
  });

  it("one test per blocker", () => {
    expect(appBlocker(null, pick())).toEqual({ blocker: "unreadable" });
    expect(appBlocker([], pick())).toEqual({ blocker: "no_app" });
    expect(appBlocker([app], pick({ storeUrl: "" }))).toEqual({ blocker: "no_store_link" });
    expect(appBlocker([app], pick({ storeUrl: null }))).toEqual({ blocker: "no_store_link" });
    expect(appBlocker([app], pick({ appId: "2" }))).toEqual({ blocker: "app_not_available" });
    expect(appBlocker([app], pick({ storeUrl: "https://apps.apple.com/app/id2" }))).toEqual({ blocker: "link_not_registered" });
    expect(appBlocker([app], pick({ os: "android" }))).toEqual({ blocker: "unsafe_link" });
    expect(appBlocker([{ ...app, storeUrls: [{ os: "android", url: play }] }], pick({ os: "ios", storeUrl: ios }))).toEqual({ blocker: "link_not_registered" });
    const twin = { ...app, id: "2" };
    expect(appBlocker([app, twin], pick())).toEqual({ blocker: "ambiguous" });
    expect(appBlocker([twin, app], pick())).toEqual({ blocker: "ambiguous" });
  });

  it("os_mismatch: the app owns the link, but under the other OS", () => {
    const swapped = { ...app, storeUrls: [{ os: "android" as const, url: "https://apps.apple.com/app/id1" }] };
    expect(appBlocker([swapped], pick())).toEqual({ blocker: "os_mismatch" });
  });

  it.each([
    "http://apps.apple.com/app/id1",
    "https://user:pw@apps.apple.com/app/id1",
    "https://apps.apple.com:8443/app/id1",
    "https://apps.apple.com.evil.test/app/id1",
    "https://evil.test/apps.apple.com/app/id1",
    "javascript:alert(1)",
    "not a url",
  ])("unsafe_link: %s", (storeUrl) => {
    expect(appBlocker([app], pick({ storeUrl }))).toEqual({ blocker: "unsafe_link" });
  });

  it("passes the selected app's own link for that OS, ignoring host case and a trailing slash", () => {
    expect(appBlocker([app], pick({ storeUrl: "HTTPS://Apps.Apple.com/app/id1/" }))).toEqual({ app });
    expect(appBlocker([app], pick({ os: "android", storeUrl: play }))).toEqual({ app });
  });
});

describe("recorded validate_only answers", () => {
  it("accepts the app-promotion campaign", () => {
    const campaign = byName("campaign");
    expect(campaign.form?.objective).toBe("OUTCOME_APP_PROMOTION");
    expect(campaign.status).toBe(200);
    expect(campaign.body).toEqual({ success: true });
  });

  it("refuses ad sets: 2490408 (goal conflicts with the parent campaign's objective; the parent was an engagement campaign, so this does not show a foreign-store rejection) and 1885185 (canvas link isn't a mobile app)", () => {
    expect(byName("adset-foreign-store").status).toBe(400);
    expect((byName("adset-foreign-store").body as Refusal).error.error_subcode).toBe(2490408);
    expect(byName("adset-own-store").status).toBe(400);
    expect((byName("adset-own-store").body as Refusal).error.error_subcode).toBe(1885185);
  });
});
