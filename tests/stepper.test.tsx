// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stepper } from "@/components/ui/stepper";

describe("<Stepper> (#403)", () => {
  it("names the one flow, marks the current step and uses no step numbers", () => {
    render(<Stepper current="Review" details={{ Review: "3 awaiting approval" }} />);
    const steps = within(screen.getByRole("list", { name: "Steps to an ad" }));
    expect(steps.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Brief", "Create", "Review: 3 awaiting approval", "Launch"]);
    expect(steps.getByText("Review").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("list").textContent).not.toMatch(/\d{2}/);
  });
});
