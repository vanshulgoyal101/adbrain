// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

const mocks = vi.hoisted(() => ({
  redirect: "/studio?view=drafts",
  replace: vi.fn(), refresh: vi.fn(),
  signInWithOtp: vi.fn(), signInWithOAuth: vi.fn(), signInWithPassword: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ redirect: mocks.redirect }),
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: mocks }) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect = "/studio?view=drafts";
  mocks.signInWithOtp.mockResolvedValue({ error: null });
  mocks.signInWithOAuth.mockResolvedValue({ error: null });
  mocks.signInWithPassword.mockResolvedValue({ error: null });
});

function fillLogin() {
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
}

describe("login completion and recovery", () => {
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/\n/evil.example"])("rejects unsafe password destination %s", async redirect => {
    mocks.redirect = redirect;
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("retains a local password destination and refreshes authenticated data", async () => {
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/studio?view=drafts"));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ["signInWithOtp", "Send magic link"],
    ["signInWithOAuth", "Continue with Google"],
    ["signInWithPassword", "Sign in with password"],
  ] as const)("recovers from a rejected %s request", async (method, label) => {
    mocks[method].mockRejectedValue(new Error("Network unavailable"));
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    expect(screen.getByRole("button", { name: label })).toBeEnabled();
    expect(mocks.replace).not.toHaveBeenCalled();
    mocks[method].mockResolvedValue({ error: null });
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(mocks[method]).toHaveBeenCalledTimes(2));
  });

  it("disables competing sign-in methods while a request is pending", async () => {
    let finish!: (result: { error: null }) => void;
    mocks.signInWithPassword.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    expect(screen.getByRole("button", { name: "Signing in..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send magic link" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
    finish({ error: null });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce());
  });

  it("sanitizes the email callback destination and displays confirmation", async () => {
    mocks.redirect = "//evil.example";
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    const callback = new URL(mocks.signInWithOtp.mock.calls[0][0].options.emailRedirectTo);
    expect(callback.searchParams.get("redirect")).toBe("/dashboard");
  });
});