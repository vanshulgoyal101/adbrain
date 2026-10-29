// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BillingSection, ManagedBilling, initialBillingTab } from "@/components/managed-billing";
import { getProductionCollectionPolicy, OPERATOR_MANAGED_POLICY, PRICING_V2_APPROVED_AT } from "@/lib/payments/production-config";
import { TestCheckout, type TestCheckoutOptions } from "@/components/test-checkout";
import { ProductionCheckout } from "@/components/production-checkout";
import { createAnnualPaymentQuote, createVerificationPaymentQuote } from "@/lib/payments/allocation";

// #1968: own-account billing mounts Pause all, which reads the app router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/script", () => ({ default: ({ onReady, onError }: { onReady: () => void; onError: () => void }) =>
  <img alt="" data-testid="checkout-script" onLoad={onReady} onError={onError} /> }));
vi.mock("@/components/customer-balance", () => ({ CustomerBalance: ({ businessId }: { businessId: string }) =>
  <div data-testid="customer-balance" data-business-id={businessId} /> }));

const connected = { adAccountId: "act_123", ready: true, expired: false, pending: false };

// #1567: live terms come from the policy collection accepts (priced-v2), not the retired v1 text (#1235, #1536).
const policyAt = Date.parse(PRICING_V2_APPROVED_AT);
const liveCollectionEnv = {
  PAYMENTS_LIVE_ENABLED: "true", NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_PROJECT_ID: "prj_fixture", PAYMENTS_LIVE_PROJECT_ID: "prj_fixture",
  NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", PAYMENTS_LIVE_SUPABASE_URL: "https://fixture.supabase.co",
  RAZORPAY_LIVE_KEY_ID: "rzp_live_fixture", RAZORPAY_LIVE_KEY_SECRET: "synthetic-checkout-secret",
  RAZORPAY_LIVE_ACCOUNT_ID: "acc_fixture", RAZORPAY_LIVE_WEBHOOK_SECRET: "synthetic-webhook-secret",
  PAYMENTS_LIVE_WEBHOOK_ID: "33333333-3333-4333-8333-333333333333", PAYMENTS_LIVE_COLLECTION_ENABLED: "true",
};
/** #1235 (owner): AdBrain's service/advertising split, in the words the CTO listed on #1567. */
const SPLIT_WORDS = /(?<![\w.])(?:80|20)\s?%|allocated to service|service allocation/i;
/** The collection policy is built on the server only (it refuses when `window` exists); build it there, then render. */
function serverPolicy(...args: Parameters<typeof getProductionCollectionPolicy>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window")!;
  Object.defineProperty(globalThis, "window", { value: undefined, configurable: true });
  try { return getProductionCollectionPolicy(...args); } finally { Object.defineProperty(globalThis, "window", descriptor); }
}

const businessId = "22222222-2222-4222-8222-222222222222";
const orderId = "11111111-1111-4111-8111-111111111111";
const storageKey = `adbrain:test-checkout:${businessId}`;
const createdOrder = { orderId, environment: "test", status: "created", amountPaise: 1_000_000, currency: "INR", canActivateCampaign: false, spendablePaise: 0,
  checkout: { key: "rzp_test_fixture", order_id: "order_fixture", amount: 1_000_000, currency: "INR", name: "AdBrain Test", description: "Test only" } };
let options: TestCheckoutOptions;
let paymentFailed: () => void;
const opened = vi.fn();
const closed = vi.fn();
const fetchMock = vi.fn();
beforeEach(() => {
  sessionStorage.clear();
  opened.mockReset(); closed.mockReset(); fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json(createdOrder));
  vi.stubGlobal("fetch", fetchMock);
  window.Razorpay = class {
    constructor(input: TestCheckoutOptions) { options = input; }
    open = opened;
    close = closed;
    on(_event: string, handler: () => void) { paymentFailed = handler; }
  };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); delete window.Razorpay; });

