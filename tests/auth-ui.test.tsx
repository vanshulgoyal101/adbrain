// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";
import { SignOutButton } from "@/components/sign-out-button";

const signInWithOtp = vi.fn();
const signInWithOAuth = vi.fn();
const signInWithPassword = vi.fn();
const signOut = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push, refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signInWithOtp, signInWithOAuth, signInWithPassword, signOut },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  params = new URLSearchParams();
  delete process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS;
  signInWithOtp.mockResolvedValue({ error: null });
  signInWithOAuth.mockResolvedValue({ error: null });
  signInWithPassword.mockResolvedValue({ error: null });
  signOut.mockResolvedValue({ error: null });
});

describe("<LoginForm> magic link", () => {
  it("sends a magic link back to the auth callback", async () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send magic link/i }));

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledOnce());
    const arg = signInWithOtp.mock.calls[0][0];
    expect(arg.email).toBe("owner@example.com");
    expect(arg.options.emailRedirectTo).toContain("/auth/callback?redirect=");
  });

  it("confirms the email was sent instead of leaving the form", async () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send magic link/i }));

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
  });

  it("shows the provider's error and lets the user retry", async () => {
    signInWithOtp.mockResolvedValue({ error: { message: "Rate limit exceeded" } });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "o@x.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send magic link/i }));

    expect(await screen.findByText("Rate limit exceeded")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send magic link/i }),
    ).toBeEnabled();
  });

  it("carries the requested page through the login round-trip", async () => {
    params = new URLSearchParams("redirect=%2Fsettings");
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "o@x.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send magic link/i }));

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledOnce());
    expect(signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toContain(
      encodeURIComponent("/settings"),
    );
  });
});

describe("<LoginForm> password", () => {
  const fillCredentials = () => {
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "hunter2" },
    });
  };

  it("keeps the button disabled until both fields are filled", () => {
    render(<LoginForm />);
    const submit = screen.getByRole("button", { name: /sign in with password/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "hunter2" },
    });
    expect(submit).toBeEnabled();
  });

  it("signs in with the entered credentials", async () => {
    render(<LoginForm />);
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /sign in with password/i }));

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledOnce());
    expect(signInWithPassword.mock.calls[0][0]).toEqual({
      email: "owner@example.com",
      password: "hunter2",
    });
  });

  it("reports bad credentials without navigating", async () => {
    signInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    render(<LoginForm />);
    fillCredentials();
    fireEvent.click(screen.getByRole("button", { name: /sign in with password/i }));

    expect(
      await screen.findByText("Invalid login credentials"),
    ).toBeInTheDocument();
  });
});

describe("<LoginForm> Google", () => {
  it("starts the OAuth flow with a callback redirect", async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: /google/i }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledOnce());
    expect(signInWithOAuth.mock.calls[0][0]).toMatchObject({ provider: "google" });
  });

  it("surfaces a provider misconfiguration", async () => {
    signInWithOAuth.mockResolvedValue({
      error: { message: "Unsupported provider: provider is not enabled" },
    });
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: /google/i }));

    expect(
      await screen.findByText(/provider is not enabled/i),
    ).toBeInTheDocument();
  });
});

describe("<LoginForm> failed callback", () => {
  it("explains when the provider bounced the user back with an error", () => {
    params = new URLSearchParams("error=access_denied");
    render(<LoginForm />);
    expect(screen.getByText(/sign-in failed/i)).toBeInTheDocument();
  });
});

describe("<LoginForm> dev bypass", () => {
  it("stays hidden by default", () => {
    render(<LoginForm />);
    expect(screen.queryByRole("link", { name: /dev mode/i })).toBeNull();
  });

  it("appears only when the bypass is enabled", () => {
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = "true";
    render(<LoginForm />);
    expect(screen.getByRole("link", { name: /dev mode/i })).toHaveAttribute(
      "href",
      "/auth/dev-login",
    );
  });
});

describe("<SignOutButton>", () => {
  it("signs out and returns to login", async () => {
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(refresh).toHaveBeenCalled();
  });

  it("clears the httpOnly dev cookie server-side when the bypass is on", async () => {
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = "true";
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    // Router push would leave the cookie behind, so it must not be used here.
    expect(push).not.toHaveBeenCalled();
  });
});
