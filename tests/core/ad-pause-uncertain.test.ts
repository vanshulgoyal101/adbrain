import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/ad-pause.json";

// #2395: Meta's recorded answers for one ad (#1045's tape), served by a fake that keeps the ad's status, so a
// pause whose answer is lost still pauses the ad, as it can in Meta.
type Exchange = { name: string; method: string; path: string; status: number; body: unknown };
const tape = (recorded.tape as Exchange[]).filter((exchange) => exchange.name === "pause-paused-ad");
const adId = recorded.pausedAdId;

const m = vi.hoisted(() => ({ campaign: null as Record<string, unknown> | null }));
const query = (rows: () => unknown) => {
  const q: Record<string, unknown> = {};
  for (const name of ["select", "eq", "limit"]) q[name] = () => q;
  q.maybeSingle = async () => ({ data: rows(), error: null });
  q.then = (resolve: (value: unknown) => void) => resolve({ data: rows(), error: null });
  return q;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => query(() => table === "ad_results" ? [] : structuredClone(m.campaign)) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => query(() => table === "campaign_edit_operations" ? [] : { raw: structuredClone(m.campaign?.raw ?? {}) }) }) }));
vi.mock("@/lib/campaign/activation", () => ({
  reviewableCampaign: () => ({ adAccountId: "act_1", pageId: "page_1", generation: 1 }),
  intendedCampaignChildren: () => ({ adIds: [recorded.pausedAdId], adSetIds: [], cappedAdSetIds: [] }),
}));
vi.mock("@/lib/campaign/trusted-write", () => ({ saveCampaign: async (_actor: unknown, row: { raw: unknown }) => { m.campaign!.raw = structuredClone(row.raw); return { error: null }; } }));
vi.mock("@/lib/campaign/ad-pause", async (original) => ({ ...await original<typeof import("@/lib/campaign/ad-pause")>(), recordAdPause: async () => true }));
vi.mock("@/lib/audit", () => ({ logEvent: async () => undefined }));
vi.mock("@/lib/observability/logger", () => ({ recordProductEvent: () => undefined }));
vi.mock("@/lib/meta/connection-access", async () => {
  const { MetaClient } = await import("@/lib/meta/client");
  const creds = { ...(await import("./fixtures/meta/ad-pause.json")).default.creds, accessToken: "core-token" };
  return { withMetaConnection: async (_context: unknown, _options: unknown, run: (meta: unknown) => unknown) => run(new MetaClient(creds)) };
});

import { setAdDelivery } from "@/lib/campaign/ad-pause-service";
import { pausedAdIds } from "@/lib/campaign/ad-pause";

let metaStatus = "ACTIVE";
let loseNextWriteAnswer = false;
const writes: string[] = [];

function fakeMeta() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search;
    if (method === "POST") {
      const status = new URLSearchParams(String(init?.body)).get("status")!;
      writes.push(status);
      metaStatus = status;
      if (loseNextWriteAnswer) { loseNextWriteAnswer = false; throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); }
      return Response.json({ success: true });
    }
    const exchange = tape.find((candidate) => candidate.method === method && candidate.path === path);
    if (!exchange) throw new Error(`Unrecorded Graph call: ${method} ${decodeURIComponent(path)}`);
    const body = path.startsWith(`${adId}?`) ? { ...(exchange.body as object), status: metaStatus, effective_status: metaStatus } : exchange.body;
    return Response.json(body, { status: exchange.status });
  });
}

const context = { businessId: "b1", userId: "u1" } as never;
beforeEach(() => {
  m.campaign = { id: "c1", name: "Run", status: "active", meta_campaign_id: recorded.campaignId, meta_ad_ids: [adId], raw: {} };
  metaStatus = "ACTIVE"; loseNextWriteAnswer = false; writes.length = 0;
  fakeMeta();
});
afterEach(() => vi.restoreAllMocks());

describe("core: an ad pause whose answer from Meta is lost (#2395)", () => {
  it("says the change is unconfirmed, then a retry records the pause and Undo turns the ad back on", async () => {
    loseNextWriteAnswer = true;
    await expect(setAdDelivery(context, "c1", adId, "pause", "expensive")).rejects.toMatchObject({
      message: "Meta didn't confirm the change. Refresh the campaign before trying again.", retryable: false,
    });
    expect(metaStatus).toBe("PAUSED");
    expect(pausedAdIds(m.campaign!.raw)).toEqual([]);

    expect(await setAdDelivery(context, "c1", adId, "pause", "expensive")).toMatchObject({ status: "PAUSED", changed: true });
    expect(pausedAdIds(m.campaign!.raw)).toEqual([adId]);

    expect(await setAdDelivery(context, "c1", adId, "undo")).toMatchObject({ status: "ACTIVE", changed: true });
    expect(metaStatus).toBe("ACTIVE");
    expect(writes).toEqual(["PAUSED", "ACTIVE"]);
    expect(pausedAdIds(m.campaign!.raw)).toEqual([]);
  });

  it("still records nothing for an ad the owner paused in Meta, with no pause of AdBrain's pending", async () => {
    metaStatus = "PAUSED";
    expect(await setAdDelivery(context, "c1", adId, "pause")).toMatchObject({ changed: false });
    expect(pausedAdIds(m.campaign!.raw)).toEqual([]);
    expect(writes).toEqual([]);
    await expect(setAdDelivery(context, "c1", adId, "undo")).rejects.toThrow("AdBrain didn't pause this ad");
  });
});
