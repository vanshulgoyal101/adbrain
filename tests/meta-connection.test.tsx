// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaConnectionPanel } from "@/components/meta-connection";
import type { MetaConnection } from "@/lib/meta/credentials";
// #403 S6: the confirm dialog has its own tests (confirm-dialog.test.tsx); here window.confirm stands in for the owner's answer.
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirm: () => [async (options: { title: string; description?: string }) => window.confirm([options.title, options.description].filter(Boolean).join(" ")), null],
}));

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
beforeEach(() => { refresh.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

describe("MetaConnectionPanel", () => {
  it.each(["server", "network", "invalid response"])("keeps the connection visible and allows retry after a %s failure", async failure => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const request = vi.fn();
    if (failure === "network") request.mockRejectedValue(new Error("Network unavailable"));
    else request.mockResolvedValue(new Response(JSON.stringify(failure === "server" ? { error: "Disconnect rejected" } : {}), { status: failure === "server" ? 503 : 200 }));
    vi.stubGlobal("fetch", request);
    render(<MetaConnectionPanel businessId="11111111-1111-4111-8111-111111111111" connection={connection({ source: "oauth", ready: true })} oauthConfigured />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(failure === "network" ? "Network unavailable" : failure === "server" ? "Disconnect rejected" : "Facebook is still connected. Try again in a minute.");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("/api/meta/disconnect", expect.objectContaining({ body: JSON.stringify({ businessId: "11111111-1111-4111-8111-111111111111" }) }));
  });

  it("disables actions until the disconnect succeeds and refreshes only on success", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let complete!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
    render(<MetaConnectionPanel businessId="11111111-1111-4111-8111-111111111111" connection={connection({ source: "oauth", ready: true })} oauthConfigured />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("button", { name: "Disconnecting..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Manage connection" })).toBeDisabled();
    expect(refresh).not.toHaveBeenCalled();
    complete(new Response(JSON.stringify({ ok: true })));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("does not disconnect when confirmation is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    render(<MetaConnectionPanel businessId="11111111-1111-4111-8111-111111111111" connection={connection({ source: "oauth" })} oauthConfigured />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(request).not.toHaveBeenCalled();
  });

  // #757: warn a week ahead, while managing still works.
  it("asks the owner to reconnect by the date the token stops working, only within 7 days", () => {
    const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    const { rerender } = render(<MetaConnectionPanel businessId="11111111-1111-4111-8111-111111111111" connection={connection({ source: "oauth", ready: true, tokenExpiresAt: at(6) })} oauthConfigured />);
    const label = new Date(at(6)).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    expect(screen.getByText(`Reconnect Facebook by ${label} to keep managing your ads.`)).toBeInTheDocument();
    rerender(<MetaConnectionPanel businessId="11111111-1111-4111-8111-111111111111" connection={connection({ source: "oauth", ready: true, tokenExpiresAt: at(10) })} oauthConfigured />);
    expect(screen.queryByText(/Reconnect Facebook by/)).not.toBeInTheDocument();
  });

  it("offers a prominent business connection without technical controls", () => {
    render(
      <MetaConnectionPanel
        businessId="11111111-1111-4111-8111-111111111111"
        connection={connection()}
        oauthConfigured
      />,
    );

    expect(screen.getByRole("button", { name: "Connect Business" })).toBeInTheDocument();
    expect(screen.queryByText(/traffic runner/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/app secret|access token|configuration id/i)).not.toBeInTheDocument();
  });

  it("keeps connection setup unavailable until the server is configured", () => {
    render(
      <MetaConnectionPanel
        businessId="11111111-1111-4111-8111-111111111111"
        connection={connection()}
        oauthConfigured={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Connect Business" })).not.toBeInTheDocument();
    expect(screen.getByText(/not configured on this server/i)).toBeInTheDocument();
  });

  it("opens the shared dialog from Settings", () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        data: {
          businessId: "11111111-1111-4111-8111-111111111111",
          generation: 0,
          authorization: "disconnected",
          selected: null,
          capabilities: {
            canReadInsights: { state: "unknown", blockers: [] },
            canReadLeads: { state: "unknown", blockers: [] },
            canCreatePaused: { state: "unknown", blockers: [] },
            canActivate: { state: "unknown", blockers: [] },
          },
          checkedAt: null,
        },
        requestId: "33333333-3333-4333-8333-333333333333",
      })),
    ) as unknown as typeof fetch;
    render(
      <MetaConnectionPanel
        businessId="11111111-1111-4111-8111-111111111111"
        connection={connection()}
        oauthConfigured
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Business" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connect your business to Meta" })).toBeInTheDocument();
  });

  it("says who holds the ad money at Connect (#1292)", () => {
    const { unmount } = render(<MetaConnectionPanel businessId="11111111-1111-4111-8111-111111111111" connection={connection({ source: "oauth", ready: false })} oauthConfigured fundingMode="own" />);
    expect(screen.getByText("Your Page, your ad account, your card. AdBrain never holds your ad money.")).toBeInTheDocument();
    unmount();
    render(<MetaConnectionPanel businessId="11111111-1111-4111-8111-111111111111" connection={connection({ source: "oauth", ready: false })} oauthConfigured fundingMode="managed" />);
    expect(screen.getByText("Your ad budget stays yours: you see every rupee spent.")).toBeInTheDocument();
    expect(screen.queryByText(/never holds your ad money/)).toBeNull();
  });
});
