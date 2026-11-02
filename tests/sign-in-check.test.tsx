// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

// #2570 (#1777): Supabase Auth CAPTCHA on every email and password request, off until its site key is set.
const mocks = vi.hoisted(() => ({
  error: null as string | null, open: vi.fn(), resets: 0, issued: 0,
  signInWithOtp: vi.fn(), signInWithOAuth: vi.fn(), signInWithPassword: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ redirect: "/studio", ...(mocks.error ? { error: mocks.error } : {}) }),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-redirect", async original => ({ ...await original<typeof import("@/lib/auth-redirect")>(), openAfterSignIn: mocks.open }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: mocks }) }));
type WidgetProps = { siteKey: string; onSuccess: (token: string) => void; onExpire: () => void; onError: () => void };
vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: forwardRef(function FakeTurnstile(props: WidgetProps, ref) {
    useImperativeHandle(ref, () => ({ reset: () => { mocks.resets++; } }));
    return (
      <div data-testid="sign-in-check" data-sitekey={props.siteKey}>
        <button type="button" onClick={() => props.onSuccess(`token-${++mocks.issued}`)}>pass check</button>
        <button type="button" onClick={props.onExpire}>expire check</button>
        <button type="button" onClick={props.onError}>break check</button>
      </div>
    );
  }),
}));

const beacons = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/auth/outcome")
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
const rejected = { error: Object.assign(new Error("captcha protection: request disallowed (invalid-input-response)"), { code: "captcha_failed" }) };

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.error = null; mocks.resets = 0; mocks.issued = 0;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  mocks.signInWithOtp.mockResolvedValue({ error: null });
  mocks.signInWithOAuth.mockResolvedValue({ error: null });
  mocks.signInWithPassword.mockResolvedValue({ error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function fill(newVisitor = false) {
  render(<LoginForm newVisitor={newVisitor} />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.test" } });
  if (!newVisitor) fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
}

describe("sign-in check off (default): nothing changes (#2570)", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", ""));

  it("renders no check and sends password, link and Google requests exactly as before", async () => {
    fill();
    expect(screen.queryByTestId("sign-in-check")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalled());
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "owner@example.test", password: "test-password" });
    cleanup();

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));
    await screen.findByText("Check your email");
    expect(screen.queryByTestId("sign-in-check")).toBeNull();
    expect(Object.keys(mocks.signInWithOtp.mock.calls[0][0].options)).toEqual(["emailRedirectTo"]);
  });

  it("Google never needs the check", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    render(<LoginForm />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue with Google" })));
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: expect.stringContaining("via=google") } });
  });
});

describe("sign-in check on: every email and password request carries a fresh token (#2570)", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key"));

  it("a password sign-in waits for the check, then sends its token once", async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ error: Object.assign(new Error("Invalid login credentials"), { code: "invalid_credentials" }) });
    fill();
    expect(screen.getByTestId("sign-in-check")).toHaveAttribute("data-sitekey", "site-key");
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The security check isn't finished yet. Wait a moment, then try again.");
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "pass check" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(mocks.signInWithPassword).toHaveBeenLastCalledWith({ email: "owner@example.test", password: "test-password", options: { captchaToken: "token-1" } });
    expect(mocks.resets).toBe(1);

    // The used token is gone: a retry needs the check again, and then uses the new token.
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't finished yet");
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "pass check" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalled());
    expect(mocks.signInWithPassword).toHaveBeenLastCalledWith(expect.objectContaining({ options: { captchaToken: "token-2" } }));
    expect(beacons()).toEqual([
      { method: "password", outcome: "failed", code: "captcha_failed" },
      { method: "password", outcome: "failed", code: "invalid_credentials" },
      { method: "password", outcome: "failed", code: "captcha_failed" },
      { method: "password", outcome: "success" },
    ]);
  });

  it("an expired token is not sent, and a check that can't load points to Google", async () => {
    fill();
    fireEvent.click(screen.getByRole("button", { name: "pass check" }));
    fireEvent.click(screen.getByRole("button", { name: "expire check" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't finished yet");
    fireEvent.click(screen.getByRole("button", { name: "break check" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The security check couldn't load. Refresh the page, or continue with Google.");
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("a new visitor's sign-in link carries the token next to its callback, and a rejected token is worded", async () => {
    mocks.signInWithOtp.mockResolvedValueOnce(rejected);
    fill(true);
    fireEvent.click(screen.getByRole("button", { name: "pass check" }));
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The security check expired. Please try again.");
    expect(mocks.signInWithOtp).toHaveBeenLastCalledWith({ email: "owner@example.test",
      options: { emailRedirectTo: expect.stringContaining("via=email"), captchaToken: "token-1" } });
    expect(mocks.resets).toBe(1);
    expect(screen.getByLabelText("Email")).toHaveValue("owner@example.test");

    fireEvent.click(screen.getByRole("button", { name: "pass check" }));
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    await screen.findByText("Check your email");
    expect(mocks.signInWithOtp.mock.calls[1][0].options.captchaToken).toBe("token-2");
    expect(beacons()).toEqual([{ method: "email_link", outcome: "failed", code: "captcha_failed" }, { method: "email_link", outcome: "started" }]);
  });

  it("Send again on Check your email uses that screen's check; without it the form explains and keeps the address", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fill(true);
    fireEvent.click(screen.getByRole("button", { name: "pass check" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" })));
    expect(screen.getByText("Check your email")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-check")).toBeInTheDocument();
    for (let second = 0; second < 31; second++) await act(async () => { vi.advanceTimersByTime(1_000); });

    fireEvent.click(screen.getByRole("button", { name: "pass check" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send again" })));
    expect(mocks.signInWithOtp.mock.calls[1][0].options.captchaToken).toBe("token-2");
    expect(await screen.findByText("New link sent to owner@example.test.")).toBeInTheDocument();
    for (let second = 0; second < 31; second++) await act(async () => { vi.advanceTimersByTime(1_000); });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send again" })));
    expect(mocks.signInWithOtp).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent("isn't finished yet");
    expect(screen.getByLabelText("Email")).toHaveValue("owner@example.test");
  });

  it("an expired link's Send a new link uses the panel's check, or falls back to the filled-in form", async () => {
    localStorage.setItem("adbrain:sign-in-email", "owner@example.test");
    mocks.error = "link_expired";
    const { unmount } = render(<LoginForm />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send a new link" })));
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("isn't finished yet");
    expect(screen.getByLabelText("Email")).toHaveValue("owner@example.test");
    unmount();

    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "pass check" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send a new link" })));
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({ email: "owner@example.test",
      options: { emailRedirectTo: expect.any(String), captchaToken: "token-1" } });
    expect(await screen.findByText("New link sent to owner@example.test.")).toBeInTheDocument();
  });
});
