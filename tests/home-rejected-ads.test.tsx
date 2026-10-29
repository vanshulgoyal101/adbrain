// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Campaign } from "@/lib/types";

const meta = vi.hoisted(() => ({ readAdReview: vi.fn(), withMetaConnection: vi.fn(), requireOwnedBusiness: vi.fn(async () => ({ businessId: "b" })) }));
vi.mock("@/lib/meta/connection-access", () => ({
  requireOwnedBusiness: meta.requireOwnedBusiness,
  withMetaConnection: meta.withMetaConnection.mockImplementation(async (_context, _options, run) => run({ readAdReview: meta.readAdReview })),
}));
vi.mock("@/components/support-link", () => ({ HelpOnWhatsApp: ({ label }: { label: string }) => <a href="#">{label}</a> }));

const campaign = {
  id: "c1", business_id: "b", status: "active", meta_campaign_id: "120", meta_ad_account_id: "act_42", meta_page_id: "77", meta_connection_generation: 3, raw: {},
} as unknown as Campaign;
const rejected = { adId: "1", state: "rejected", effectiveStatus: "DISAPPROVED", reasons: ["x"], feedback: [{ policy: "Personal Attributes", message: "Your ad asserts personal attributes." }] };
const approved = { adId: "2", state: "approved", effectiveStatus: "ACTIVE", reasons: [], feedback: [] };

describe("Home rejected ads (#1469)", () => {
  it("reads Meta's review for the campaign (read-only, its stored binding) and says which ads Meta didn't approve", async () => {
    meta.readAdReview.mockResolvedValue([rejected, approved]);
    const { HomeRejectedAds } = await import("@/components/home-rejected-ads");
    render(await HomeRejectedAds({ campaign, spend: 0 }));
    expect(meta.withMetaConnection).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      purpose: "read_insights", binding: { adAccountId: "act_42", pageId: "77" }, expectedGeneration: 3 }), expect.any(Function));
    expect(meta.readAdReview).toHaveBeenCalledWith("120");
    expect(screen.getByRole("region", { name: "Ads Meta didn't approve" })).toHaveTextContent(/Meta didn't approve 1 ad\..*Your other ad is running\./);
  });

  it("shows nothing when Meta can't be read", async () => {
    meta.readAdReview.mockRejectedValue(new Error("Meta down"));
    const { HomeRejectedAds } = await import("@/components/home-rejected-ads");
    expect(await HomeRejectedAds({ campaign, spend: 0 })).toBeNull();
  });

  it("shows nothing for a campaign without a stored Meta binding", async () => {
    meta.withMetaConnection.mockClear();
    const { HomeRejectedAds } = await import("@/components/home-rejected-ads");
    expect(await HomeRejectedAds({ campaign: { ...campaign, meta_connection_generation: null } as Campaign, spend: 0 })).toBeNull();
    expect(meta.withMetaConnection).not.toHaveBeenCalled();
  });
});
