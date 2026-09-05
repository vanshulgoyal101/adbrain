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
        audience="AdBrain decides from your Brand Brain"
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
        leadFormName="Book a consultation"
        audience="Austin, Texas"
      />,
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByText("₹500/day")).toBeInTheDocument();
    expect(screen.getByText("Book a consultation")).toBeInTheDocument();
    expect(screen.getByText("Austin, Texas")).toBeInTheDocument();
  });

  it("makes the paused-by-default guarantee explicit", () => {
    render(
      <CampaignLaunchReview
        selectedCount={1}
        budget={200}
        leadFormName="Lead form"
        audience="Jaipur"
      />,
    );
    expect(screen.getByText(/creates this campaign paused/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing spends until you activate it/i)).toBeInTheDocument();
  });

  it("shows exactly when the campaign is ready to launch", () => {
    render(
      <CampaignLaunchReview
        selectedCount={2}
        budget={500}
        leadFormName="Book a consultation"
        audience="Jaipur"
      />,
    );
    expect(screen.getByText(/ready to launch/i)).toBeInTheDocument();
    expect(screen.getByText(/launch checklist is complete/i)).toBeInTheDocument();
  });
});
