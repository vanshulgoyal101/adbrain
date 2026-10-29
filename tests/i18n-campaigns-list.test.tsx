// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
    expect([...status.querySelectorAll("option")].map(option => option.textContent)).toEqual(["सभी स्थिति", "चालू", "रुका हुआ", "ड्राफ़्ट", "पूरा हुआ"]);
    expect(screen.getByRole("button", { name: "और कैंपेन दिखाएं" })).toBeTruthy();
    expect(screen.queryByText("Your campaigns")).toBeNull();
  });

  it("keeps English without words", () => {
    render(<Campaigns business={business} approved={[]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" initialNextCursor="next-1" />);
    expect(screen.getByRole("button", { name: en.campaigns.header.sync })).toBeTruthy();
    expect(screen.getByText(/0 running/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Campaign status" }).querySelector("option")?.textContent).toBe("All statuses");
    expect(screen.getByRole("button", { name: "Load more campaigns" })).toBeTruthy();
  });
});
