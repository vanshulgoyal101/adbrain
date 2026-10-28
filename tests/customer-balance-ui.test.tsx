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
  expect(screen.getByText("Spent on ads, incl. Meta's GST").nextSibling).toHaveTextContent("₹118.00");
  expect(screen.getByText("Available ad budget")).toBeInTheDocument();
  // #403: ₹0 rows are noise for an owner; the available figure always shows.
  expect(screen.queryByText("Refunded")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /pay|activate/i })).not.toBeInTheDocument();
  // #1235 (owner): AdBrain's split or margin is never shown to customers.
  expect(view.container.textContent).not.toMatch(/\b(80|20)\s?%|service (fee|allocation)|allocation|margin/i);
  // Paid beside the ad budget would show the margin by subtraction, so the default view has no Paid row.
  // CPO row 4: Available leads with its plain line; no Paid and no total ad budget.
  expect(screen.getByText("Available ad budget").nextSibling).toHaveTextContent("₹0.00");
  expect(screen.getByText("What your ads can still spend, including Meta's GST.")).toBeInTheDocument();
  expect(screen.getByText("Held for running campaigns").nextSibling).toHaveTextContent("₹7,882.00");
  expect(screen.queryByText(/^Paid$|^Ad budget,/)).not.toBeInTheDocument();
  expect(view.container.textContent).not.toMatch(/₹10,000|₹8,000/);
  view.rerender(<CustomerBalance businessId="33333333-3333-4333-8333-333333333333" />);
  expect(screen.queryByText("Spent on ads, incl. Meta's GST")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Checking ad budget");
  await screen.findByText("Ad budget is unavailable.");
});
it("does not display fabricated zero funds when storage is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<CustomerBalance businessId={businessId} />);
  await screen.findByText("Ad budget is unavailable.");
  expect(screen.queryByText("Available ad budget")).not.toBeInTheDocument();
});