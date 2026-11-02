// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeWeekCard } from "@/components/home-week-card";

// #1668 (CPO, #1654): the card's words, its one suggestion, and Dismiss (recorded as a ui.action).
describe("<HomeWeekCard>", () => {
  const summary = { chats: 6, enquiries: 1, spend: 1150, bestAd: "Free site survey", suggestion: "run_again" as const };

  it("says last week's numbers, the best ad and one suggestion", () => {
    render(<HomeWeekCard summary={summary} />);
    expect(screen.getByRole("heading", { name: "Last week: 6 chats, 1 real enquiry, ₹1,150 spent" })).toBeInTheDocument();
    expect(screen.getByText("Best ad so far: 'Free site survey'.")).toBeInTheDocument();
    expect(screen.getByText("Nothing is running. Run your best ad again?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run it again" })).toHaveAttribute("href", "/campaigns");
  });

  it("leaves out the best ad and the suggestion when there are none", () => {
    render(<HomeWeekCard summary={{ ...summary, bestAd: null, suggestion: null }} />);
    expect(screen.queryByText(/Best ad so far/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("hides on Dismiss, which records the week's dismissal", () => {
    render(<HomeWeekCard summary={summary} />);
    const dismiss = screen.getByRole("button", { name: "Hide last week's summary" });
    expect(dismiss).toHaveAttribute("data-product-event", "home.week_summary_dismiss");
    fireEvent.click(dismiss);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("speaks Hindi", () => {
    render(<HomeWeekCard summary={{ ...summary, suggestion: "add_enquiries" }} locale="hi" />);
    expect(screen.getByRole("heading", { name: "पिछला हफ़्ता: 6 चैट, 1 असली पूछताछ, ₹1,150 खर्च" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "पूछताछ जोड़ें" })).toHaveAttribute("href", "/leads");
  });
});
