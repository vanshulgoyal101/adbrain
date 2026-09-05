// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { GenerationDetails } from "@/components/generation-details";

it("reports the actual model and explicit fallback without inventing a zero cost", () => {
  render(
    <GenerationDetails
      value={{
        format: "story",
        composition: "overlay",
        textModels: [{ provider: "openrouter", model: "paid-text" }],
        image: {
          provider: "pollinations",
          model: "flux",
          fallbackFrom: "openrouter-image",
          estimatedCostUsd: null,
        },
        concept: { rationale: "Show the product in context." },
      }}
    />,
  );
  expect(screen.getByText("openrouter: paid-text")).toBeInTheDocument();
  expect(screen.getByText("Not reported")).toBeInTheDocument();
  expect(
    screen.getByText(/Fallback used after openrouter-image/),
  ).toBeInTheDocument();
});

it("supports older creatives without a receipt", () => {
  const { container } = render(<GenerationDetails value={null} />);
  expect(container).toBeEmptyDOMElement();
});
