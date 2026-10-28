// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CampaignLaunchReview } from "@/components/campaign-launch-review";

describe("<CampaignLaunchReview>", () => {
  it("shows incomplete choices before launch", () => {
    render(
      <CampaignLaunchReview
        selectedCount={0}
        budget={0}
        destination="instant_form"
        audience="AdBrain decides from your business details"
      />,
    );
    expect(screen.getByText("Select an ad")).toBeInTheDocument();
    expect(screen.getByText("Enter a budget")).toBeInTheDocument();
    expect(screen.getByText("Choose a lead form")).toBeInTheDocument();
  });

  it("summarises exactly what will be created", () => {
    render(
      <CampaignLaunchReview
        selectedCount={2}
        budget={500}
        destination="instant_form"
        leadFormName="Book a consultation"
        audience="Austin, Texas"
      />,
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByText("₹500 a day")).toBeInTheDocument();
    expect(screen.getByText("Book a consultation")).toBeInTheDocument();
    expect(screen.getByText("Austin, Texas")).toBeInTheDocument();
  });

  it("makes the paused-by-default guarantee explicit", () => {
    render(
      <CampaignLaunchReview
        selectedCount={1}
        budget={200}
        destination="instant_form"
        leadFormName="Lead form"
        audience="Jaipur"
      />,
    );
    expect(screen.getByText(/creates this campaign paused/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing spends until you activate it/i)).toBeInTheDocument();
  });

  it("distinguishes paused creation from activation and external eligibility", () => {
    render(
      <CampaignLaunchReview
        selectedCount={2}
        budget={500}
        destination="instant_form"
        leadFormName="Book a consultation"
        audience="Jaipur"
      />,
    );
    expect(screen.getByText(/ready for campaign review/i)).toBeInTheDocument();
    expect(screen.queryByText(/ready to create paused campaign/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Meta eligibility and audience checks still apply/i)).toBeInTheDocument();
  });

  it("shows the masked WhatsApp button number as the destination", () => {
    render(
      <CampaignLaunchReview
        selectedCount={1}
        budget={280}
        destination="whatsapp"
        whatsappNumber="+91 ••••• 4842"
        audience="Chandigarh"
      />,
    );
    expect(screen.getByText("WhatsApp chat +91 ••••• 4842")).toBeInTheDocument();
    expect(screen.getByText("Shown on Facebook, Instagram and Messenger")).toBeInTheDocument();
    expect(screen.getByText(/ready for campaign review/i)).toBeInTheDocument();
  });
});

describe("Advantage+ audience note (#334)", () => {
  it("tells the owner Meta may widen age and interests but never the area", () => {
    render(<CampaignLaunchReview selectedCount={1} budget={280} destination="instant_form" leadFormName="Enquiries" audience="Tricity, ages 25–55" />);
    expect(screen.getByText("Meta may reach people beyond your age range and interests; never outside your area.")).toBeInTheDocument();
  });
});