async function mountCheckout() {
  const rendered = render(<TestCheckout businessId={businessId} />);
  fireEvent.load(screen.getByTestId("checkout-script"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Pay ₹10,000 (test)" })).toBeEnabled());
  return rendered;
}

describe("test checkout", () => {
  it("opens only a server-defined test order and verifies callback capture", async () => {
    await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000 (test)" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(options).toMatchObject({ key: "rzp_test_fixture", order_id: "order_fixture", amount: 1_000_000, retry: { enabled: false } });
    expect(options.config.display).toEqual({
      blocks: { test_methods: { name: "Payment methods", instruments: [{ method: "card" }, { method: "netbanking" }, { method: "upi" }] } },
      sequence: ["block.test_methods"], preferences: { show_default_blocks: false },
    });
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toMatchObject({ orderId, opened: true });
    fetchMock.mockResolvedValue(Response.json({ ...createdOrder, status: "captured", checkout: null }));
    act(() => options.handler({ razorpay_order_id: "order_fixture", razorpay_payment_id: "pay_fixture", razorpay_signature: "a".repeat(64) }));
    await screen.findByText("Test payment confirmed");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ orderId, paymentId: "pay_fixture", signature: "a".repeat(64), providerOrderId: "order_fixture" });
    expect(screen.getByText("₹0")).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).not.toHaveProperty("proof");
    act(() => {
      options.modal.ondismiss();
      options.handler({ razorpay_order_id: "order_fixture", razorpay_payment_id: "pay_fixture", razorpay_signature: "a".repeat(64) });
    });
    expect(screen.getByText("Test payment confirmed")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains one order after dismissal and reload without reopening checkout", async () => {
    const view = await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000 (test)" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    act(() => options.modal.ondismiss());
    expect(screen.getByText(/Checkout closed/)).toBeInTheDocument();
    view.unmount();
    render(<TestCheckout businessId={businessId} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain(`orderId=${orderId}`);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Pay ₹/ })).not.toBeInTheDocument();
  });

  it("recovers a callback after verification disconnects and the page reloads", async () => {
    const view = await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000 (test)" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    fetchMock.mockRejectedValueOnce(new Error("Disconnected after capture"));
    act(() => options.handler({ razorpay_order_id: "order_fixture", razorpay_payment_id: "pay_fixture", razorpay_signature: "a".repeat(64) }));
    await screen.findByText(/Payment status is unconfirmed/);
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toMatchObject({ proof: { paymentId: "pay_fixture" } });
    view.unmount();
    fetchMock.mockImplementation(async () => Response.json({ ...createdOrder, status: "captured", checkout: null }));
    render(<TestCheckout businessId={businessId} />);
    await screen.findByText("Test payment confirmed");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/payments/test/verify");
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("keeps a failure or mismatched callback from claiming success", async () => {
    await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000 (test)" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    act(() => paymentFailed());
    expect(screen.getByText(/Razorpay reported a failed attempt/)).toBeInTheDocument();
    act(() => options.handler({ razorpay_order_id: "order_other", razorpay_payment_id: "pay_fixture", razorpay_signature: "a".repeat(64) }));
    expect(screen.getByText("Review required")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks unreadable recovery data instead of starting another payment", async () => {
    sessionStorage.setItem(storageKey, "not valid JSON");
    render(<TestCheckout businessId={businessId} />);
    await screen.findByText(/Saved payment details are unavailable/);
    expect(screen.queryByRole("button", { name: /Pay ₹/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not use a different business's stored payment", async () => {
    sessionStorage.setItem("adbrain:test-checkout:other-business", JSON.stringify({ version: 1, idempotencyKey: orderId, orderId, opened: true }));
    await mountCheckout();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores callbacks after unmount", async () => {
    const view = await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000 (test)" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    view.unmount();
    options.handler({ razorpay_order_id: "order_fixture", razorpay_payment_id: "pay_fixture", razorpay_signature: "a".repeat(64) });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the same key after an interrupted create", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network disconnected"));
    await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000 (test)" }));
    await screen.findByText(/Checkout could not be opened/);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(first);
    expect(opened).not.toHaveBeenCalled();
  });

  it("blocks live checkout keys and malformed amounts", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...createdOrder, checkout: { ...createdOrder.checkout, key: "rzp_live_fixture" } }));
    await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000 (test)" }));
    await screen.findByText(/Checkout could not be opened/);
    expect(opened).not.toHaveBeenCalled();
  });

  it("does not call the API when recovery storage cannot be written", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000 (test)" }));
    await screen.findByText(/Checkout could not be opened/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows script failure without starting an order", async () => {
    render(<TestCheckout businessId={businessId} />);
    fireEvent.error(screen.getByTestId("checkout-script"));
    expect(screen.getByRole("button", { name: "Reload checkout" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("times out a script that never becomes ready", async () => {
    vi.useFakeTimers();
    render(<TestCheckout businessId={businessId} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("button", { name: "Reload checkout" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("production checkout with synthetic responses", () => {
  const livePolicy = serverPolicy(liveCollectionEnv, policyAt);
  const liveOrder = { ...createdOrder, environment: "live", capturedPaise: 0, refundedPaise: 0, refundReconciliationPending: false, receipt: null,
    checkout: { ...createdOrder.checkout, key: "rzp_live_fixture", name: "Vanshul Goyal", description: "AdBrain annual service" } };
  const captured = { ...liveOrder, status: "captured", capturedPaise: 1_000_000, checkout: null,
    receipt: { reference: orderId, paymentId: "pay_fixture", merchant: "Vanshul Goyal", amountPaise: 1_000_000, currency: "INR", isTaxInvoice: false } };
  async function mountLive(orders: unknown[] = []) {
    fetchMock.mockImplementation(async (path: string) => Response.json(path.includes("orders?") ? { policy: livePolicy, orders }
      : path.endsWith("verify") ? captured : liveOrder));
    const view = render(<ProductionCheckout businessId={businessId} />);
    await screen.findByText(orders.length ? "Awaiting payment" : "Ready for payment");
    fireEvent.load(screen.getByTestId("checkout-script"));
    fireEvent.click(screen.getByRole("checkbox"));
    return view;
  }
  it("requires accepted terms and uses only the live server order", async () => {
    await mountLive();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Pay ₹10,000" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(screen.getByText(livePolicy.serviceScope)).toBeInTheDocument();
    expect(screen.getByText(livePolicy.refundTerms)).toBeInTheDocument();
    expect(screen.getByText(/The operator pays Meta separately\. Your ad budget is not yet a confirmed Meta balance\./)).toBeInTheDocument();
    expect(options).toMatchObject({ key: "rzp_live_fixture", amount: 1_000_000, order_id: "order_fixture", retry: { enabled: false } });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ businessId, termsHash: livePolicy.hash, acceptTerms: true });
    act(() => options.handler({ razorpay_order_id: "order_fixture", razorpay_payment_id: "pay_fixture", razorpay_signature: "b".repeat(64) }));
    await screen.findByText("Payment confirmed");
    expect(screen.queryByRole("button", { name: /Pay ₹/ })).not.toBeInTheDocument();
    expect(screen.getByText("Payment receipt")).toBeInTheDocument();
    expect(screen.getByText("This receipt is not a tax invoice. Payment confirmation does not authorize ad activation.")).toBeInTheDocument();
  });

  it("shows the server verification amount without reopening an older annual order", async () => {
    const quote = createVerificationPaymentQuote(1_000);
    const verificationOrder = { ...liveOrder, amountPaise: 1_000, quote,
      checkout: { ...liveOrder.checkout, amount: 1_000, description: "AdBrain payment verification" } };
    fetchMock.mockImplementation(async (path: string) => Response.json(path.includes("orders?")
      ? { policy: { ...livePolicy, serviceScope: "Real payment verification, no service or ad allowance." }, quote,
        orders: [{ ...liveOrder, orderId: "33333333-3333-4333-8333-333333333333", quote: createAnnualPaymentQuote() }] }
      : verificationOrder));
    render(<ProductionCheckout businessId={businessId} />);
    await screen.findByText("Ready for payment");
    expect(screen.getByRole("heading", { name: "Payment verification" })).toBeInTheDocument();
    expect(screen.getByText("Previous payments")).toBeInTheDocument();
    // #1235: the verification breakdown names no service share.
    expect(screen.getByText("Checkout test: no ad budget is added")).toBeInTheDocument();
    expect(screen.queryByText("Service allocation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue saved checkout" })).not.toBeInTheDocument();
    fireEvent.load(screen.getByTestId("checkout-script"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(options).toMatchObject({ amount: 1_000, description: "AdBrain payment verification" });
  });

  it("updates a custom rupee amount through a server quote and requires fresh acceptance before payment", async () => {
    const initial = { policy: livePolicy, quote: createVerificationPaymentQuote(1000),
      verificationAmountRange: { minPaise: 100, maxPaise: 1000 }, orders: [] };
    const updated = { ...initial, policy: { ...livePolicy, hash: "b".repeat(64) }, quote: createVerificationPaymentQuote(525) };
    fetchMock.mockImplementation(async (path: string) => Response.json(path.includes("verificationAmountPaise=525") ? updated
      : path.includes("orders?") ? initial : { ...liveOrder, quote: updated.quote, amountPaise: 525,
        checkout: { ...liveOrder.checkout, amount: 525, description: "AdBrain payment verification" } }));
    render(<ProductionCheckout businessId={businessId} />);
    await screen.findByText("Ready for payment");
    fireEvent.load(screen.getByTestId("checkout-script"));
    fireEvent.click(screen.getByRole("checkbox"));
    const input = screen.getByRole("spinbutton", { name: "Verification amount (₹)" });
    expect(input).toHaveValue(10);
    fireEvent.change(input, { target: { value: "5.25" } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pay ₹10" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Update amount" }));
    await screen.findByText("Amount updated.");
    expect(fetchMock.mock.calls[1][0]).toContain("verificationAmountPaise=525");
    expect(fetchMock.mock.calls[1][1].method).toBe("GET");
    expect(screen.getByRole("button", { name: "Pay ₹5.25" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹5.25" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ verificationAmountPaise: 525, termsHash: updated.policy.hash, acceptTerms: true });
    expect(options).toMatchObject({ amount: 525 });
    expect(input).toBeDisabled();
  });

  it("rejects invalid custom amounts locally and leaves payment disabled after a failed quote update", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ policy: livePolicy, quote: createVerificationPaymentQuote(),
      verificationAmountRange: { minPaise: 100, maxPaise: 1000 }, orders: [] }));
    render(<ProductionCheckout businessId={businessId} />);
    await screen.findByText("Ready for payment");
    const input = screen.getByRole("spinbutton", { name: "Verification amount (₹)" });
    for (const value of ["0", "10.01", "1.234", "1e3"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Update amount" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount from ₹1 to ₹10"));
      await waitFor(() => expect(input).toBeEnabled());
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Quote unavailable" }, { status: 503 }));
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Update amount" }));
    await screen.findByText("Quote unavailable");
    expect(screen.getByRole("button", { name: "Pay ₹10" })).toBeDisabled();
    expect(opened).not.toHaveBeenCalled();
  });

  it("keeps amount entry unavailable for the normal annual package", async () => {
    await mountLive();
    expect(screen.queryByRole("spinbutton", { name: "Verification amount (₹)" })).not.toBeInTheDocument();
  });

  describe("custom annual amount (#212)", () => {
    const annualRange = { minPaise: 50_000, maxPaise: 1_000_000 };
    const chosenQuote = createAnnualPaymentQuote(125_000);
    const chosen = { policy: { ...livePolicy, hash: "b".repeat(64) }, quote: chosenQuote, annualAmountRange: annualRange };
    const chosenOrder = { ...liveOrder, amountPaise: 125_000, quote: chosenQuote, checkout: { ...liveOrder.checkout, amount: 125_000 } };
    async function mountAnnual(orders: unknown[] = []) {
      fetchMock.mockImplementation(async (path: string) => Response.json(path.includes("amountPaise=125000") ? { ...chosen, orders }
        : path.includes("orders?") ? { policy: livePolicy, quote: createAnnualPaymentQuote(), annualAmountRange: annualRange, orders }
          : chosenOrder));
      render(<ProductionCheckout businessId={businessId} />);
      await screen.findByText(orders.length ? /Payment confirmed|Awaiting payment/ : "Ready for payment");
      fireEvent.load(screen.getByTestId("checkout-script"));
    }

    it("says pay-as-you-go: Ad money title, no split and no annual wording (#225, #1235)", async () => {
      await mountAnnual();
      expect(screen.getByRole("heading", { name: "Ad money" })).toBeInTheDocument();
      expect(screen.getByText("Pay any amount from \u20b9500. It becomes your ad budget, including Meta's GST, and AdBrain makes and runs your ads. Top up any time.")).toBeInTheDocument();
      expect(screen.queryByText(/Annual/)).not.toBeInTheDocument();
    });

    it("takes an amount, shows only what is paid (no ad-budget amount, #1235), and creates the order for that amount", async () => {
      await mountAnnual();
      const input = screen.getByRole("spinbutton", { name: "Amount to pay (₹)" });
      expect(input).toHaveValue(10_000);
      expect(screen.getByText("You pay").nextSibling).toHaveTextContent("₹10,000");
      expect(screen.queryByText(/Ad budget for|AdBrain service|₹8,000|₹2,000/)).not.toBeInTheDocument();
      fireEvent.change(input, { target: { value: "1250" } });
      expect(screen.getByRole("button", { name: "Pay ₹10,000" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Update amount" }));
      await screen.findByText("Amount updated.");
      expect(fetchMock.mock.calls.at(-1)![0]).toContain("amountPaise=125000");
      expect(screen.getByText("You pay").nextSibling).toHaveTextContent("₹1,250");
      expect(screen.queryByText(/₹1,000|₹250/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Pay ₹1,250" }));
      await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
      expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toMatchObject({ amountPaise: 125_000, termsHash: "b".repeat(64), acceptTerms: true });
      expect(options).toMatchObject({ amount: 125_000 });
      expect(sessionStorage.length).toBe(0);
    });

    it.each(["0", "5", "499.99", "10000.01", "20000", "1e3"])("rejects %s before asking the server for a quote", async value => {
      await mountAnnual();
      fireEvent.change(screen.getByRole("spinbutton", { name: "Amount to pay (₹)" }), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Update amount" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount from ₹500 to ₹10,000"));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("says a new amount replaces an unpaid request and never offers to pay the replaced one", async () => {
      await mountAnnual([liveOrder]);
      expect(screen.getByRole("button", { name: "Continue saved checkout" })).toBeInTheDocument();
      fireEvent.change(screen.getByRole("spinbutton", { name: "Amount to pay (₹)" }), { target: { value: "1250" } });
      fireEvent.click(screen.getByRole("button", { name: "Update amount" }));
      await screen.findByText("Amount updated.");
      expect(screen.getByText(/replaces your unpaid request for .*10,000/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Continue saved checkout" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pay ₹1,250" })).toBeInTheDocument();
    });

    it("lists a replaced order as replaced with no Pay button", async () => {
      fetchMock.mockImplementation(async () => Response.json({ policy: livePolicy, quote: createAnnualPaymentQuote(), annualAmountRange: annualRange,
        orders: [{ ...liveOrder, status: "superseded", checkout: null }] }));
      render(<ProductionCheckout businessId={businessId} />);
      await screen.findByText("Ready for payment");
      fireEvent.click(screen.getByText("Previous payments"));
      expect(screen.getByText(/Ad money: .*10,000 - Replaced by a newer payment request/)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Continue saved checkout" })).not.toBeInTheDocument();
    });

    it("lets the customer pay again after a payment is captured and keeps the earlier one in history", async () => {
      await mountAnnual([captured]);
      expect(screen.getByText("Payment confirmed")).toBeInTheDocument();
      expect(screen.queryByRole("spinbutton", { name: "Amount to pay (₹)" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Add more ad money" }));
      expect(screen.getByText("Ready for payment")).toBeInTheDocument();
      expect(screen.getByRole("spinbutton", { name: "Amount to pay (₹)" })).toBeInTheDocument();
      fireEvent.click(screen.getByText("Previous payments"));
      expect(screen.getByText(/Captured: .*10,000/)).toBeVisible();
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000" }));
      await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
      expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toMatchObject({ amountPaise: 1_000_000 });
    });
  });

  it("restores annual checkout while preserving the verification capture and refund history", async () => {
    const previous = { ...captured, amountPaise: 1_000, quote: createVerificationPaymentQuote(),
      status: "partially_refunded", capturedPaise: 1_000, refundedPaise: 250,
      receipt: { ...captured.receipt, amountPaise: 1_000 } };
    fetchMock.mockResolvedValue(Response.json({ policy: livePolicy, quote: createAnnualPaymentQuote(), orders: [previous] }));
    render(<ProductionCheckout businessId={businessId} />);
    await screen.findByText("Ready for payment");
    expect(screen.getByRole("heading", { name: "Ad money" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay ₹10,000" })).toBeDisabled();
    fireEvent.click(screen.getByText("Previous payments"));
    expect(screen.getByText(/Captured: .*10\. Verified refunds: .*2\.50\./)).toBeVisible();
    expect(screen.getByText(/Payment verification: .*10 - Partially refunded/)).toBeVisible();
    expect(opened).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects checkout amounts that disagree with the saved quote", async () => {
    fetchMock.mockResolvedValue(Response.json({ policy: livePolicy, quote: createVerificationPaymentQuote(), orders: [{
      ...liveOrder, amountPaise: 1_000, quote: createVerificationPaymentQuote(),
    }] }));
    render(<ProductionCheckout businessId={businessId} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(opened).not.toHaveBeenCalled();
  });
  it("does not reopen checkout after dismissal and reload", async () => {
    const view = await mountLive();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    act(() => options.modal.ondismiss());
    expect(screen.getByText("Checkout closed. Payment status is unconfirmed.")).toBeInTheDocument();
    view.unmount();
    await mountLive([liveOrder]);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Continue saved checkout" })).toBeInTheDocument();
  });
  it("checks current server terms before explicitly resuming an existing order", async () => {
    await mountLive([liveOrder]);
    fetchMock.mockImplementation(async () => Response.json({ policy: null, orders: [{ ...liveOrder, checkout: null }] }));
    fireEvent.click(screen.getByRole("button", { name: "Continue saved checkout" }));
    await screen.findByText("Payment terms changed. Review the current terms before continuing.");
    expect(opened).not.toHaveBeenCalled();
  });
  it("QA recovers a lost verification response on reload without reopening checkout or replaying callbacks", async () => {
    const view = await mountLive();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    fetchMock.mockRejectedValueOnce(new Error("Synthetic verification response lost"));
    const proof = { razorpay_order_id: "order_fixture", razorpay_payment_id: "pay_fixture", razorpay_signature: "b".repeat(64) };
    act(() => {
      options.handler(proof);
      options.handler(proof);
      options.modal.ondismiss();
    });
    await screen.findByText("Synthetic verification response lost");
    expect(screen.queryByText("Payment confirmed")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith("verify"))).toHaveLength(1);
    view.unmount();
    fetchMock.mockImplementation(async () => Response.json({ policy: null, orders: [captured] }));
    render(<ProductionCheckout businessId={businessId} />);
    await screen.findByText("Payment confirmed");
    expect(screen.getByText("Payment receipt")).toBeInTheDocument();
    expect(screen.getByText(/does not authorize ad activation/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pay INR|Continue saved/ })).not.toBeInTheDocument();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([path, requestOptions]) => path.endsWith("orders") && requestOptions.method === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith("verify"))).toHaveLength(1);
  });

  it("QA requires renewed acceptance when a status refresh changes collection terms", async () => {
    await mountLive();
    expect(screen.getByRole("checkbox")).toBeChecked();
    fetchMock.mockImplementation(async () => Response.json({
      policy: { ...livePolicy, hash: "b".repeat(64), invoiceTerms: "Updated synthetic invoice terms" }, orders: [],
    }));
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    await screen.findByText("Updated synthetic invoice terms");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Pay ₹10,000" })).toBeDisabled();
    expect(fetchMock.mock.calls.every(([, requestOptions]) => requestOptions.method === "GET")).toBe(true);
    expect(opened).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async () => Response.json(liveOrder));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    const [, createRequest] = fetchMock.mock.calls.find(([path, requestOptions]) => path.endsWith("orders") && requestOptions.method === "POST")!;
    expect(JSON.parse(createRequest.body)).toMatchObject({ termsHash: "b".repeat(64), acceptTerms: true });
  });

  it("rejects test-mode confirmations in the live view", async () => {
    fetchMock.mockImplementation(async () => Response.json({ policy: livePolicy, orders: [{ ...captured, environment: "test" }] }));
    render(<ProductionCheckout businessId={businessId} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("Payment confirmed")).not.toBeInTheDocument();
    expect(opened).not.toHaveBeenCalled();
  });
  it("blocks a new provider operation when browser recovery storage cannot be written", async () => {
    await mountLive();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹10,000" }));
    await screen.findByText("Storage unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
  });
  it.each(["refund_pending", "partially_refunded", "refunded", "review_required"])("recovers %s without another payment", async status => {
    fetchMock.mockImplementation(async () => Response.json({ policy: null, orders: [{ ...captured, status }] }));
    render(<ProductionCheckout businessId={businessId} />);
    await screen.findByText(`Payment reference: ${orderId}`);
    expect(screen.queryByRole("button", { name: /Pay INR|Continue saved/ })).not.toBeInTheDocument();
    expect(opened).not.toHaveBeenCalled();
  });
});

const funded = {
  businessId, currency: "INR" as const, refundedPaise: 0, mediaCostPaise: 0, taxCostPaise: 0, reservedPaise: 0, remainingPaise: 800000,
  held: false, reason: null, reservations: [],
};

describe("#1567: the Payments tab never shows AdBrain's split for a policy collection accepts", () => {
  const subject = { businessId, userId: "44444444-4444-4444-8444-444444444444" };
  const verificationEnv = { ...liveCollectionEnv, PAYMENTS_LIVE_VERIFICATION_ENABLED: "true",
    PAYMENTS_LIVE_VERIFICATION_BUSINESS_ID: subject.businessId, PAYMENTS_LIVE_VERIFICATION_USER_ID: subject.userId,
    PAYMENTS_LIVE_VERIFICATION_EXPIRES_AT: new Date(policyAt + 3_600_000).toISOString(), PAYMENTS_LIVE_VERIFICATION_AMOUNT_PAISE: "1000" };

  it.each([
    ["annual service", () => serverPolicy(liveCollectionEnv, policyAt)],
    ["checkout verification", () => serverPolicy(verificationEnv, policyAt, subject)],
  ])("%s: terms are shown in full, with no split", async (_name, build) => {
    const policy = build();
    fetchMock.mockImplementation(async (path: string) => Response.json(path.includes("orders?") ? { policy, orders: [] } : {}));
    render(<ProductionCheckout businessId={businessId} />);
    await screen.findByText("Ready for payment");
    expect(screen.getByText(policy.serviceScope)).toBeInTheDocument();
    expect(screen.getByText(policy.refundTerms)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(SPLIT_WORDS);
  });

  it("control: the retired v1 terms name the split, so the same check would catch them", () => {
    expect(`${OPERATOR_MANAGED_POLICY.serviceScope} ${OPERATOR_MANAGED_POLICY.refundTerms}`).toMatch(SPLIT_WORDS);
  });
});

describe("managed billing settings", () => {
  // #759: only where AdBrain holds ad money (managed) is there anything to pay; own-account owners pay Meta.
  it.each(["own", "operator", null] as const)("a %s business sees no Pay, Ad money or balance anywhere", (mode) => {
    render(<BillingSection mode={mode} connection={connected} testBusinessId={businessId} liveBusinessId={businessId} />);
    expect(screen.queryByRole("button", { name: /pay/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ad money|Pay any amount|Managed billing/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("customer-balance")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    if (mode === "own") expect(screen.getByText("You pay Meta directly from your ad account. Your first month of AdBrain is free; after that it's ₹999 a month.")).toBeInTheDocument();
  });

  it("a managed business keeps the live checkout and allowance", () => {
    fetchMock.mockResolvedValue(Response.json({ policy: null, orders: [] }));
    render(<BillingSection mode="managed" connection={connected} liveBusinessId={businessId} billingTab="budget" />);
    expect(screen.getByTestId("customer-balance")).toHaveAttribute("data-business-id", businessId);
  });

  it("shows the live business's checkout and allowance, updating both when the business changes", async () => {
    const otherBusinessId = "33333333-3333-4333-8333-333333333333";
    fetchMock.mockResolvedValue(Response.json({ policy: null, orders: [] }));
    const view = render(<ManagedBilling connection={connected} testBusinessId={businessId} liveBusinessId={otherBusinessId} billingTab="budget" />);
    expect(screen.getByTestId("customer-balance")).toHaveAttribute("data-business-id", otherBusinessId);
    fireEvent.click(screen.getByRole("tab", { name: "Payments" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.includes(`businessId=${otherBusinessId}`))).toBe(true));
    expect(screen.queryByRole("region", { name: "Razorpay test checkout" })).not.toBeInTheDocument();

    view.rerender(<ManagedBilling connection={connected} testBusinessId={businessId} liveBusinessId={businessId} billingTab="budget" />);
    expect(screen.getByTestId("customer-balance")).toHaveAttribute("data-business-id", businessId);
    fireEvent.click(screen.getByRole("tab", { name: "Payments" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => path.includes(`businessId=${businessId}`))).toBe(true));

    view.rerender(<ManagedBilling connection={connected} />);
    expect(screen.queryByTestId("customer-balance")).not.toBeInTheDocument();
  });

  // #1358 (CEO rule): a payment amount never appears on the same screen as any budget figure.
  it("puts Ad budget and Payments on separate tabs, never both at once (#1358)", async () => {
    fetchMock.mockImplementation(async (path: string) => path.includes("customer-balance")
      ? Response.json({ balance: funded }) : Response.json({ policy: null, orders: [] }));
    render(<ManagedBilling connection={connected} liveBusinessId={businessId} initialBalance={funded} />);
    expect(screen.getByRole("tab", { name: "Ad budget" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("customer-balance")).toBeInTheDocument();
    expect(screen.queryByText(/Pay any amount|Amount to pay|Payment reference/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    expect(screen.getByRole("tab", { name: "Payments" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("customer-balance")).not.toBeInTheDocument();
    expect(screen.queryByText(/Available|Spent|Held|₹8,000/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Ad budget" }));
    expect(screen.getByTestId("customer-balance")).toBeInTheDocument();
    expect(screen.queryByText(/Pay any amount|Amount to pay|Payment reference/)).not.toBeInTheDocument();
  });

  it.each([
    [null, undefined, "payments"], [{ ...funded, remainingPaise: 0, reservedPaise: 0, mediaCostPaise: 0, taxCostPaise: 0, refundedPaise: 0 }, undefined, "payments"],
    [funded, undefined, "budget"], [funded, "payments", "payments"], [null, "budget", "budget"], [funded, "junk", "budget"],
  ] as const)("opens on the right tab (#1358) %#", (balance, requested, expected) => {
    expect(initialBillingTab(balance, requested)).toBe(expected);
  });

  it("renders checkout only when supplied a server-authorized test business", () => {
    render(<ManagedBilling connection={connected} testBusinessId={businessId} />);
    expect(screen.getByRole("region", { name: "Razorpay test checkout" })).toBeInTheDocument();
  });
  it("shows the offer without AdBrain's split or an enabled payment product (#1235)", () => {
    render(<ManagedBilling connection={connected} />);
    expect(screen.getByRole("region", { name: "Managed billing" })).toBeInTheDocument();
    expect(screen.getByText("Not enabled")).toBeInTheDocument();
    expect(screen.getByText(/Your ad budget pays for Meta's ads and GST; AdBrain makes and runs the ads\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b(80|20)\s?%|service (fee|allocation)|allocation|margin/i);
    expect(screen.getByText("Current operator")).toBeInTheDocument();
    expect(screen.getByText("Vanshul Goyal")).toBeInTheDocument();
    expect(screen.getByText("Operator-managed")).toBeInTheDocument();
    expect(screen.queryByText("Solaride Energy")).not.toBeInTheDocument();
    expect(screen.getByText("act_123")).toBeInTheDocument();
    expect(screen.queryByText("Funding verification")).not.toBeInTheDocument();
    expect(screen.getByText(/The operator pays Meta separately/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each([
    [null, "Temporarily unavailable"],
    [{ ...connected, ready: false, expired: true }, "Reconnect required"],
    [{ ...connected, ready: false, pending: true, adAccountId: null }, "Account selection required"],
    [{ ...connected, ready: false, adAccountId: null }, "Not connected"],
    [connected, "Connected"],
  ])("keeps operator-managed payment independent of connection state %j", (connection, label) => {
    render(<ManagedBilling connection={connection} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Operator-managed")).toBeInTheDocument();
    if (!connection) {
      expect(screen.getByText("Unavailable")).toBeInTheDocument();
      expect(screen.queryByText("Not selected")).not.toBeInTheDocument();
    } else if (!connection.adAccountId) {
      expect(screen.getByText("Not selected")).toBeInTheDocument();
    }
  });

  it("shows the approved refund boundary without a funding-setup or payment action", () => {
    render(<ManagedBilling connection={connected} />);
    expect(screen.getByText(/your unused ad budget is refundable once pending Meta costs are settled/)).toBeInTheDocument();
    expect(screen.queryByText("Funding options")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});