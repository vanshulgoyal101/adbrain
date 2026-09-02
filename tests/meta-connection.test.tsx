// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetaConnectionPanel } from "@/components/meta-connection";
import type { MetaConnection } from "@/lib/meta/credentials";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const connection = (over: Partial<MetaConnection> = {}): MetaConnection => ({
  source: "none",
  pending: false,
  ready: false,
  adAccountId: null,
  pageId: null,
  tokenExpiresAt: null,
  expired: false,
  scopes: [],
  ...over,
});

const OAUTH_READY = connection({
  source: "oauth",
  ready: true,
  adAccountId: "act_123",
  pageId: "page_456",
});

const ACCOUNTS = {
  adAccounts: [
    { id: "act_123", accountId: "123", name: "Solaride Ads", currency: "INR", disabled: false },
    { id: "act_999", accountId: "999", name: "Closed Account", disabled: true },
  ],
  pages: [{ id: "page_456", name: "Solaride" }],
};

const okFetch = () =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ACCOUNTS });

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = okFetch() as unknown as typeof fetch;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("<MetaConnectionPanel> not connected", () => {
  it("invites the owner to connect when OAuth is available", () => {
    render(<MetaConnectionPanel connection={connection()} oauthConfigured />);
    expect(
      screen.getByRole("link", { name: /connect with facebook/i }),
    ).toHaveAttribute("href", "/api/meta/oauth/start");
  });

  it("explains when the server has no Facebook app configured", () => {
    render(
      <MetaConnectionPanel connection={connection()} oauthConfigured={false} />,
    );
    expect(screen.queryByRole("link", { name: /connect with facebook/i })).toBeNull();
    expect(screen.getByText(/isn't configured on this server/i)).toBeInTheDocument();
  });

  it("does not offer disconnect when there is nothing to disconnect", () => {
    render(<MetaConnectionPanel connection={connection()} oauthConfigured />);
    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
  });
});

describe("<MetaConnectionPanel> single-tenant env credentials", () => {
  it("shows the server-configured account and offers no disconnect", () => {
    render(
      <MetaConnectionPanel
        connection={connection({ source: "env", ready: true, adAccountId: "act_env" })}
        oauthConfigured
      />,
    );
    expect(screen.getByText(/server credentials/i)).toBeInTheDocument();
    expect(screen.getByText("act_env")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
  });
});

describe("<MetaConnectionPanel> expired token", () => {
  it("asks the owner to reconnect and skips loading accounts", () => {
    render(
      <MetaConnectionPanel
        connection={connection({ source: "oauth", expired: true, ready: false })}
        oauthConfigured
      />,
    );
    expect(screen.getByText(/login has expired/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /reconnect/i })).toHaveAttribute(
      "href",
      "/api/meta/oauth/start",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("<MetaConnectionPanel> selecting an account", () => {
  it("loads the owner's ad accounts and pages on mount", async () => {
    render(
      <MetaConnectionPanel
        connection={connection({ source: "oauth", pending: true })}
        oauthConfigured
      />,
    );
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/meta/accounts"),
    );
    expect(await screen.findByText(/almost there/i)).toBeInTheDocument();
    expect(
      await screen.findByRole("option", { name: /Solaride Ads/ }),
    ).toBeInTheDocument();
  });

  it("marks unavailable ad accounts as unselectable", async () => {
    render(
      <MetaConnectionPanel
        connection={connection({ source: "oauth", pending: true })}
        oauthConfigured
      />,
    );
    const closed = await screen.findByRole("option", { name: /Closed Account/ });
    expect(closed).toBeDisabled();
  });

  it("requires both selections before saving", async () => {
    render(
      <MetaConnectionPanel
        connection={connection({ source: "oauth", pending: true })}
        oauthConfigured
      />,
    );
    const save = await screen.findByRole("button", { name: /save connection/i });
    expect(save).toBeDisabled();
  });

  it("saves the chosen pair and refreshes", async () => {
    render(
      <MetaConnectionPanel
        connection={connection({ source: "oauth", pending: true })}
        oauthConfigured
      />,
    );
    const [accountSelect, pageSelect] = await screen.findAllByRole("combobox");
    fireEvent.change(accountSelect, { target: { value: "act_123" } });
    fireEvent.change(pageSelect, { target: { value: "page_456" } });

    fireEvent.click(screen.getByRole("button", { name: /save connection/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/meta/connect",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => u === "/api/meta/connect",
    )!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      adAccountId: "act_123",
      pageId: "page_456",
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the server's reason when saving is rejected", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ACCOUNTS })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "That ad account isn't available on this login." }),
      }) as unknown as typeof fetch;

    render(
      <MetaConnectionPanel
        connection={connection({ source: "oauth", pending: true })}
        oauthConfigured
      />,
    );
    const [accountSelect, pageSelect] = await screen.findAllByRole("combobox");
    fireEvent.change(accountSelect, { target: { value: "act_123" } });
    fireEvent.change(pageSelect, { target: { value: "page_456" } });
    fireEvent.click(screen.getByRole("button", { name: /save connection/i }));

    expect(
      await screen.findByText("That ad account isn't available on this login."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a failure to load accounts", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Not connected" }),
    }) as unknown as typeof fetch;

    render(
      <MetaConnectionPanel
        connection={connection({ source: "oauth", pending: true })}
        oauthConfigured
      />,
    );
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
  });
});

describe("<MetaConnectionPanel> connected", () => {
  it("confirms the live account and page", () => {
    render(<MetaConnectionPanel connection={OAUTH_READY} oauthConfigured />);
    expect(screen.getByText("act_123")).toBeInTheDocument();
    expect(screen.getByText("page_456")).toBeInTheDocument();
  });

  it("asks before disconnecting and then refreshes", async () => {
    render(<MetaConnectionPanel connection={OAUTH_READY} oauthConfigured />);
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/meta/disconnect", {
        method: "POST",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("does nothing if the owner cancels the confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MetaConnectionPanel connection={OAUTH_READY} oauthConfigured />);
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(global.fetch).not.toHaveBeenCalledWith("/api/meta/disconnect", {
      method: "POST",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("<MetaConnectionPanel> notices", () => {
  it("renders a success notice from the OAuth round-trip", () => {
    render(
      <MetaConnectionPanel
        connection={OAUTH_READY}
        oauthConfigured
        notice={{ kind: "success", message: "Your Meta account is connected." }}
      />,
    );
    expect(screen.getByText("Your Meta account is connected.")).toBeInTheDocument();
  });

  it("renders an error notice as an alert", () => {
    render(
      <MetaConnectionPanel
        connection={connection()}
        oauthConfigured
        notice={{ kind: "error", message: "That connection link expired." }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That connection link expired.",
    );
  });
});
