import { describe, expect, it } from "vitest";
import { RESUME_IN_ADS_MANAGER, reviewableCampaign } from "@/lib/campaign/activation";
import type { Campaign } from "@/lib/types";

// #662: only a campaign AdBrain launched (its ad sets and ads on record) bound to a Meta account
// can be reviewed for activation; the card and the review route share this one check.
const launched = {
  meta_campaign_id: "meta-1", meta_adset_id: "set-1", meta_ad_ids: ["ad-1"], daily_budget: 280,
  meta_ad_account_id: "act_1", meta_page_id: "page_1", meta_connection_generation: 3,
  raw: { source: "campaign_operation", metaResult: { campaignId: "meta-1", adSetIds: ["set-1"], adIds: ["ad-1"] } },
} as unknown as Campaign;

describe("reviewableCampaign (#662)", () => {
  it("returns what the activation review reads for a campaign AdBrain launched", () => {
    expect(reviewableCampaign(launched)).toEqual({
      metaCampaignId: "meta-1", adAccountId: "act_1", pageId: "page_1", generation: 3, dailyBudgetRupees: 280,
      children: { adSetIds: ["set-1"], adIds: ["ad-1"], cappedAdSetIds: [] },
    });
  });

  it.each([
    ["synced from Meta (no launch record)", { raw: null }],
    ["an older AdBrain row without its ads on record", { raw: { metaResult: { campaignId: "meta-1", adSetIds: ["set-1"], adIds: ["ad-1"] } } }],
    ["an internal traffic-runner row", { raw: { source: "internal_meta_traffic_runner" } }],
    ["not bound to an ad account", { meta_ad_account_id: null }],
    ["not bound to a Page", { meta_page_id: null }],
    ["no connection generation", { meta_connection_generation: null }],
    ["no budget", { daily_budget: null }],
    ["not on Meta", { meta_campaign_id: null }],
  ])("is null when %s", (_case, change) => {
    expect(reviewableCampaign({ ...launched, ...change } as Campaign)).toBeNull();
  });

  it("says in plain words where to resume instead", () => {
    expect(RESUME_IN_ADS_MANAGER).toBe("AdBrain can only resume campaigns it launched. Resume this one in Ads Manager.");
  });
});
