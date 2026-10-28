import { describe, expect, it } from "vitest";
import type { DraftDTO } from "@/lib/campaign/connect-contracts";
import { campaignNameDate, defaultCampaignName, draftForSelection } from "@/lib/campaign/draft-name";

// #1151: saved drafts were all "<Business> - leads", and Review added a new one each time.
describe("defaultCampaignName", () => {
  it("names the first ad's headline, where enquiries go and the day", () => {
    expect(defaultCampaignName({ headline: "Free 15-minute spine check", businessName: "Cedar Ridge", destination: "whatsapp", date: "Oct 28" }))
      .toBe("Free 15-minute spine check · WhatsApp · Oct 28");
    expect(defaultCampaignName({ headline: " Lower  bills ", businessName: "Solaride", destination: "instant_form", date: "Oct 28" }))
      .toBe("Lower bills · Lead form · Oct 28");
  });

  it("uses the business name with no ad chosen, and leaves the day out until the browser knows it", () => {
    expect(defaultCampaignName({ headline: null, businessName: "Solaride", destination: "whatsapp", date: null })).toBe("Solaride · WhatsApp");
    expect(defaultCampaignName({ headline: "  ", businessName: "Solaride", destination: "instant_form" })).toBe("Solaride · Lead form");
  });

  it("stays within the 120-character draft name", () => {
    const name = defaultCampaignName({ headline: "x".repeat(200), businessName: "B", destination: "instant_form", date: "Oct 28" });
    expect(name).toHaveLength(120);
    expect(name).toMatch(/x… · Lead form · Oct 28$/);
  });

  it("writes the day as 'Oct 28'", () => {
    expect(campaignNameDate(new Date(2026, 9, 28, 12))).toBe("Oct 28");
  });
});

describe("draftForSelection", () => {
  const draft = (draftId: string, creativeIds: string[]) => ({ draftId, version: 1, expiresAt: "2099-01-01T00:00:00.000Z", input: { creativeIds } }) as unknown as DraftDTO;
  const drafts = [draft("d1", ["a", "b"]), draft("d2", ["a"]), draft("d3", ["c", "a", "b"])];

  it("finds the draft for exactly the same ads, in any order", () => {
    expect(draftForSelection(drafts, ["b", "a"])?.draftId).toBe("d1");
    expect(draftForSelection(drafts, ["a"])?.draftId).toBe("d2");
    expect(draftForSelection(drafts, ["a", "b", "c"])?.draftId).toBe("d3");
  });

  it("finds none for other ads or no ads", () => {
    expect(draftForSelection(drafts, ["b"])).toBeUndefined();
    expect(draftForSelection(drafts, ["a", "b", "d"])).toBeUndefined();
    expect(draftForSelection(drafts, [])).toBeUndefined();
  });
});
