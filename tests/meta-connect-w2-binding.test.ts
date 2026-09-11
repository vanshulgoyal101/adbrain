import { describe, expect, it } from "vitest";
import { checkCampaignBinding, readStoredCampaignBinding, type StoredCampaignBinding } from "@/lib/campaign/binding";

const selected = {
  metaBusinessId: null,
  adAccountId: "act_123",
  accountName: "Account",
  pageId: "page_123",
  pageName: "Page",
  currency: "INR",
  timezoneName: "Asia/Kolkata",
};

const campaign: StoredCampaignBinding = {
  metaAdAccountId: "act_123",
  metaPageId: "page_123",
  metaConnectionGeneration: 7,
};

describe("campaign account binding", () => {
  it("reads both runtime database names and future typed names", () => {
    expect(readStoredCampaignBinding({
      meta_ad_account_id: "act_123",
      meta_page_id: "page_123",
      meta_connection_generation: 7,
    })).toEqual(campaign);
    expect(readStoredCampaignBinding({
      metaAdAccountId: "act_123",
      metaPageId: "page_123",
      metaConnectionGeneration: 7,
    })).toEqual(campaign);
  });

  it("returns the original binding when account, page, and generation match", () => {
    expect(checkCampaignBinding(campaign, { generation: 7, selected })).toEqual({
      kind: "bound",
      binding: { adAccountId: "act_123", pageId: "page_123" },
      expectedGeneration: 7,
    });
  });

  it("blocks old campaigns without trustworthy binding fields", () => {
    expect(checkCampaignBinding({ ...campaign, metaPageId: null }, { generation: 7, selected })).toEqual({
      kind: "missing",
      reason: "MISSING_CAMPAIGN_BINDING",
    });
  });

  it("blocks when the selected account or page changes", () => {
    expect(checkCampaignBinding(campaign, {
      generation: 7,
      selected: { ...selected, adAccountId: "act_other" },
    })).toEqual({ kind: "blocked", reason: "CAMPAIGN_BINDING_MISMATCH" });
    expect(checkCampaignBinding(campaign, {
      generation: 7,
      selected: { ...selected, pageId: "page_other" },
    })).toEqual({ kind: "blocked", reason: "CAMPAIGN_BINDING_MISMATCH" });
  });

  it("blocks a reconnect generation change even when assets are unchanged", () => {
    expect(checkCampaignBinding(campaign, { generation: 8, selected })).toEqual({
      kind: "blocked",
      reason: "CONNECTION_GENERATION_CHANGED",
    });
  });

  it("blocks a disconnected connection before attempting a provider operation", () => {
    expect(checkCampaignBinding(campaign, { generation: 7, selected: null })).toEqual({
      kind: "blocked",
      reason: "CONNECTION_NOT_SELECTED",
    });
  });
});