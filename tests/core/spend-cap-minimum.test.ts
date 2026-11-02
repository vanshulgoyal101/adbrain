import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/spend-cap-minimum.json";
import { MetaClient, MetaError, friendlyMetaError } from "@/lib/meta/client";

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

  it("reads a minimum other than ₹5,000, and nothing from another account, another currency or a malformed value", async () => {
    const read = (body: object) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(body));
      return client().readMinCampaignSpendCapPaise();
    };
    expect(await read({ id: "act_9000000000000001", currency: "INR", min_campaign_group_spend_cap: "750000" })).toBe(750000);
    expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toContain("fields=id,currency,min_campaign_group_spend_cap");
    expect(await read({ id: "act_9000000000000002", currency: "INR", min_campaign_group_spend_cap: "750000" })).toBeNull();
    expect(await read({ id: "act_9000000000000001", currency: "USD", min_campaign_group_spend_cap: "750000" })).toBeNull();
    expect(await read({ id: "act_9000000000000001", currency: "INR", min_campaign_group_spend_cap: "5000.5" })).toBeNull();
    expect(await read({ id: "act_9000000000000001", currency: "INR" })).toBeNull();
  });

  it("turns Meta's recorded refusal (Hindi text) into English with Meta's own minimum, or no amount when it has none", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(recorded.error, { status: 400 }));
    const error = await client().readMinCampaignSpendCapPaise().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MetaError);
    expect((error as MetaError).subcode).toBe(2446307);
    expect(friendlyMetaError(error)).toBe("Meta's minimum campaign spending limit for this currency is ₹5,000.00. The campaign stays paused.");
    const noAmount = { error: { ...recorded.error.error, error_user_msg: "अभियान की खर्च सीमा बहुत कम है." } };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(noAmount, { status: 400 }));
    const unnamed = await client().readMinCampaignSpendCapPaise().catch((caught: unknown) => caught);
    expect(friendlyMetaError(unnamed)).toBe("Meta's minimum campaign spending limit for this currency is higher than this amount. The campaign stays paused.");
  });
});
