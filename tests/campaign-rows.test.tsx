// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { Business, Campaign, CampaignResult } from "@/lib/types";

// #403 S5: a Campaigns row at 390 px: 44 px actions, one "More" menu, and results (or why not) on every row.
const mocks = vi.hoisted(() => ({ drafts: vi.fn(), status: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solar installer", locations: ["Jaipur"] } as Business;
const paused = { id: "campaign-1", name: "Rooftop solar", status: "paused", daily_budget: 280, meta_campaign_id: "120252972379040526", meta_ad_account_id: "act_999" } as Campaign;
const active = { ...paused, id: "campaign-2", name: "Solar EMI", status: "active" } as Campaign;
const result = { impressions: 1200, clicks: 40, leads: 3, cpl: 93, spend: 280 } as CampaignResult;

function view(results: Record<string, CampaignResult> = {}) {
  return render(<Campaigns business={business} approved={[]} initialCampaigns={[paused, active]} initialResults={results} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_999" />);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_999`, String(Date.now()));
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue({ authorization: "disconnected" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
});

describe("Campaigns rows (#403 S5)", () => {
  it("keeps Pause/Resume and Refresh visible at 44 px and folds the rest into one More menu", async () => {
    const user = userEvent.setup();
    view();
    const row = (await screen.findByRole("heading", { name: "Rooftop solar" })).closest("article")!;
    const inRow = within(row as HTMLElement);
    for (const name of ["Resume", "Refresh results"]) expect(inRow.getByRole("button", { name }).className).toMatch(/\bh-11\b/);
    expect(inRow.queryByRole("link", { name: /Ads Manager/ })).toBeNull();
    expect(inRow.queryByRole("button", { name: "Delete campaign" })).toBeNull();

    const more = inRow.getByRole("button", { name: "More actions for Rooftop solar" });
    expect(more.className).toMatch(/\bsize-11\b/);
    more.focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    const ads = within(menu).getByRole("menuitem", { name: /Open in Ads Manager/ });
    expect(ads).toHaveAttribute("href", expect.stringContaining("selected_campaign_ids=120252972379040526"));
    expect(ads).toHaveAttribute("target", "_blank");

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(within(menu).getByRole("menuitem", { name: "Delete campaign" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Rooftop solar"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("says when a row has no results yet, and shows them when it has", async () => {
    view({ [active.id]: result });
    const pausedRow = (await screen.findByRole("heading", { name: "Rooftop solar" })).closest("article") as HTMLElement;
    const activeRow = screen.getByRole("heading", { name: "Solar EMI" }).closest("article") as HTMLElement;
    expect(within(pausedRow).getByText(/No results yet/)).toBeInTheDocument();
    expect(within(activeRow).queryByText(/No results yet/)).toBeNull();
    expect(within(activeRow).getByText("1,200")).toBeInTheDocument();
  });
});
