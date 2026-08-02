import { describe, expect, it } from "vitest";
import {
  mapCampaignObjective,
  mapCampaignStatus,
} from "@/lib/meta/mappers";

describe("meta campaign mappers", () => {
  it("maps statuses to our enum", () => {
    expect(mapCampaignStatus("ACTIVE")).toBe("active");
    expect(mapCampaignStatus("PAUSED")).toBe("paused");
    expect(mapCampaignStatus("ARCHIVED")).toBe("completed");
    expect(mapCampaignStatus("DELETED")).toBe("completed");
    expect(mapCampaignStatus("WHATEVER")).toBe("draft");
    expect(mapCampaignStatus("")).toBe("draft");
  });

  it("maps objectives to friendly labels", () => {
    expect(mapCampaignObjective("OUTCOME_LEADS")).toBe("leads");
    expect(mapCampaignObjective("OUTCOME_TRAFFIC")).toBe("traffic");
    expect(mapCampaignObjective("OUTCOME_SALES")).toBe("sales");
    expect(mapCampaignObjective("OUTCOME_AWARENESS")).toBe("awareness");
    expect(mapCampaignObjective("OUTCOME_ENGAGEMENT")).toBe("engagement");
    expect(mapCampaignObjective("")).toBe("leads");
  });
});
