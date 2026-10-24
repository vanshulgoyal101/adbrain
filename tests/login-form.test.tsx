// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";
import LoginPage from "@/app/login/page";

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

let phoneViewport = false;

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  phoneViewport = false;
  window.matchMedia = ((query: string) => ({ matches: phoneViewport, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
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
  it("keeps home and legal navigation available around sign in", () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: "Create your free account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AdBrain home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Skip to sign in" })).toHaveAttribute("href", "#sign-in");
    for (const [name, href] of [["Privacy", "/privacy"], ["Terms", "/terms"], ["Data deletion", "/data-deletion"]]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

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

  it("returns from email confirmation with the address and destination intact", async () => {
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("owner@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByLabelText("Email")).toHaveValue("owner@example.test");
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(mocks.signInWithOtp).toHaveBeenCalledOnce();
    const callback = new URL(mocks.signInWithOtp.mock.calls[0][0].options.emailRedirectTo);
    expect(callback.searchParams.get("redirect")).toBe("/studio?view=drafts");
  });

  it("validates email without requiring a password for a magic link", async () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Check your email");
  });

  it("toggles password visibility without submitting or changing it", () => {
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Password")).toHaveValue("test-password");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("new and returning visitors", () => {
  it("leads a new visitor with a sign-in link and keeps the password one tap away", async () => {
    render(<LoginForm newVisitor />);
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } });
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(mocks.signInWithOtp).toHaveBeenCalledOnce();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("reveals and focuses the password field for a new visitor who has one", () => {
    render(<LoginForm newVisitor />);
    fireEvent.click(screen.getByRole("button", { name: "I have a password" }));
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Sign in with password" })).toBeInTheDocument();
  });

  it("does not mark a visitor as returning when sign-in fails", async () => {
    mocks.signInWithOtp.mockResolvedValue({ error: { message: "Rate limited" } });
    render(<LoginForm newVisitor />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Rate limited");
    expect(localStorage.getItem("adbrain:returning-visitor")).toBeNull();
  });

  it("welcomes back a visitor who signed in before, and either view can switch", async () => {
    render(<LoginForm newVisitor />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    await screen.findByText("Check your email");
    expect(localStorage.getItem("adbrain:returning-visitor")).toBe("1");
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create a free account" }));
    expect(screen.getByRole("heading", { name: "Create your free account" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("keeps a new visitor on the create-account view after their link is sent", async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByText(/finish creating your account/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create your free account" })).toBeInTheDocument();
    expect(localStorage.getItem("adbrain:returning-visitor")).toBe("1");
  });

  it("makes the page behind the phone intro inert until it closes", () => {
    phoneViewport = true;
    const { container } = render(<LoginPage />);
    expect(container.inert).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    expect(container.inert).toBe(false);
  });

  it("shows the phone intro once, and Skip returns to the form", () => {
    phoneViewport = true;
    const first = render(<LoginPage />);
    expect(screen.getByRole("dialog", { name: "From your business to WhatsApp chats" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip/ })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Email")).toHaveFocus();
    first.unmount();
    render(<LoginPage />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never covers the form for a returning visitor or on a laptop", () => {
    render(<LoginPage />);
    expect(screen.queryByRole("dialog")).toBeNull();
    phoneViewport = true;
    localStorage.setItem("adbrain:returning-visitor", "1");
    localStorage.setItem("adbrain:login-intro-seen", "1");
    act(() => { window.dispatchEvent(new StorageEvent("storage")); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

