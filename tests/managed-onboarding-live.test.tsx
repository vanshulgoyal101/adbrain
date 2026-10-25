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
  it("starts Facebook sign-in for the Page step and mounts the Page step with the attempt it returns", async () => {
    const popup = { location: { href: "" }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(popup);
    m.start.mockResolvedValue({ attemptId, authorizationUrl: "https://www.facebook.com/dialog/oauth", expiresAt: "2099-01-01T00:00:00.000Z" });
    render(<ManagedOnboardingLive businessId={businessId} initialAttemptId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Facebook" }));
    await waitFor(() => expect(popup.location.href).toBe("https://www.facebook.com/dialog/oauth"));
    expect(sessionStorage.getItem(ONBOARDING_CONNECT_KEY)).toBe("1");
    expect(m.start).toHaveBeenCalledWith(businessId, { kind: "setup" });
    act(() => { window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: popup, data: { type: "adbrain.meta.complete", attemptId } })); });
    expect(await screen.findByText(`Page step for ${attemptId}`)).toBeInTheDocument();
  });

  it("ignores a completion message from any other window", async () => {
    render(<ManagedOnboardingLive businessId={businessId} initialAttemptId={null} />);
    await screen.findByRole("button", { name: "Sign in with Facebook" });
    act(() => { window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: window, data: { type: "adbrain.meta.complete", attemptId } })); });
    expect(screen.queryByText(`Page step for ${attemptId}`)).toBeNull();
  });

  it("opens the Page step directly when it returns from a same-tab sign-in", async () => {
    render(<ManagedOnboardingLive businessId={businessId} initialAttemptId={attemptId} />);
    expect(await screen.findByText(`Page step for ${attemptId}`)).toBeInTheDocument();
  });
});
