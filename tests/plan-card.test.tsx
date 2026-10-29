// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlanCard } from "@/components/plan-card";
import { BillingSection } from "@/components/managed-billing";

// Own billing also mounts Pause all (#1968), which reads the router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const businessId = "55555555-5555-4555-8555-555555555555";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows a plan read failure instead of silently substituting the free-month explanation", () => {
  render(<BillingSection mode="own" connection={null} planBusinessId={businessId} planUnavailable />);
  expect(screen.getByText("Your plan is unavailable right now. Refresh Settings to try again.")).toBeInTheDocument();
  expect(screen.queryByText(/Your first month of AdBrain is free/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pay ₹999" })).not.toBeInTheDocument();
});

it("says the plan read failure in Hindi too", () => {
  render(<BillingSection mode="own" connection={null} locale="hi" planBusinessId={businessId} planUnavailable />);
  expect(screen.getByText("आपका प्लान अभी नहीं दिख रहा। फिर से देखने के लिए सेटिंग रीफ़्रेश करें।")).toBeInTheDocument();
  expect(screen.getByText("आप अपने विज्ञापन खाते से सीधे Meta को भुगतान करते हैं।")).toBeInTheDocument();
});

it("says the price, no auto-debit, and the free month before the first Go live, with nothing to pay", () => {
  render(<PlanCard businessId={businessId} status={{ state: "trial_not_started" }} payUrl={null} />);
  expect(screen.getByText("₹999 a month. First month free from your first Go live. No auto-debit. Stop anytime.")).toBeInTheDocument();
  expect(screen.getByText("Free until your first Go live, then one month free.")).toBeInTheDocument();
  expect(screen.queryByText("Pay ₹999")).toBeNull();
});

it("shows the paid-through date and offers Pay ₹999 only in the last week", () => {
  const view = render(<PlanCard businessId={businessId} status={{ state: "paid", until: "2026-12-10T09:00:00.000Z", dueSoon: false }} payUrl={null} />);
  expect(screen.getByText("Paid through 10 Dec 2026.")).toBeInTheDocument();
  expect(screen.queryByText("Pay ₹999")).toBeNull();
  view.rerender(<PlanCard businessId={businessId} status={{ state: "free", until: "2026-11-10T09:00:00.000Z", dueSoon: true }} payUrl="https://rzp.io/i/a" />);
  expect(screen.getByText("Free until 10 Nov 2026.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pay ₹999" })).toHaveAttribute("href", "https://rzp.io/i/a");
});

it("when unpaid, says running ads keep running and opens the month's link", async () => {
  const fetchMock = vi.fn(async () => Response.json({ payUrl: "https://rzp.io/i/b" }));
  vi.stubGlobal("fetch", fetchMock);
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  render(<PlanCard businessId={businessId} status={{ state: "unpaid", since: "2026-11-10T09:00:00.000Z" }} payUrl={null} />);
  expect(screen.getByText("Payment due since 10 Nov 2026. Running ads keep running; new ads and campaigns wait until you pay.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pay ₹999" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("https://rzp.io/i/b"));
  expect(fetchMock).toHaveBeenCalledWith("/api/payments/plan", expect.objectContaining({ method: "POST", body: JSON.stringify({ businessId }) }));
});

it("shows the server's reason when the link can't be opened, and nothing for exempt businesses", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Nothing is due yet." }, { status: 409 })));
  const view = render(<PlanCard businessId={businessId} status={{ state: "unpaid", since: "2026-11-10T09:00:00.000Z" }} payUrl={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Pay ₹999" }));
  expect(await screen.findByText("Nothing is due yet.")).toBeInTheDocument();
  view.rerender(<PlanCard businessId={businessId} status={{ state: "exempt" }} payUrl={null} />);
  expect(view.container).toBeEmptyDOMElement();
});
