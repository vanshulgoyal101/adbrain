import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/app-promotion.json";
import { appBlocker, normalizeStoreUrl } from "@/lib/campaign/app-tracking";
import { readRegisteredApps } from "@/lib/meta/app-promotion";

// #2824 (#2595 phase 3): real answers from the test ad account (scripts/record-meta-app-promotion.ts, scrubbed).
// Its only registered app has no iOS/Android store URL, so Meta refuses every app-install ad set: there is no
// success tape for the ad set until a mobile test app is registered. The campaign (validate_only) is accepted.
type Exchange = { name: string; method: string; path: string; status: number; body: any };
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
    expect(apps).toEqual([{ id: appsCall.body.data[0].id, name: "adBrain", storeUrls: [] }]);
  });

  it("keeps iOS and Android links", async () => {
    const apps = await readRegisteredApps(
      graphReturning({ data: [{ id: "1", name: "A", object_store_urls: { itunes: "https://apps.apple.com/app/id1", google_play: "https://play.google.com/store/apps/details?id=a.b", fb_canvas: "https://x.test/" } }] }),
      account);
    expect(apps?.[0].storeUrls).toEqual(["https://apps.apple.com/app/id1", "https://play.google.com/store/apps/details?id=a.b"]);
  });

  it("is null (unreadable), never an empty list, when Graph fails, answers oddly or has more pages", async () => {
    expect(await readRegisteredApps(graphReturning(null, true), account)).toBeNull();
    expect(await readRegisteredApps(graphReturning({}), account)).toBeNull();
    expect(await readRegisteredApps(graphReturning({ data: [], paging: { next: "https://graph.facebook.com/next" } }), account)).toBeNull();
  });
});

describe("appBlocker", () => {
  const app = { id: "1", name: "A", storeUrls: ["https://apps.apple.com/app/id1/"] };

  it("blocks the recorded account: its app has no store link, so no link can match", async () => {
    const apps = await readRegisteredApps(graphReturning(appsCall.body), account);
    expect(appBlocker(apps, recorded.foreignStoreUrl)).toEqual({ blocker: "link_not_registered" });
    expect(appBlocker(apps, "https://adbrain.vanshul.com/")).toEqual({ blocker: "link_not_registered" });
  });

  it("fails closed: unreadable, no app, no link, other link", () => {
    expect(appBlocker(null, "https://apps.apple.com/app/id1")).toEqual({ blocker: "unreadable" });
    expect(appBlocker([], "https://apps.apple.com/app/id1")).toEqual({ blocker: "no_app" });
    expect(appBlocker([app], "")).toEqual({ blocker: "no_store_link" });
    expect(appBlocker([app], undefined)).toEqual({ blocker: "no_store_link" });
    expect(appBlocker([app], "not a url")).toEqual({ blocker: "no_store_link" });
    expect(appBlocker([app], "javascript:alert(1)")).toEqual({ blocker: "no_store_link" });
    expect(appBlocker([app], "https://apps.apple.com/app/id2")).toEqual({ blocker: "link_not_registered" });
  });

  it("passes the registered link, ignoring host case, www and a trailing slash", () => {
    expect(appBlocker([app], "HTTPS://Apps.Apple.com/app/id1")).toEqual({ app });
    expect(normalizeStoreUrl("https://www.x.test/a/")).toBe("x.test/a");
  });
});

describe("recorded validate_only answers", () => {
  it("accepts the app-promotion campaign", () => {
    const campaign = byName("campaign");
    expect(campaign.form.objective).toBe("OUTCOME_APP_PROMOTION");
    expect(campaign.status).toBe(200);
    expect(campaign.body).toEqual({ success: true });
  });

  it("refuses ad sets for a store link the app doesn't own (2490408) and for the canvas link (1885185)", () => {
    expect(byName("adset-foreign-store").status).toBe(400);
    expect(byName("adset-foreign-store").body.error.error_subcode).toBe(2490408);
    expect(byName("adset-own-store").status).toBe(400);
    expect(byName("adset-own-store").body.error.error_subcode).toBe(1885185);
  });
});
