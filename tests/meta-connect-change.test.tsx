// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaConnectDialog } from "@/components/meta-connect/meta-connect-dialog";
import { businessId, connected, connectedAttemptForActivation, disconnectedUnknown } from "./fixtures/meta-connect-w3";

const nav = vi.hoisted(() => ({ continueInTab: vi.fn() }));
vi.mock("@/lib/meta-connect-ui/navigate", () => nav);

afterEach(() => {
  vi.restoreAllMocks();
  nav.continueInTab.mockReset();
});

const other = { ...connected.selected!, pageId: "999", pageName: "Second Page", adAccountId: "act_5550001", accountName: "Second account" };
const choice = {
  ...connectedAttemptForActivation,
  intent: { kind: "setup" as const },
  state: "selection_required" as const,
  connection: connected,
  candidates: [
    { pairId: "current", assets: connected.selected!, eligible: true, blockers: [] },
    { pairId: "other", assets: other, eligible: true, blockers: [] },
  ],
};

describe("Connect Meta: popup fallback and Change (#474)", () => {
  it("offers 'Continue in this tab' when the popup stays silent, and leaves the popup for this tab", async () => {
    const popup = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const authorizationUrl = "https://www.facebook.com/v23.0/dialog/oauth?state=s";
    const pending = { ...connectedAttemptForActivation, state: "authorizing" as const, connection: null, retryAfterMs: 1000 };
    const client = {
      status: vi.fn().mockResolvedValue(disconnectedUnknown),
      start: vi.fn().mockResolvedValue({ attemptId: pending.attemptId, authorizationUrl, expiresAt: pending.expiresAt }),
      attempt: vi.fn().mockResolvedValue(pending),
    } as never;
    const user = userEvent.setup();
    render(<MetaConnectDialog businessId={businessId} intent={{ kind: "setup" }} open onClose={vi.fn()} onConnected={vi.fn()} client={client} />);
    await user.click(await screen.findByRole("button", { name: "Connect Business" }));
    await waitFor(() => expect(popup.location.href).toBe(authorizationUrl));
    expect(screen.queryByRole("button", { name: "Continue in this tab" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Continue in this tab" }, { timeout: 5000 }));
    expect(popup.close).toHaveBeenCalled();
    expect(nav.continueInTab).toHaveBeenCalledWith(authorizationUrl);
  }, 10_000);

  it("'Change' lists the pairs the saved grant allows without a new Facebook login", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const client = {
      status: vi.fn().mockResolvedValue(connected),
      change: vi.fn().mockResolvedValue(choice),
      start: vi.fn().mockReturnValue(new Promise(() => {})),
      select: vi.fn().mockResolvedValue({ ...choice, state: "connected", connection: { ...connected, selected: other } }),
    };
    const onConnected = vi.fn();
    const user = userEvent.setup();
    render(<MetaConnectDialog businessId={businessId} intent={{ kind: "setup" }} open onClose={vi.fn()} onConnected={onConnected} client={client as never} />);
    await user.click(await screen.findByRole("button", { name: "Change" }));
    expect(client.change).toHaveBeenCalledWith(businessId, { kind: "setup" }, expect.any(AbortSignal));
    expect(await screen.findAllByRole("radio")).toHaveLength(2);
    expect(client.start).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: /Second Page/ }));
    await user.click(screen.getByRole("button", { name: "Confirm replacement" }));
    expect(client.select).toHaveBeenCalledWith(choice.attemptId, "other", choice.revision, true, expect.any(AbortSignal));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
  });

  it("a new Facebook login only via 'Use another Facebook account'", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const client = {
      status: vi.fn().mockResolvedValue(connected),
      change: vi.fn().mockResolvedValue(choice),
      start: vi.fn().mockResolvedValue({ attemptId: choice.attemptId, authorizationUrl: "https://www.facebook.com/dialog/oauth", expiresAt: choice.expiresAt }),
    };
    const user = userEvent.setup();
    render(<MetaConnectDialog businessId={businessId} intent={{ kind: "setup" }} open onClose={vi.fn()} onConnected={vi.fn()} client={client as never} />);
    await user.click(await screen.findByRole("button", { name: "Change" }));
    await user.click(await screen.findByRole("button", { name: "Use another Facebook account" }));
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
    expect(nav.continueInTab).toHaveBeenCalledWith("https://www.facebook.com/dialog/oauth");
  });

  it("asks for a reconnect when the saved grant can't be reused", async () => {
    const client = {
      status: vi.fn().mockResolvedValue(connected),
      change: vi.fn().mockRejectedValue(new Error("Reconnect Meta to choose another Page or ad account.")),
      start: vi.fn(),
    };
    const user = userEvent.setup();
    render(<MetaConnectDialog businessId={businessId} intent={{ kind: "setup" }} open onClose={vi.fn()} onConnected={vi.fn()} client={client as never} />);
    await user.click(await screen.findByRole("button", { name: "Change" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Reconnect Meta to choose another Page");
    expect(screen.getByRole("button", { name: "Reconnect Meta" })).toBeInTheDocument();
    expect(client.start).not.toHaveBeenCalled();
  });
});
