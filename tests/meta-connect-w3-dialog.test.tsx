// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MetaConnectDialog } from "@/components/meta-connect/meta-connect-dialog";
import { createMetaConnectClient } from "@/lib/meta-connect-ui/client";
import {
  businessId,
  connected,
  connectedAttemptForActivation,
  disconnectedUnknown,
} from "./fixtures/meta-connect-w3";

describe("MetaConnectDialog", () => {
  it("checks an in-progress authorization without restarting discovery", async () => {
    const pending = { ...connectedAttemptForActivation, state: "authorizing" as const, connection: null };
    const retry = vi.fn();
    const attempt = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(connectedAttemptForActivation);
    const client = { attempt, retry } as never;
    render(<MetaConnectDialog businessId={businessId} intent={pending.intent} initialAttempt={pending}
      open onClose={vi.fn()} onConnected={vi.fn()} client={client} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Connected to Meta")).toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledTimes(2);
  });
  it("resumes same-tab selection instead of treating an older connection as success", async () => {
    const pending = {
      ...connectedAttemptForActivation,
      state: "selection_required" as const,
      candidates: [{ pairId: "selected-pair", assets: connected.selected!, eligible: true, blockers: [] }],
    };
    const onConnected = vi.fn();
    const select = vi.fn().mockResolvedValue(connectedAttemptForActivation);
    const client = { attempt: vi.fn().mockResolvedValue(pending), select, status: vi.fn(), start: vi.fn() } as never;
    render(<MetaConnectDialog businessId={businessId} intent={pending.intent} initialAttempt={pending}
      open onClose={vi.fn()} onConnected={onConnected} client={client} />);
    await userEvent.setup().click(await screen.findByRole("radio"));
    expect(onConnected).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Use selected business" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(connectedAttemptForActivation.connection));
    expect(select).toHaveBeenCalledWith(pending.attemptId, "selected-pair", pending.revision, false, expect.any(AbortSignal));
  });

  it("offers fresh authorization for an expired same-tab attempt", async () => {
    const expired = { ...connectedAttemptForActivation, state: "expired" as const, connection: null };
    const client = { attempt: vi.fn().mockResolvedValue(expired) } as never;
    render(<MetaConnectDialog businessId={businessId} intent={expired.intent} initialAttempt={expired}
      open onClose={vi.fn()} onConnected={vi.fn()} client={client} />);
    expect(await screen.findByRole("button", { name: "Reconnect Meta" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
  });

  it("returns activation reconnects to review without create or activate requests", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        ok: true,
        data: connected,
        requestId: "33333333-3333-4333-8333-333333333333",
      }));
    });
    const onConnected = vi.fn();
    function Harness() {
      const [review, setReview] = useState(false);
      return (
        <>
          <button type="button">Open connection</button>
          {review && <h1>Campaign review</h1>}
          <MetaConnectDialog
            businessId={businessId}
            intent={{ kind: "review_activation", campaignId: "44444444-4444-4444-8444-444444444444" }}
            open
            onClose={vi.fn()}
            onConnected={(connection) => {
              onConnected(connection);
              setReview(true);
            }}
            client={createMetaConnectClient({ fetchImpl })}
          />
        </>
      );
    }

    render(<Harness />);
    expect(await screen.findByText("Connected to Meta")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Review activation" }));
    expect(await screen.findByRole("heading", { name: "Campaign review" })).toBeInTheDocument();
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(connected));
    expect(calls.some((path) => path.includes("/api/campaign-drafts") || path.includes("/api/campaigns/"))).toBe(false);
    expect(calls.some((path) => path.includes("/activate") || path.includes("/create"))).toBe(false);
  });

  it("ignores wrong-origin, wrong-source, and stale-attempt messages", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        data: connected,
        requestId: "33333333-3333-4333-8333-333333333333",
      })),
    );
    const client = createMetaConnectClient({ fetchImpl });
    render(
      <MetaConnectDialog
        businessId={businessId}
        intent={{ kind: "setup" }}
        open
        onClose={vi.fn()}
        onConnected={vi.fn()}
        client={client}
      />,
    );
    await screen.findByText("Connected to Meta");
    const requestCount = fetchImpl.mock.calls.length;

    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://untrusted.example",
      source: window,
      data: { type: "adbrain.meta.complete", attemptId: "22222222-2222-4222-8222-222222222222" },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      source: window,
      data: { type: "adbrain.meta.complete", attemptId: "22222222-2222-4222-8222-222222222222" },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      source: window,
      data: { type: "adbrain.meta.complete", attemptId: "stale" },
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl.mock.calls.length).toBe(requestCount);
  });

  it("shows recovery when the authorization popup is blocked", async () => {
    const start = vi.fn().mockRejectedValue(new Error("Connection could not start."));
    const client = {
      status: vi.fn().mockResolvedValue({
        ...connected,
        authorization: "disconnected" as const,
        selected: null,
      }),
      start,
      attempt: vi.fn(),
      select: vi.fn(),
      saveDraft: vi.fn(),
      updateDraft: vi.fn(),
      preflight: vi.fn(),
      createCampaign: vi.fn(),
      operation: vi.fn(),
    } as never;
    vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();
    render(
      <MetaConnectDialog
        businessId={businessId}
        intent={{ kind: "setup" }}
        open
        onClose={vi.fn()}
        onConnected={vi.fn()}
        client={client}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Connect Business" }));
    await waitFor(() => expect(window.open).toHaveBeenCalled());
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/could not start the Meta connection/i)).toBeInTheDocument();
  });

  it("retries a failed attempt with the server revision before polling again", async () => {
    const attemptId = connectedAttemptForActivation.attemptId;
    const failedAttempt = {
      ...connectedAttemptForActivation,
      state: "failed" as const,
      connection: null,
      blockers: [{ code: "UNAVAILABLE" as const, message: "Discovery failed.", action: null }],
    };
    const discoveringAttempt = {
      ...failedAttempt,
      state: "discovering" as const,
      revision: 3,
      blockers: [],
    };
    const attempt = vi.fn()
      .mockResolvedValueOnce(failedAttempt)
      .mockResolvedValueOnce(connectedAttemptForActivation);
    const retry = vi.fn().mockResolvedValue(discoveringAttempt);
    const start = vi.fn().mockResolvedValue({
      attemptId,
      authorizationUrl: "https://www.facebook.com/",
      expiresAt: "2026-09-08T00:00:00.000Z",
    });
    const client = {
      status: vi.fn().mockResolvedValue(disconnectedUnknown),
      start,
      attempt,
      retry,
      select: vi.fn(),
      saveDraft: vi.fn(),
      updateDraft: vi.fn(),
      preflight: vi.fn(),
      createCampaign: vi.fn(),
      operation: vi.fn(),
    } as never;
    vi.spyOn(window, "open").mockReturnValue({
      location: { href: "" },
      close: vi.fn(),
    } as unknown as Window);
    const user = userEvent.setup();
    render(
      <MetaConnectDialog
        businessId={businessId}
        intent={{ kind: "review_activation", campaignId: "44444444-4444-4444-8444-444444444444" }}
        open
        onClose={vi.fn()}
        onConnected={vi.fn()}
        client={client}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Connect Business" }));
    await screen.findByRole("button", { name: "Check again" });
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith(
      attemptId,
      connectedAttemptForActivation.revision,
      expect.any(AbortSignal),
    ));
    expect(await screen.findByText("Connected to Meta")).toBeInTheDocument();
  });

  it("ignores a connection result from the previous business after switching", async () => {
    const firstBusinessId = businessId;
    const secondBusinessId = "77777777-7777-4777-8777-777777777777";
    const firstStatus = new Promise<Response>((resolve) => {
      setTimeout(() => resolve(new Response(JSON.stringify({
        ok: true,
        data: connected,
        requestId: "33333333-3333-4333-8333-333333333333",
      }))), 20);
    });
    const secondStatus = Promise.resolve(new Response(JSON.stringify({
      ok: true,
      data: { ...connected, businessId: secondBusinessId, authorization: "disconnected", selected: null },
      requestId: "33333333-3333-4333-8333-333333333333",
    })));
    const fetchImpl = vi.fn<typeof fetch>()
      .mockReturnValueOnce(firstStatus)
      .mockReturnValueOnce(secondStatus);
    const client = createMetaConnectClient({ fetchImpl });
    const { rerender } = render(
      <MetaConnectDialog
        businessId={firstBusinessId}
        intent={{ kind: "setup" }}
        open
        onClose={vi.fn()}
        onConnected={vi.fn()}
        client={client}
      />,
    );

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    rerender(
      <MetaConnectDialog
        businessId={secondBusinessId}
        intent={{ kind: "setup" }}
        open
        onClose={vi.fn()}
        onConnected={vi.fn()}
        client={client}
      />,
    );
    expect(await screen.findByRole("button", { name: "Connect Business" })).toBeInTheDocument();
    await firstStatus;
    expect(screen.queryByText("Vanshul Clinic")).not.toBeInTheDocument();
  });

  it("requires an eligible candidate choice and disables blocked candidates", async () => {
    const selectionAttempt = {
      ...connectedAttemptForActivation,
      intent: { kind: "setup" as const },
      state: "selection_required" as const,
      connection: null,
      candidates: [
        {
          pairId: "pair-blocked",
          assets: { ...connected.selected!, pageId: "page-blocked", pageName: "Blocked Page" },
          eligible: false,
          blockers: [{ code: "ACCOUNT_RESTRICTED" as const, message: "Account is restricted.", action: null }],
        },
        {
          pairId: "pair-eligible",
          assets: connected.selected!,
          eligible: true,
          blockers: [],
        },
      ],
    };
    const select = vi.fn().mockResolvedValue({
      ...connectedAttemptForActivation,
      intent: { kind: "setup" as const },
    });
    const start = vi.fn().mockResolvedValue({
      attemptId: connectedAttemptForActivation.attemptId,
      authorizationUrl: "https://www.facebook.com/",
      expiresAt: "2026-09-08T00:00:00.000Z",
    });
    const client = {
      status: vi.fn().mockResolvedValue(disconnectedUnknown),
      start,
      attempt: vi.fn().mockResolvedValue(selectionAttempt),
      select,
      saveDraft: vi.fn(),
      updateDraft: vi.fn(),
      preflight: vi.fn(),
      createCampaign: vi.fn(),
      operation: vi.fn(),
    } as never;
    vi.spyOn(window, "open").mockReturnValue({
      location: { href: "" },
      close: vi.fn(),
    } as unknown as Window);
    const user = userEvent.setup();
    render(
      <MetaConnectDialog
        businessId={businessId}
        intent={{ kind: "setup" }}
        open
        onClose={vi.fn()}
        onConnected={vi.fn()}
        client={client}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Connect Business" }));
    expect(await screen.findByRole("radio", { name: /Blocked Page/ })).toBeDisabled();
    const eligible = screen.getByRole("radio", { name: /Vanshul Clinic/ });
    await user.click(eligible);
    await user.click(screen.getByRole("button", { name: "Use selected business" }));
    await waitFor(() => expect(select).toHaveBeenCalledWith(
      connectedAttemptForActivation.attemptId,
      "pair-eligible",
      selectionAttempt.revision,
      false,
      expect.any(AbortSignal),
    ));
  });

  it("starts OAuth with the saved prepare intent returned by the draft hook", async () => {
    const start = vi.fn().mockResolvedValue({
      attemptId: connectedAttemptForActivation.attemptId,
      authorizationUrl: "https://www.facebook.com/",
      expiresAt: "2026-09-08T00:00:00.000Z",
    });
    const client = {
      status: vi.fn().mockResolvedValue(disconnectedUnknown),
      start,
      attempt: vi.fn().mockResolvedValue({
        ...connectedAttemptForActivation,
        intent: { kind: "prepare_campaign" as const, draftId: businessId, draftVersion: 1 },
        state: "selection_required" as const,
        connection: null,
        discoveryComplete: true,
        candidates: [],
      }),
      select: vi.fn(),
      saveDraft: vi.fn(),
      updateDraft: vi.fn(),
      preflight: vi.fn(),
      createCampaign: vi.fn(),
      operation: vi.fn(),
    } as never;
    vi.spyOn(window, "open").mockReturnValue({
      location: { href: "" },
      close: vi.fn(),
    } as unknown as Window);
    const user = userEvent.setup();
    render(
      <MetaConnectDialog
        businessId={businessId}
        intent={{ kind: "setup" }}
        open
        onClose={vi.fn()}
        onConnected={vi.fn()}
        onBeforeStart={async () => ({
          kind: "prepare_campaign",
          draftId: businessId,
          draftVersion: 1,
        })}
        client={client}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Connect Business" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(
      businessId,
      { kind: "prepare_campaign", draftId: businessId, draftVersion: 1 },
      expect.any(AbortSignal),
    ));
  });
});