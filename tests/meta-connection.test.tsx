// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetaConnectionPanel } from "@/components/meta-connection";
import type { MetaConnection } from "@/lib/meta/credentials";

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
});
