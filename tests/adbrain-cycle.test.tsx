// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdbrainCycle } from "@/components/adbrain-cycle";

const current = () => within(screen.getByRole("region", { name: "How AdBrain works" })).getByText(/^Step \d of 6:/).parentElement!;

describe("<AdbrainCycle>", () => {
  it("steps forward and back through the six stops, wrapping at the ends", () => {
    render(<AdbrainCycle />);
    expect(current()).toHaveTextContent("Step 1 of 6: Tell us about your business");
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(current()).toHaveTextContent("Step 6 of 6: See what you spent and what you got");
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(current()).toHaveTextContent("Step 2 of 6: AdBrain makes 3 ads in about a minute");
  });

  it("advances when a stop's timer ends, and can be paused", () => {
    const { container } = render(<AdbrainCycle />);
    const timer = container.querySelector("[aria-hidden] i")!;
    // jsdom has no AnimationEvent, so React listens for the prefixed name.
    fireEvent(timer, new Event("webkitAnimationEnd", { bubbles: true }));
    expect(current()).toHaveTextContent("Step 2 of 6");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("labels every stop as an example and lets the step list jump", () => {
    render(<AdbrainCycle showSteps />);
    expect(screen.getAllByText("Example")).toHaveLength(2);
    const steps = screen.getAllByRole("list")[0];
    fireEvent.click(within(steps).getByRole("button", { name: "Customers message you on WhatsApp" }));
    expect(current()).toHaveTextContent("Step 5 of 6: Customers message you on WhatsApp");
    expect(within(steps).getByRole("button", { name: "Customers message you on WhatsApp" })).toHaveAttribute("aria-current", "step");
  });
});
