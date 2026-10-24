// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";
import LoginPage from "@/app/login/page";

const mocks = vi.hoisted(() => ({
  redirect: "/studio?view=drafts",
  replace: vi.fn(), refresh: vi.fn(), open: vi.fn(),
  signInWithOtp: vi.fn(), signInWithOAuth: vi.fn(), signInWithPassword: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ redirect: mocks.redirect }),
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/lib/auth-redirect", async original => ({
  ...await original<typeof import("@/lib/auth-redirect")>(),
  openAfterSignIn: mocks.open,
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

describe("sign-in outcomes reach the server without the email (#451 L4)", () => {
  const beacons = () => vi.mocked(fetch).mock.calls
    .filter(([url]) => url === "/api/auth/outcome")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 }))); });

  it("reports a failed and then a successful password sign-in", async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ error: Object.assign(new Error("Invalid login credentials"), { code: "invalid_credentials" }) });
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalled());
    expect(beacons()).toEqual([{ method: "password", outcome: "failed", code: "invalid_credentials" }, { method: "password", outcome: "success" }]);
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain("owner@example.test");
  });

  it("reports a sign-in link that could not be sent, with an unknown code as 'other'", async () => {
    mocks.signInWithOtp.mockResolvedValueOnce({ error: Object.assign(new Error("Email rate limit exceeded"), { code: "over_email_send_rate_limit" }) });
    render(<LoginForm newVisitor />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.test" } });
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
    await screen.findByRole("alert");
    mocks.signInWithOAuth.mockResolvedValueOnce({ error: Object.assign(new Error("odd"), { code: "something_new" }) });
    fireEvent.click(screen.getByRole("button", { name: /Google/ }));
    await waitFor(() => expect(beacons()).toHaveLength(2));
    expect(beacons()).toEqual([{ method: "email_link", outcome: "failed", code: "over_email_send_rate_limit" }, { method: "google", outcome: "failed", code: "other" }]);
  });
});

describe("login completion and recovery", () => {
  it("keeps home and legal navigation available around sign in", async () => {
    render(await LoginPage({}));
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
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith("/dashboard"));
  });

  it("opens a local password destination with a full page load (#458)", async () => {
    fillLogin();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with password" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith("/studio?view=drafts"));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Signing in..." })).toBeDisabled();
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
    expect(mocks.open).not.toHaveBeenCalled();
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
    await waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
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

  it("toggles password visibility without submitting or changing it", async () => {
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

  it("reveals and focuses the password field for a new visitor who has one", async () => {
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
    render(await LoginPage({}));
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create a free account" }));
    expect(screen.getByRole("heading", { name: "Create your free account" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("keeps a new visitor on the create-account view after their link is sent", async () => {
    render(await LoginPage({}));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByText(/finish creating your account/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create your free account" })).toBeInTheDocument();
    expect(localStorage.getItem("adbrain:returning-visitor")).toBe("1");
  });

  it("makes the page behind the phone intro inert until it closes", async () => {
    phoneViewport = true;
    const { container } = render(await LoginPage({}));
    expect(container.inert).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    expect(container.inert).toBe(false);
  });

  it("shows the phone intro once, and Skip returns to the form", async () => {
    phoneViewport = true;
    const first = render(await LoginPage({}));
    expect(screen.getByRole("dialog", { name: "From your business to WhatsApp chats" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip/ })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /Skip/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Email")).toHaveFocus();
    first.unmount();
    render(await LoginPage({}));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never covers the form for a returning visitor or on a laptop", async () => {
    render(await LoginPage({}));
    expect(screen.queryByRole("dialog")).toBeNull();
    phoneViewport = true;
    localStorage.setItem("adbrain:returning-visitor", "1");
    localStorage.setItem("adbrain:login-intro-seen", "1");
    act(() => { window.dispatchEvent(new StorageEvent("storage")); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens in sign-in mode without the intro when sent from an app page", async () => {
    phoneViewport = true;
    render(await LoginPage({ searchParams: Promise.resolve({ redirect: "/campaigns" }) }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("treats an unsafe or missing redirect as a new visitor", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ redirect: "//evil.example" }) }));
    expect(screen.getByRole("heading", { name: "Create your free account" })).toBeInTheDocument();
  });

  it("keeps the create-account view for a gallery visitor sent here from /create", async () => {
    localStorage.setItem("adbrain:pending-idea-goal", "Get WhatsApp chats");
    render(await LoginPage({ searchParams: Promise.resolve({ redirect: "/create" }) }));
    expect(screen.getByRole("heading", { name: "Create your free account" })).toBeInTheDocument();
  });
});
