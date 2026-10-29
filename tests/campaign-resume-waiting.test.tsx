// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { Business, Campaign } from "@/lib/types";

// #1560 (QA, #1546 walk): while a new-audience copy waits, a paused card offered Resume, and the owner walked the
// whole activation review before #1539 refused it. Like the hidden edits, Resume waits for Use or Cancel.
const waiting = vi.hoisted(() => ({ rows: [] as Array<{ id: string; campaign_id: string; sanitized_error: string | null }> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({
  createMetaConnectClient: () => ({ drafts: async () => [] }),
  MetaConnectClientError: class extends Error {},
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: waiting.rows, error: null }) }) }) }),
}));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solaride", locations: ["Delhi"] } as Business;
const campaign = (status: "paused" | "active") => ({
  id: "c1", business_id: business.id, name: "First lead campaign", status, daily_budget: 200, objective: "leads",
  meta_campaign_id: "120253654207670526", meta_adset_id: "120253654208240526", meta_ad_ids: ["120253654209040526"], creative_ids: [],
  meta_ad_account_id: "act_9000000000000001", meta_page_id: "900000000000002", meta_connection_generation: 1,
  raw: { source: "campaign_operation", metaResult: { campaignId: "120253654207670526", adSetIds: ["120253654208240526"], adIds: ["120253654209040526"] } },
}) as unknown as Campaign;

function show(status: "paused" | "active") {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ campaigns: [campaign(status)], results: {}, nextCursor: null })));
  render(<Campaigns business={business} approved={[]} initialCampaigns={[campaign(status)]} initialResults={{}}
    leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_9000000000000001" />);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:`, String(Date.now()));
  waiting.rows = [];
});

describe("Campaigns: Resume waits for a new audience to be used or cancelled (#1560)", () => {
  it("offers Resume on a paused card with no copy waiting", async () => {
    show("paused");
    expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("hides Resume while a copy waits; the strip says to use or cancel it first", async () => {
    waiting.rows = [{ id: "op-1", campaign_id: "c1", sanitized_error: null }];
    show("paused");
    expect(await screen.findByText("New audience ready")).toBeTruthy();
    expect(screen.getByText(/Use or cancel it before you resume the campaign\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use the new audience" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });

  it("keeps Pause on a running card while a copy waits (stopping always works)", async () => {
    waiting.rows = [{ id: "op-1", campaign_id: "c1", sanitized_error: null }];
    show("active");
    expect(await screen.findByText("New audience ready")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy());
  });
});
