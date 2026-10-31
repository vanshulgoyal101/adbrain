// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagedOnboardingLive } from "@/components/managed/managed-onboarding-live";
import { ONBOARDING_CONNECT_KEY } from "@/lib/managed/onboarding-connect";

const m = vi.hoisted(() => ({ start: vi.fn(), continueInTab: vi.fn() }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => ({ start: m.start }) }));
vi.mock("@/lib/meta-connect-ui/navigate", () => ({ continueInTab: m.continueInTab }));
vi.mock("@/components/managed-page-step", () => ({ ManagedPageStep: ({ attemptId }: { attemptId: string }) => <p>Page step for {attemptId}</p> }));

const businessId = "11111111-1111-4111-8111-111111111111";
const attemptId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, data: { row: null, paid: true } })));
});

describe("<ManagedOnboardingLive> (#526)", () => {
  it("polls progress through the shared rule: waits out a 429 and stops once signed out (#1541)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const statuses = [429, 401];
    const fetcher = vi.fn(async () => new Response(null, { status: statuses.shift() ?? 200, headers: { "Retry-After": "60" } }));
    vi.stubGlobal("fetch", fetcher);
    try {
      render(<ManagedOnboardingLive businessId={businessId} initialAttemptId={null} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
      expect(fetcher).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      expect(fetcher).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts Facebook sign-in for the Page step and mounts the Page step with the attempt it returns", async () => {
    const popup = { location: { href: "" }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(popup);
    m.start.mockResolvedValue({ attemptId, authorizationUrl: "https://www.facebook.com/dialog/oauth", expiresAt: "2099-01-01T00:00:00.000Z" });
    render(<ManagedOnboardingLive businessId={businessId} initialAttemptId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Facebook" }));
    await waitFor(() => expect(popup.location.href).toBe("https://www.facebook.com/dialog/oauth"));
    expect(Number(sessionStorage.getItem(ONBOARDING_CONNECT_KEY))).toBeGreaterThan(0);
    expect(m.start).toHaveBeenCalledWith(businessId, { kind: "setup" });
    act(() => { window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: popup, data: { type: "adbrain.meta.complete", attemptId } })); });
    expect(await screen.findByText(`Page step for ${attemptId}`)).toBeInTheDocument();
    // The onboarding tab's own copy of the flag is gone, so a later ordinary Connect here isn't redirected.
    expect(sessionStorage.getItem(ONBOARDING_CONNECT_KEY)).toBeNull();
  });

  it("offers 'Continue in this tab' when the popup never shows (#474)", async () => {
    const popup = { location: { href: "" }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(popup);
    m.start.mockResolvedValue({ attemptId, authorizationUrl: "https://www.facebook.com/dialog/oauth", expiresAt: "2099-01-01T00:00:00.000Z" });
    render(<ManagedOnboardingLive businessId={businessId} initialAttemptId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Facebook" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue in this tab" }, { timeout: 5000 }));
    expect(popup.close).toHaveBeenCalled();
    expect(m.continueInTab).toHaveBeenCalledWith("https://www.facebook.com/dialog/oauth");
  }, 10_000);

  it("clears the flag when the owner leaves onboarding", async () => {
    sessionStorage.setItem(ONBOARDING_CONNECT_KEY, String(Date.now()));
    const view = render(<ManagedOnboardingLive businessId={businessId} initialAttemptId={null} />);
    await screen.findByRole("button", { name: "Sign in with Facebook" });
    view.unmount();
    expect(sessionStorage.getItem(ONBOARDING_CONNECT_KEY)).toBeNull();
  });

  it("ignores a completion message from any other window", async () => {
    render(<ManagedOnboardingLive businessId={businessId} initialAttemptId={null} />);
    await screen.findByRole("button", { name: "Sign in with Facebook" });
    act(() => { window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: window, data: { type: "adbrain.meta.complete", attemptId } })); });
    expect(screen.queryByText(`Page step for ${attemptId}`)).toBeNull();
  });

  it("checks the Page's WhatsApp and says what to do next (#524)", async () => {
    let whatsapp: unknown = { status: "not_linked" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url === "/api/managed/whatsapp"
      ? { ok: true, data: whatsapp }
      : { ok: true, data: { row: { state: "page_linked", funding_state: "none", page_id: "1", child_business_id: null, ad_account_id: null, waba_id: null, phone_number_id: null, last_error: null }, paid: true } })));
    render(<ManagedOnboardingLive businessId={businessId} initialAttemptId={null} />);
    expect(await screen.findByRole("link", { name: /WhatsApp settings on Facebook/ })).toHaveAttribute("target", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("status")).toHaveTextContent("We don't see a WhatsApp number on your Page yet");
    whatsapp = { status: "taken" };
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already used by another AdBrain business");
    whatsapp = { status: "linked", masked: "+91 ••••• 0874" };
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Linked: +91 ••••• 0874")).toBeInTheDocument();
  });

  it("invites the card holder and reads the card from Meta, never on a click alone (#2359)", async () => {
    let billing: unknown = { status: "invited" };
    const fetchMock = vi.fn(async (url: string) => Response.json(url === "/api/managed/billing"
      ? { ok: true, data: billing }
      : { ok: true, data: { row: { state: "ad_account_created", funding_state: "none", page_id: "1", child_business_id: "2", ad_account_id: "act_3", whatsapp_number_e164: "+919999990874", waba_id: null, phone_number_id: null, last_error: null }, paid: true } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ManagedOnboardingLive businessId={businessId} initialAttemptId={null} />);
    fireEvent.change(await screen.findByLabelText("Email of the person who'll add the card"), { target: { value: "owner@example.in" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Invite sent");
    expect(JSON.parse(fetchMock.mock.calls.find(([url]) => url === "/api/managed/billing")![1].body)).toEqual({ action: "invite", businessId, email: "owner@example.in" });
    billing = { status: "not_funded", reason: "NO_PAYMENT_METHOD", payer: "invited" };
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText(/Waiting for your person to accept/)).toBeInTheDocument();
    billing = { status: "not_funded", reason: "ACCOUNT_DISABLED", payer: "joined" };
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disabled this ad account");
    billing = { status: "funded" };
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Card added. Your ad account can run ads.")).toBeInTheDocument();
  });

  it("opens the Page step directly when it returns from a same-tab sign-in", async () => {
    render(<ManagedOnboardingLive businessId={businessId} initialAttemptId={attemptId} />);
    expect(await screen.findByText(`Page step for ${attemptId}`)).toBeInTheDocument();
  });
});
