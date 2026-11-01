// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CampaignReviewSummary } from "@/components/campaign-review-summary";
import type { CampaignDeliverySnapshot } from "@/lib/meta/client";

const delivery: CampaignDeliverySnapshot = {
  campaign: { id: "meta-campaign", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED" },
  adSets: [{
    id: "meta-set", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED",
    dailyBudgetPaise: 50000, pageId: "meta-page", destinationType: "ON_AD",
    targeting: { geo_locations: { countries: ["IN"] }, age_min: 30, age_max: 65 },
  }],
  ads: [{ id: "meta-ad", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED", adSetId: "meta-set", creativeId: "meta-creative" }],
};
const props = {
  name: "Saved campaign",
  dailyBudget: 500,
  capped: true,
  selected: {
    adAccountId: "meta-account", accountName: "Test account", pageId: "meta-page",
    pageName: "Test page", currency: "INR", timezoneName: "Asia/Kolkata", metaBusinessId: null,
  },
  delivery,
};

describe("Campaign activation review presentation (#2456)", () => {
  it.each([
    ["DISAPPROVED", "Rejected by Meta"],
    ["WITH_ISSUES", "Needs attention in Meta"],
    ["PENDING_REVIEW", "In Meta's review"],
    ["PENDING_BILLING_INFO", "Payment information required in Meta"],
  ])("keeps an ad's %s warning visible even when the parent is paused", (effectiveStatus, label) => {
    render(<CampaignReviewSummary {...props} delivery={{ ...delivery, ads: [{ ...delivery.ads[0], effectiveStatus }] }}>
      <button disabled>Request activation</button>
    </CampaignReviewSummary>);
    expect(screen.getByText(`Ad 1: ${label}`)).toBeVisible();
    expect(screen.getByText(/^Targeting:/)).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Request activation" })).toBeDisabled();
  });

  it("keeps warnings, duration and the action visible while exact targeting and IDs wait behind a focusable disclosure", async () => {
    const user = userEvent.setup();
    render(<CampaignReviewSummary {...props}>
      <p>Add funds on Meta or choose fewer days.</p>
      <p>Total limit on Meta: ₹1,500 over 3 days.</p>
      <button disabled>Approve total and activate</button>
    </CampaignReviewSummary>);
    expect(screen.getByText("Paused in Meta")).toBeVisible();
    expect(screen.getByText("Effective daily total").nextElementSibling).toHaveTextContent("₹500");
    expect(screen.getByText("Add funds on Meta or choose fewer days.")).toBeVisible();
    expect(screen.getByText("Total limit on Meta: ₹1,500 over 3 days.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve total and activate" })).toBeDisabled();
    const targeting = screen.getByText(/^Targeting:/);
    expect(targeting).not.toBeVisible();
    expect(screen.getByText(/Account ID: meta-account/)).not.toBeVisible();
    expect(screen.getByText(/Parent: meta-campaign/)).not.toBeVisible();
    await user.tab();
    const summary = screen.getByText("Targeting and Meta details");
    expect(summary).toHaveFocus();
    await user.click(summary);
    expect(targeting).toBeVisible();
    expect(targeting).toHaveTextContent('Targeting: {"geo_locations":{"countries":["IN"]},"age_min":30,"age_max":65}');
    expect(screen.getByText(/creative meta-creative/)).toBeVisible();
    await user.click(summary);
    expect(targeting).not.toBeVisible();
    expect(summary).toHaveFocus();
  });

  it("does not invent confirmed delivery or budget when review data is missing", () => {
    render(<CampaignReviewSummary {...props} selected={null} delivery={null} dailyBudget={null} capped={false}>
      <button disabled>Request activation</button>
    </CampaignReviewSummary>);
    expect(screen.getByText("Meta status not confirmed")).toBeVisible();
    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.getByText("Existing ad set schedule in Meta")).toBeVisible();
    expect(screen.queryByText("Targeting and Meta details")).toBeNull();
    expect(screen.getByRole("button", { name: "Request activation" })).toBeDisabled();
  });
});
