// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { Campaigns } from "@/components/campaigns";
import { describeSkippedCampaigns } from "@/lib/campaign/sync-skips";
import type { Business, Campaign } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({
  createMetaConnectClient: () => ({ drafts: vi.fn().mockResolvedValue([]), status: vi.fn().mockResolvedValue({ authorization: "none" }) }),
  MetaConnectClientError: class extends Error {},
}));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solar installer", locations: ["Jaipur"] } as Business;
const campaign = { id: "c-1", business_id: business.id, name: "Diwali offer", status: "paused", daily_budget: 300, created_at: "2026-10-01T00:00:00.000Z", raw: {} } as unknown as Campaign;
const skipped = [
  { name: "Old run", reason: "lifetime_budget" as const },
  { name: null, reason: "other_page" as const },
];

describe("#1438 Campaigns list words", () => {
  it.each([
    ["en", en.campaigns, en.verdict, "28 taps on the WhatsApp button, 1 messaged you"],
    ["hi", hi.campaigns, hi.verdict, "WhatsApp बटन पर 28 टैप हुए, 1 ने आपको मैसेज किया"],
  ] as const)("labels WhatsApp link clicks as button taps in %s without changing counts", async (locale, messages, verdictMessages, expected) => {
    const whatsapp = { ...campaign, destination: "whatsapp" as const };
    const result = { id: "r-1", campaign_id: campaign.id, impressions: 900, clicks: 28, leads: 0, spend: 150, cpl: null, conversations: 1, cost_per_conversation: 150, whatsapp_opens: 28, destination: "whatsapp" as const, fetched_at: new Date().toISOString() };
    render(<Campaigns business={business} approved={[]} initialCampaigns={[whatsapp]} initialResults={{ [campaign.id]: result }} leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" campaignWords={{ locale, messages }} verdictWords={{ locale, messages: verdictMessages }} />);
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it("keeps the English sync lines word for word", () => {
    expect(describeSkippedCampaigns(skipped, 4)).toBe(
      "\"Old run\" was left unchanged: it uses a lifetime budget set in Meta, which AdBrain doesn't manage. "
      + "A campaign was left unchanged: it advertises a different Facebook Page. 2 more campaigns were left unchanged.",
    );
    expect(describeSkippedCampaigns(skipped.slice(0, 1), 2)).toMatch(/1 more campaign was left unchanged\.$/);
  });

  it("says skipped campaigns in Hindi", () => {
    const text = describeSkippedCampaigns(skipped, 4, { locale: "hi", messages: hi.campaigns });
    expect(text).toBe(
      "\"Old run\" में कोई बदलाव नहीं किया गया: इसमें Meta में सेट किया पूरा (lifetime) बजट है, जिसे AdBrain नहीं संभालता। "
      + "एक कैंपेन में कोई बदलाव नहीं किया गया: यह किसी दूसरे Facebook Page का विज्ञापन है। 2 और कैंपेन में बदलाव नहीं किया गया।",
    );
  });

  it("renders the list header and filters in Hindi", () => {
    render(<Campaigns business={business} approved={[]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" initialNextCursor="next-1" campaignWords={{ locale: "hi", messages: hi.campaigns }} />);
    expect(screen.getByText(/0 चालू/)).toBeTruthy();
    expect(screen.getByText(/1 रुके हुए/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /आपके कैंपेन/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Meta से अपडेट करें" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "कैंपेन खोजें" })).toBeTruthy();
    const status = screen.getByRole("combobox", { name: "कैंपेन की स्थिति" });
    expect([...status.querySelectorAll("option")].map(option => option.textContent)).toEqual(["सभी स्थितियाँ", "चालू", "रुका हुआ", "ड्राफ़्ट", "पूरा हुआ"]);
    expect(screen.getByRole("button", { name: "और कैंपेन दिखाएँ" })).toBeTruthy();
    expect(screen.queryByText("Your campaigns")).toBeNull();
  });

  it("keeps English without words", () => {
    render(<Campaigns business={business} approved={[]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" initialNextCursor="next-1" />);
    expect(screen.getByRole("button", { name: en.campaigns.header.sync })).toBeTruthy();
    expect(screen.getByText(/0 running/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Campaign status" }).querySelector("option")?.textContent).toBe("All statuses");
    expect(screen.getByRole("button", { name: "Load more campaigns" })).toBeTruthy();
  });

  it("renders a running card and its refresh notice in Hindi", async () => {
    const running = { ...campaign, id: "c-2", status: "active", meta_campaign_id: "meta-2", raw: { metaResult: { campaignId: "meta-2" } } } as unknown as Campaign;
    const result = { campaign_id: "c-2", impressions: 900, clicks: 12, leads: 0, spend: 150, cpl: null, conversations: 2, fetched_at: new Date().toISOString() };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Campaigns business={business} approved={[]} initialCampaigns={[running]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" campaignWords={{ locale: "hi", messages: hi.campaigns }} />);
    expect(screen.getByText("₹300 रोज़")).toBeTruthy();
    expect(screen.getByText(hi.campaigns.card.noResults)).toBeTruthy();
    expect(screen.getByRole("button", { name: "रोकें" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Diwali offer के और विकल्प" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "नतीजे रिफ़्रेश करें" }));
    await waitFor(() => expect(screen.getByText("नतीजे अभी-अभी अपडेट हुए।")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/campaigns/c-2/refresh", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });
});
