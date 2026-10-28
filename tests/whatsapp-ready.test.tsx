// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { Business, Campaign } from "@/lib/types";

// #493: 7 opened WhatsApp from #157, 1 messaged. Part of the fix is the owner's WhatsApp side.
const mocks = vi.hoisted(() => ({ drafts: vi.fn(), status: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solaride", locations: ["Mohali"] } as Business;
const whatsapp = { id: "c-wa", name: "Solar WhatsApp", status: "active", daily_budget: 280, meta_campaign_id: "1", destination: "whatsapp" } as unknown as Campaign;
const leadForm = { id: "c-form", name: "Solar form", status: "paused", daily_budget: 280, meta_campaign_id: "2", destination: "instant_form" } as unknown as Campaign;

function view(campaigns: Campaign[]) {
  return render(<Campaigns business={business} approved={[]} initialCampaigns={campaigns} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="" />);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue({ authorization: "disconnected" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
});

describe("WhatsApp ready? checklist (#493)", () => {
  it("lists the four things that make people send, and remembers the owner's ticks", async () => {
    const first = view([whatsapp]);
    const list = await screen.findByRole("region", { name: "4 tips to get more replies" });
    const items = within(list).getAllByRole("checkbox");
    expect(items.map((item) => item.getAttribute("aria-label") ?? (item.closest("label")?.textContent ?? ""))).toEqual([
      expect.stringMatching(/profile photo and business name/i),
      expect.stringMatching(/greeting message/i),
      expect.stringMatching(/away message/i),
      expect.stringMatching(/reply within 5 minutes/i),
    ]);
    expect(within(list).queryByText(/of 4/)).toBeNull();
    fireEvent.click(items[0]);
    fireEvent.click(items[3]);
    expect(within(list).getByText("2 of 4 done")).toBeInTheDocument();
    first.unmount();
    view([whatsapp]);
    const again = await screen.findByRole("region", { name: "4 tips to get more replies" });
    expect(within(again).getByText("2 of 4 done")).toBeInTheDocument();
    expect(within(again).getAllByRole("checkbox")[3]).toBeChecked();
  });

  it("is not shown when no campaign uses WhatsApp", async () => {
    view([leadForm]);
    await screen.findByRole("heading", { name: "Solar form" });
    expect(screen.queryByRole("region", { name: "4 tips to get more replies" })).toBeNull();
  });

  it("shows once in campaign setup when WhatsApp chat is chosen", async () => {
    view([whatsapp]);
    const newCampaign = screen.queryByRole("button", { name: "New campaign" });
    if (newCampaign) fireEvent.click(newCampaign);
    fireEvent.click(await screen.findByRole("radio", { name: "WhatsApp chat" }));
    expect(screen.getAllByRole("region", { name: "4 tips to get more replies" })).toHaveLength(1);
  });
});
