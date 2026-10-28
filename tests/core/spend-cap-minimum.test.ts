import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/spend-cap-minimum.json";
import { CAMPAIGN_SPEND_CAP_TOO_LOW, CAMPAIGN_SPEND_CAP_TOO_LOW_MESSAGE, MetaClient, MetaError, friendlyMetaError } from "@/lib/meta/client";

// #1799 (QA, recorded validate_only, Oct 28): Meta refuses a campaign spend_cap under the account's
// min_campaign_group_spend_cap (₹5,000 INR) with subcode 2446307, and the message comes back in Hindi.
afterEach(() => vi.restoreAllMocks());
const client = () => new MetaClient({ adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" });

describe("core: Meta's campaign spend-cap minimum (#1799)", () => {
  it("reads the account's minimum live", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "act_9000000000000001", ...recorded.account }));
    expect(await client().readMinCampaignSpendCapPaise()).toBe(500000);
    expect(recorded.tape.filter((row) => row.status === 400).every((row) => row.spend_cap < 500000)).toBe(true);
    expect(recorded.tape.filter((row) => row.status === 200).every((row) => row.spend_cap >= 500000)).toBe(true);
  });

  it("turns Meta's recorded refusal (Hindi text) into plain English by its subcode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(recorded.error, { status: 400 }));
    const error = await client().readMinCampaignSpendCapPaise().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MetaError);
    expect((error as MetaError).subcode).toBe(CAMPAIGN_SPEND_CAP_TOO_LOW);
    expect(friendlyMetaError(error)).toBe(CAMPAIGN_SPEND_CAP_TOO_LOW_MESSAGE);
  });
});
