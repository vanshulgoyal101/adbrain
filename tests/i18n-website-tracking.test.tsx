// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrandTrackingCard } from "@/components/brand-tracking-card";
import { CampaignChat } from "@/components/campaign-chat";
import { WebsiteDestinationFields } from "@/components/campaign-destination";
import { CampaignLaunchReview } from "@/components/campaign-launch-review";
import { namespaceMessages } from "@/i18n/locale";
import { websiteTrackingCopy } from "@/i18n/website-tracking";
import type { ReviewTracking } from "@/lib/campaign/website-tracking";

const noSource: ReviewTracking = {
  pixelId: null,
  status: {
    state: "none", unreadable: null, pixelId: null, pixels: [], window: null,
    lastSeenAt: null, counts: null, totalEvents: null,
  },
};

describe("website tracking words", () => {
  it("uses the Hindi namespace for the Brand card, blocked goals and unknown attribution", () => {
    const copy = websiteTrackingCopy({ locale: "hi", messages: namespaceMessages("hi", "websiteTracking") });
    render(<>
      <BrandTrackingCard tracking={noSource} copy={copy.card} onCheckAgain={vi.fn()} />
      <WebsiteDestinationFields website="example.com" goalChoice={{ value: "visits", tracking: noSource, copy: copy.goals, onChange: vi.fn() }} />
      <CampaignLaunchReview selectedCount={1} budget={300} destination="website" website="example.com"
        audience="Jaipur" websiteReview={{ goal: "leads", attribution: null, copy: copy.review }} />
    </>);
    const card = screen.getByRole("region", { name: "वेबसाइट ट्रैकिंग" });
    expect(within(card).getByText("इस विज्ञापन खाते के लिए वेबसाइट ट्रैकिंग का कोई स्रोत उपलब्ध नहीं है।")).toBeVisible();
    expect(screen.getByRole("radio", { name: "वेबसाइट लीड" })).toHaveAccessibleDescription("ट्रैकिंग चाहिए");
    const review = screen.getByRole("region", { name: /Review/ });
    expect(within(review).getByText("पुष्टि नहीं हुई")).toBeVisible();
    expect(review).not.toHaveTextContent(/7.days|1.day/);
  });

  it.each(["en", "hi"] as const)("formats source names, event counts and the checked window in %s", (locale) => {
    const copy = websiteTrackingCopy({ locale, messages: namespaceMessages(locale, "websiteTracking") });
    expect(copy.card.unnamed(2)).toContain("2");
    expect(copy.card.leadCount(0)).toContain("0");
    expect(copy.card.purchaseCount(12)).toContain("12");
    expect(copy.card.window("start", "end")).toContain("start");
    expect(copy.card.window("start", "end")).toContain("end");
    expect(Object.values(copy.goals).every((value) => typeof value === "string" && value.trim())).toBe(true);
    expect(copy.review.attributionUnavailable).not.toMatch(/\d/);
  });

  it("supplies a localized visible error instead of starting an interview with no website goal", () => {
    const copy = websiteTrackingCopy({ locale: "hi", messages: namespaceMessages("hi", "websiteTracking") });
    const props = { businessId: "business", destination: "website" as const, websiteDraftMismatch: copy.chat.draftMismatch };
    // @ts-expect-error A website interview requires an explicit goal.
    render(<CampaignChat {...props} />);
    expect(screen.getByRole("alert")).toHaveTextContent("वेबसाइट लक्ष्य");
  });
});
