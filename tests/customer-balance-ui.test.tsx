// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerBalance } from "@/components/customer-balance";

const businessId = "22222222-2222-4222-8222-222222222222";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("distinguishes verified payments, media, tax and unavailable customer funds", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ balance: {
    businessId, currency: "INR", capturedPaise: 1000000, refundedPaise: 0, serviceAllocationPaise: 200000,
    advertisingAllocationPaise: 800000, mediaCostPaise: 10000, taxCostPaise: 1800, reservedPaise: 788200,
    remainingPaise: 0, held: true, reason: "Pending costs require reconciliation.",
  } })));
  const view = render(<CustomerBalance businessId={businessId} />);
  await screen.findByText("Pending costs require reconciliation.");
  expect(screen.getByText("Attributed Meta tax")).toBeInTheDocument();
  expect(screen.getByText("Available for a new reservation")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /pay|activate/i })).not.toBeInTheDocument();
  view.rerender(<CustomerBalance businessId="33333333-3333-4333-8333-333333333333" />);
  expect(screen.queryByText("Attributed Meta tax")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Checking allowance");
  await screen.findByText("Advertising allowance is unavailable.");
});
it("does not display fabricated zero funds when storage is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<CustomerBalance businessId={businessId} />);
  await screen.findByText("Advertising allowance is unavailable.");
  expect(screen.queryByText("Available for a new reservation")).not.toBeInTheDocument();
});