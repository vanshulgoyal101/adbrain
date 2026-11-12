// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignTestOptions } from "@/components/campaign-test-options";

afterEach(cleanup);

describe("composer test options (#2273)", () => {
  it("explains when a narrow age range makes only one ad set", () => {
    render(<CampaignTestOptions abTest onAbTest={vi.fn()} totalDailyBudget={300} adSetCount={1} />);
    expect(screen.getByText(/one ad set/i)).toHaveTextContent("₹300");
  });

  it("marks the audience-plan budget as an upper bound until Review resolves the age", () => {
    render(<CampaignTestOptions abTest onAbTest={vi.fn()} totalDailyBudget={600} adSetCount={2} agePending />);
    expect(screen.getByText(/up to two ad sets/i)).toHaveTextContent("₹600");
    expect(screen.getByText(/up to two ad sets/i)).toHaveTextContent(/review/i);
  });

  it("shows owners only the A/B test", () => {
    render(<CampaignTestOptions abTest={false} onAbTest={vi.fn()} totalDailyBudget={300} />);
    expect(screen.getByLabelText(/A\/B test the audience by age/)).toBeTruthy();
    expect(screen.queryByLabelText(/No Facebook Reels/)).toBeNull();
  });

  it("shows the team the no-Facebook-Reels test and reports the choice", () => {
    const onNoFacebookReels = vi.fn();
    render(<CampaignTestOptions abTest={false} onAbTest={vi.fn()} totalDailyBudget={300} noFacebookReels={false} onNoFacebookReels={onNoFacebookReels} />);
    fireEvent.click(screen.getByLabelText(/No Facebook Reels \(team test\)/));
    expect(onNoFacebookReels).toHaveBeenCalledWith(true);
  });
});
