import { afterEach, describe, expect, it, vi } from "vitest";
import deliveryTape from "./fixtures/meta/delivery.json";
import syncTape from "./fixtures/meta/sync.json";
import { MetaClient } from "@/lib/meta/client";

// #197 (QA red test on PR #193). Recorded delivery/sync responses for the PAUSED
// Solaride test campaign, plus the capped ad set and ad copy exactly as
// createCappedAdSet leaves them (recorded capped-adset.json shape: daily 0,
// lifetime 60000), after the owner paused the capped run.
type Exchange = { method: string; path: string; status: number; body: { data: Array<Record<string, unknown>> } };

const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const campaignId = "120253646427440526";
const adSetIds = ["120253646428630526"];
const adIds = ["120253646430200526"];
const cappedAdSetId = "120253655095920526";
const cappedAdId = "120253655096690526";

function withCappedCopy(tape: unknown[]): Exchange[] {
  const copy = structuredClone(tape) as Exchange[];
  const adSets = copy.find(exchange => exchange.path.startsWith(`${campaignId}/adsets?`))!;
  // Meta lists the newest ad set first.
  adSets.body.data.unshift({ ...adSets.body.data[0], id: cappedAdSetId, daily_budget: "0", lifetime_budget: "60000" });
  const ads = copy.find(exchange => exchange.path.startsWith(`${campaignId}/ads?`));
  ads?.body.data.push({ ...ads.body.data[0], id: cappedAdId, adset_id: cappedAdSetId });
  return copy;
}

function replay(tape: Exchange[]) {
  const pending = [...tape];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    const index = pending.findIndex(exchange => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${path}`);
    const [exchange] = pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
}

const expected = { dailyBudgetRupees: 200, status: "paused", adSetIds: [...adSetIds, cappedAdSetId], adIds: [...adIds, cappedAdId] };

afterEach(() => vi.restoreAllMocks());

describe("#197: a campaign stays manageable after one capped run", () => {
  it("Resume review reads the stored tree that now includes the capped ad set", async () => {
    replay(withCappedCopy(deliveryTape));
    const delivery = await new MetaClient(creds).readCampaignDelivery(campaignId, { ...expected, cappedAdSetIds: [cappedAdSetId] });
    expect(delivery).toMatchObject({ campaign: { status: "PAUSED" } });
    expect(delivery.adSets.find(adSet => adSet.id === cappedAdSetId)).toMatchObject({ dailyBudgetPaise: 0 });
  });

  it("Resume review still refuses a lifetime ad set AdBrain did not create as a capped run", async () => {
    replay(withCappedCopy(deliveryTape));
    await expect(new MetaClient(creds).readCampaignDelivery(campaignId, expected))
      .rejects.toThrow("Campaign Page or ad-set delivery settings changed");
  });

  it("sync still binds the campaign to its original daily ad set and budget", async () => {
    replay(withCappedCopy(syncTape));
    const meta = new MetaClient(creds);
    const listed = (await meta.listCampaignsPage()).campaigns.find(campaign => campaign.id === campaignId)!;
    expect(await meta.readBoundCampaign(listed, [cappedAdSetId])).toMatchObject({ adSetId: adSetIds[0], dailyBudgetRupees: 200 });
  });

  it("sync skips a campaign with a lifetime ad set that is not a stored capped run", async () => {
    replay(withCappedCopy(syncTape));
    const meta = new MetaClient(creds);
    const listed = (await meta.listCampaignsPage()).campaigns.find(campaign => campaign.id === campaignId)!;
    expect(await meta.readBoundCampaign(listed)).toEqual({ skip: "lifetime_budget" });
  });
});
