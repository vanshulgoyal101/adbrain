// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaConnectCompletion } from "@/components/meta-connect/meta-connect-completion";
import { ONBOARDING_CONNECT_KEY, ONBOARDING_CONNECT_MAX_AGE_MS, markOnboardingConnect, takeOnboardingConnect } from "@/lib/managed/onboarding-connect";
import type { AttemptDTO } from "@/lib/meta/connect-contracts";

vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => <p>Account picker</p> }));

const attempt = {
  attemptId: "22222222-2222-4222-8222-222222222222", businessId: "11111111-1111-4111-8111-111111111111", intent: { kind: "setup" },
  expiresAt: "2099-01-01T00:00:00.000Z", revision: 1, state: "selection_required", discoveryComplete: true, candidates: [], connection: null, blockers: [], retryAfterMs: null,
} as AttemptDTO;

const setOpener = (value: unknown) => Object.defineProperty(window, "opener", { value, configurable: true, writable: true });
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); setOpener(null); });

describe("onboarding's connect flag (#526, QA on #570)", () => {
  it("is only honoured while fresh, and is used up either way", () => {
    const now = 1_000_000_000;
    markOnboardingConnect(sessionStorage, now);
    expect(takeOnboardingConnect(sessionStorage, now + 60_000)).toBe(true);
    expect(sessionStorage.getItem(ONBOARDING_CONNECT_KEY)).toBeNull();
    markOnboardingConnect(sessionStorage, now);
    expect(takeOnboardingConnect(sessionStorage, now + ONBOARDING_CONNECT_MAX_AGE_MS)).toBe(false);
    sessionStorage.setItem(ONBOARDING_CONNECT_KEY, "1"); // the old boolean form
    expect(takeOnboardingConnect(sessionStorage, now)).toBe(false);
    expect(takeOnboardingConnect(sessionStorage, now)).toBe(false);
  });

  it("a completion page with a stale key behaves like an ordinary Connect", () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    setOpener({ postMessage: vi.fn() });
    markOnboardingConnect(sessionStorage, Date.now() - ONBOARDING_CONNECT_MAX_AGE_MS - 1);
    const view = render(<MetaConnectCompletion attempt={attempt} />);
    expect(close).not.toHaveBeenCalled();
    expect(view.getByText("Account picker")).toBeInTheDocument();
  });

  it("a fresh onboarding key closes the popup after handing back the attempt", () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const postMessage = vi.fn();
    setOpener({ postMessage });
    markOnboardingConnect(sessionStorage);
    render(<MetaConnectCompletion attempt={attempt} />);
    expect(postMessage).toHaveBeenCalledWith({ type: "adbrain.meta.complete", attemptId: attempt.attemptId }, window.location.origin);
    expect(close).toHaveBeenCalled();
  });
});
