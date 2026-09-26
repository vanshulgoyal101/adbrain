// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagedBilling } from "@/components/managed-billing";
import { META_FUNDING_METHODS } from "@/lib/payments/meta-funding";
import { TestCheckout, type TestCheckoutOptions } from "@/components/test-checkout";

vi.mock("next/script", () => ({ default: ({ onReady, onError }: { onReady: () => void; onError: () => void }) =>
  <img alt="" data-testid="checkout-script" onLoad={onReady} onError={onError} /> }));

const connected = { adAccountId: "act_123", ready: true, expired: false, pending: false };

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
  await waitFor(() => expect(screen.getByRole("button", { name: "Pay INR 10,000 (test)" })).toBeEnabled());
  return rendered;
}

describe("test checkout", () => {
  it("opens only a server-defined test order and verifies callback capture", async () => {
    await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay INR 10,000 (test)" }));
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
    expect(screen.getByText("INR 0")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Pay INR 10,000 (test)" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    act(() => options.modal.ondismiss());
    expect(screen.getByText(/Checkout closed/)).toBeInTheDocument();
    view.unmount();
    render(<TestCheckout businessId={businessId} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain(`orderId=${orderId}`);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Pay INR/ })).not.toBeInTheDocument();
  });

  it("recovers a callback after verification disconnects and the page reloads", async () => {
    const view = await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay INR 10,000 (test)" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Pay INR 10,000 (test)" }));
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
    expect(screen.queryByRole("button", { name: /Pay INR/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not use a different business's stored payment", async () => {
    sessionStorage.setItem("adbrain:test-checkout:other-business", JSON.stringify({ version: 1, idempotencyKey: orderId, orderId, opened: true }));
    await mountCheckout();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores callbacks after unmount", async () => {
    const view = await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay INR 10,000 (test)" }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    view.unmount();
    options.handler({ razorpay_order_id: "order_fixture", razorpay_payment_id: "pay_fixture", razorpay_signature: "a".repeat(64) });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the same key after an interrupted create", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network disconnected"));
    await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay INR 10,000 (test)" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Pay INR 10,000 (test)" }));
    await screen.findByText(/Checkout could not be opened/);
    expect(opened).not.toHaveBeenCalled();
  });

  it("does not call the API when recovery storage cannot be written", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    await mountCheckout();
    fireEvent.click(screen.getByRole("button", { name: "Pay INR 10,000 (test)" }));
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

describe("managed billing settings", () => {
  it("renders checkout only when supplied a server-authorized test business", () => {
    render(<ManagedBilling connection={connected} testBusinessId={businessId} />);
    expect(screen.getByRole("region", { name: "Razorpay test checkout" })).toBeInTheDocument();
  });
  it("shows planned economics without presenting an enabled payment product", () => {
    render(<ManagedBilling connection={connected} />);
    expect(screen.getByRole("region", { name: "Managed billing" })).toBeInTheDocument();
    expect(screen.getByText("Not enabled")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("Current operator")).toBeInTheDocument();
    expect(screen.getByText("Vanshul Goyal")).toBeInTheDocument();
    expect(screen.getByText("Future account ownership")).toBeInTheDocument();
    expect(screen.getByText("Solaride arrangement not yet formalized")).toBeInTheDocument();
    expect(screen.queryByText("Solaride Energy")).not.toBeInTheDocument();
    expect(screen.getByText("act_123")).toBeInTheDocument();
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    expect(screen.getByText(/No funding method selected/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each([
    [null, "Temporarily unavailable"],
    [{ ...connected, ready: false, expired: true }, "Reconnect required"],
    [{ ...connected, ready: false, pending: true, adAccountId: null }, "Account selection required"],
    [{ ...connected, ready: false, adAccountId: null }, "Not connected"],
    [connected, "Connected"],
  ])("keeps funding unverified for connection state %j", (connection, label) => {
    render(<ManagedBilling connection={connection} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    if (!connection) {
      expect(screen.getByText("Unavailable")).toBeInTheDocument();
      expect(screen.queryByText("Not selected")).not.toBeInTheDocument();
    } else if (!connection.adAccountId) {
      expect(screen.getByText("Not selected")).toBeInTheDocument();
    }
  });

  it("uses official requirements links without exposing a payment execution action", () => {
    const { container } = render(<ManagedBilling connection={connected} />);
    const options = container.querySelectorAll("details");
    expect(options).toHaveLength(3);
    for (const option of options) option.open = true;
    for (const method of META_FUNDING_METHODS) {
      const link = screen.getByRole("link", { name: `Meta requirements for ${method.name}` });
      expect(link).toHaveAttribute("href", method.documentationUrl);
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(screen.getByText(/Prepaid accounts have no Meta account spending limit/)).toBeInTheDocument();
    expect(screen.getByText(/do not transfer exactly 80%/)).toBeInTheDocument();
  });
});