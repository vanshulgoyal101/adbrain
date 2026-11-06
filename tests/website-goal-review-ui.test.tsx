// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CampaignLaunchReview } from "@/components/campaign-launch-review";
import { WebsiteReviewFacts, type WebsiteReviewDetails } from "@/components/campaign-destination";

const english = {
  goals: {
    visits: { label: "Website visits", hint: "People who visit your site." },
    leads: { label: "Website leads", hint: "Lead events, not verified customers." },
    sales: { label: "Sales", hint: "Purchase events, not verified orders." },
  },
  attributionLabel: "Results counted within",
  attributionHelp: "Meta counts results after clicks or views in this period.",
  attributionUnavailable: "Not confirmed",
};

const hindi = {
  goals: {
    visits: { label: "वेबसाइट विज़िट", hint: "आपकी साइट पर आने वाले लोग।" },
    leads: { label: "वेबसाइट लीड", hint: "ये AdBrain से सत्यापित ग्राहक नहीं हैं।" },
    sales: { label: "बिक्री", hint: "ये सत्यापित ऑर्डर नहीं हैं।" },
  },
  attributionLabel: "नतीजे गिनने की अवधि",
  attributionHelp: "Meta इस अवधि के क्लिक या विज्ञापन देखने के बाद आए नतीजे गिनता है।",
  attributionUnavailable: "पुष्टि नहीं हुई",
};

const baseProps = { selectedCount: 1, budget: 500, destination: "website" as const, website: "example.com", audience: "Jaipur" };
const leads = { goal: "leads", attribution: "28-day click / 1-day view", copy: english } satisfies WebsiteReviewDetails;

describe("website goal Review facts", () => {
  it("shows the reviewed goal and actual attribution rather than assuming visits or a fixed window", () => {
    render(<CampaignLaunchReview {...baseProps} websiteReview={leads} />);
    expect(screen.getByText("Website leads")).toBeInTheDocument();
    expect(screen.getByText("Lead events, not verified customers.")).toBeInTheDocument();
    expect(screen.getByText("Results counted within")).toBeInTheDocument();
    expect(screen.getByText("28-day click / 1-day view")).toBeInTheDocument();
    expect(screen.queryByText("7-day click / 1-day view")).not.toBeInTheDocument();
    expect(screen.queryByText(/ready for campaign review/i)).not.toBeInTheDocument();
  });

  it("says attribution is unconfirmed instead of inventing it", () => {
    render(<CampaignLaunchReview {...baseProps} websiteReview={{ ...leads, goal: "sales", attribution: null }} />);
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Not confirmed")).toBeInTheDocument();
    expect(screen.queryByText(/day click/i)).not.toBeInTheDocument();
  });

  it("uses the supplied Hindi copy on the server Review rows", () => {
    render(<dl><WebsiteReviewFacts url="https://example.com" websiteReview={{ goal: "leads", attribution: null, copy: hindi }} /></dl>);
    expect(screen.getByText("वेबसाइट लीड")).toBeInTheDocument();
    expect(screen.getByText("ये AdBrain से सत्यापित ग्राहक नहीं हैं।")).toBeInTheDocument();
    expect(screen.getByText("नतीजे गिनने की अवधि")).toBeInTheDocument();
    expect(screen.getByText("पुष्टि नहीं हुई")).toBeInTheDocument();
  });

  it("does not display website Review details for another destination", () => {
    render(<CampaignLaunchReview {...baseProps} destination="whatsapp" whatsappNumber="+91 ••••• 4842" websiteReview={leads} />);
    expect(screen.queryByText("Website leads")).not.toBeInTheDocument();
    expect(screen.queryByText("Results counted within")).not.toBeInTheDocument();
  });
});
