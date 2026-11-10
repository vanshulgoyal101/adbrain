// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrandForm } from "@/components/brand-form";
import { BrandTrackingCard, type BrandTrackingCardProps } from "@/components/brand-tracking-card";
import { BrandTrackingPanel } from "@/components/brand-tracking-panel";
import type { ReviewTracking } from "@/lib/campaign/website-tracking";
import en from "../messages/en.json";

const actions = vi.hoisted(() => ({ refreshBrandTracking: vi.fn() }));
vi.mock("@/app/(app)/brand/actions", () => ({ saveBusiness: vi.fn(), ...actions }));
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirm: () => [async () => false, null],
}));

const copy = {
  title: "Website tracking",
  intro: "Only needed for website leads or sales.",
  legend: "Which pixel should AdBrain use?",
  noSource: "No website tracking source is available to this ad account.",
  noSourceHelp: "Check this ad account's access or set up tracking in Events Manager.",
  unreadable: "We couldn't check tracking for this ad account.",
  unreadableHelp: "Check Meta access, then try again.",
  choose: "Choose which tracking source to use.",
  quiet: "Meta hasn't seen any recent events.",
  missing: "Meta hasn't seen one or more events for website goals.",
  selectionUnavailable: "Choosing a tracking source is not available yet.",
  pixelUnavailable: "Unavailable",
  unnamed: (number: number) => `Tracking source ${number}`,
  leadCount: (count: number) => `Website leads (Lead): ${count ? `seen ${count} times` : "not seen"}`,
  purchaseCount: (count: number) => `Sales (Purchase): ${count ? `seen ${count} times` : "not seen"}`,
  window: (since: string, until: string) => `Checked from ${since} to ${until}`,
  countsNote: "Counts are what Meta reports, not orders AdBrain has checked.",
  checkAgain: "Check again",
  checking: "Checking…",
  refreshFailed: "We couldn't refresh website tracking. Try again.",
  checkAccess: "Check Meta access",
  eventsManager: "Open Events Manager",
};

const noSource = {
  pixelId: null,
  status: {
    state: "none", unreadable: null, pixelId: null, pixels: [], window: null,
    lastSeenAt: null, counts: null, totalEvents: null,
  },
} satisfies ReviewTracking;

const ready = {
  pixelId: "101",
  status: {
    state: "ready", unreadable: null, pixelId: "101",
    pixels: [
      { id: "101", name: "Shop website", lastFiredAt: null, unavailable: false },
      { id: "202", name: "Other website", lastFiredAt: null, unavailable: false },
    ],
    window: { since: "2026-10-28T00:00:00+0000", until: "2026-11-04T00:00:00+0000" },
    lastSeenAt: "2026-10-20T14:00:00Z", counts: { Lead: 12, Purchase: 0 }, totalEvents: 12,
  },
} satisfies ReviewTracking;
const words = { locale: "en" as const, messages: en.websiteTracking };

function BrandFormWithTracking({ trackingCard }: { trackingCard: BrandTrackingCardProps }) {
  return <BrandForm business={null} trackingCard={<BrandTrackingCard {...trackingCard} />} />;
}

describe("Brand website tracking", () => {
  it("accepts the tracking card as an independent component slot", () => {
    render(<BrandForm business={null} trackingCard={<BrandTrackingCard tracking={noSource} copy={copy} onCheckAgain={vi.fn()} />} />);
    expect(screen.getByRole("region", { name: copy.title })).toBeInTheDocument();
  });

  it("shows a no-source state, working recovery links, and a recheck without submitting Brand", async () => {
    const onCheckAgain = vi.fn().mockResolvedValue(noSource);
    render(<BrandFormWithTracking trackingCard={{ tracking: noSource, copy, onCheckAgain }} />);
    const card = screen.getByRole("region", { name: copy.title });
    expect(within(card).getByText(copy.noSource)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: copy.checkAccess })).toHaveAttribute("href", "/settings");
    expect(within(card).getByRole("link", { name: copy.eventsManager })).toHaveAttribute("href", "https://business.facebook.com/events_manager2");
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: copy.checkAgain })));
    expect(onCheckAgain).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("replaces the account-level counts after a successful fresh check", async () => {
    const refreshed: ReviewTracking = {
      ...ready,
      status: { ...ready.status, counts: { Lead: 13, Purchase: 1 }, totalEvents: 14 },
    };
    const onCheckAgain = vi.fn().mockResolvedValue(refreshed);
    render(<BrandFormWithTracking trackingCard={{ tracking: ready, copy, onCheckAgain }} />);

    fireEvent.click(screen.getByRole("button", { name: copy.checkAgain }));

    expect(await screen.findByText(copy.leadCount(13))).toBeInTheDocument();
    expect(screen.queryByText(copy.leadCount(12))).not.toBeInTheDocument();
    expect(onCheckAgain).toHaveBeenCalledExactlyOnceWith("101");
  });

  it("uses the server refresh action with serializable localized words", async () => {
    const refreshed: ReviewTracking = {
      ...ready,
      status: { ...ready.status, counts: { Lead: 15, Purchase: 2 }, totalEvents: 17 },
    };
    actions.refreshBrandTracking.mockResolvedValue(refreshed);
    render(<BrandTrackingPanel tracking={ready} words={words} />);

    fireEvent.click(screen.getByRole("button", { name: copy.checkAgain }));

    expect(await screen.findByText("Website leads (Lead): 15")).toBeInTheDocument();
    expect(actions.refreshBrandTracking).toHaveBeenCalledExactlyOnceWith("101");
  });

  it("keeps the previous counts and explains when a fresh check cannot complete", async () => {
    const onCheckAgain = vi.fn().mockResolvedValue(null);
    render(<BrandFormWithTracking trackingCard={{ tracking: ready, copy, onCheckAgain }} />);

    fireEvent.click(screen.getByRole("button", { name: copy.checkAgain }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.refreshFailed);
    expect(screen.getByText(copy.leadCount(12))).toBeInTheDocument();
  });

  it("does not describe a failed read as an empty account or another business's ownership", () => {
    const tracking: ReviewTracking = {
      pixelId: null,
      status: { ...noSource.status, state: "unreadable", unreadable: "list_failed" },
    };
    render(<BrandFormWithTracking trackingCard={{ tracking, copy, onCheckAgain: vi.fn() }} />);
    const card = screen.getByRole("region", { name: copy.title });
    expect(within(card).getByText(copy.unreadable)).toBeInTheDocument();
    expect(within(card).queryByText(copy.noSource)).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent(/another business owns/i);
  });

  it("explains an empty account without a contradictory read failure when a saved source disappeared", () => {
    render(<BrandFormWithTracking trackingCard={{ tracking: { ...noSource, pixelId: "101" }, copy, onCheckAgain: vi.fn() }} />);
    const card = screen.getByRole("region", { name: copy.title });
    expect(within(card).getByText(copy.noSource)).toBeInTheDocument();
    expect(within(card).queryByText(copy.unreadableHelp)).not.toBeInTheDocument();
  });

  it("shows the real checked window and zero event counts for a quiet selected source", () => {
    const tracking: ReviewTracking = {
      ...ready,
      status: { ...ready.status, state: "quiet", counts: { Lead: 0, Purchase: 0 }, totalEvents: 0 },
    };
    render(<BrandFormWithTracking trackingCard={{ tracking, copy, onCheckAgain: vi.fn(), onSelect: vi.fn() }} />);
    const card = screen.getByRole("region", { name: copy.title });
    expect(within(card).getByText(copy.quiet)).toBeInTheDocument();
    expect(within(card).getByText(copy.leadCount(0))).toBeInTheDocument();
    expect(within(card).getByText(copy.purchaseCount(0))).toBeInTheDocument();
    expect(within(card).getByText(copy.window("2026-10-28T00:00:00+0000", "2026-11-04T00:00:00+0000"))).toBeInTheDocument();
    expect(card).not.toHaveTextContent("2026-10-20T14:00:00Z");
  });

  it("does not attribute old counts to a newly selected source", () => {
    const onSelect = vi.fn();
    const onCheckAgain = vi.fn();
    const { rerender } = render(<BrandFormWithTracking trackingCard={{ tracking: ready, copy, onCheckAgain, onSelect }} />);
    const card = screen.getByRole("region", { name: copy.title });
    expect(within(card).getByText(copy.leadCount(12))).toBeInTheDocument();
    expect(within(card).getByText(copy.purchaseCount(0))).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("radio", { name: "Other website" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("202");
    rerender(<BrandFormWithTracking trackingCard={{ tracking: { ...ready, pixelId: "202" }, copy, onCheckAgain, onSelect }} />);
    expect(within(card).queryByText(copy.leadCount(12))).not.toBeInTheDocument();
    expect(within(card).getByText(copy.unreadable)).toBeInTheDocument();
  });

  it("shows an event-missing state without claiming the last activity was that event", () => {
    const tracking: ReviewTracking = {
      ...ready,
      status: { ...ready.status, state: "event_missing", counts: { Lead: 0, Purchase: 0 }, totalEvents: 5 },
    };
    render(<BrandFormWithTracking trackingCard={{ tracking, copy, onCheckAgain: vi.fn(), onSelect: vi.fn() }} />);
    const card = screen.getByRole("region", { name: copy.title });
    expect(within(card).getByText(copy.missing)).toBeInTheDocument();
    expect(within(card).getByText(copy.leadCount(0))).toBeInTheDocument();
    expect(card).not.toHaveTextContent("2026-10-20T14:00:00Z");
  });

  it("leaves an unpersistable selection focusable but does not let it change", () => {
    render(<BrandFormWithTracking trackingCard={{ tracking: ready, copy, onCheckAgain: vi.fn() }} />);
    const card = screen.getByRole("region", { name: copy.title });
    const other = within(card).getByRole("radio", { name: "Other website" });
    expect(other).toHaveAttribute("aria-disabled", "true");
    expect(within(card).getByText(copy.selectionUnavailable)).toBeInTheDocument();
    other.focus();
    expect(other).toHaveFocus();
    fireEvent.click(other);
    expect(within(card).getByRole("radio", { name: "Shop website" })).toBeChecked();
  });

  it("does not show counts for invalid event data or an invalid checked window", () => {
    const onCheckAgain = vi.fn();
    const { rerender } = render(<BrandFormWithTracking trackingCard={{
      tracking: { ...ready, status: { ...ready.status, counts: { Lead: -1, Purchase: 0 } } }, copy, onCheckAgain,
    }} />);
    const card = screen.getByRole("region", { name: copy.title });
    expect(within(card).getByText(copy.unreadable)).toBeInTheDocument();
    expect(within(card).queryByText(copy.leadCount(-1))).not.toBeInTheDocument();
    rerender(<BrandFormWithTracking trackingCard={{
      tracking: { ...ready, status: { ...ready.status, window: { since: "bad date", until: "2026-11-04T00:00:00Z" } } },
      copy, onCheckAgain,
    }} />);
    expect(within(card).getByText(copy.unreadable)).toBeInTheDocument();
    expect(within(card).queryByText(copy.leadCount(12))).not.toBeInTheDocument();
  });

  it("distinguishes duplicate source names without exposing their IDs", () => {
    const tracking: ReviewTracking = {
      ...ready,
      status: { ...ready.status, pixels: ready.status.pixels.map((pixel) => ({ ...pixel, name: "Website" })) },
    };
    render(<BrandFormWithTracking trackingCard={{ tracking, copy, onCheckAgain: vi.fn(), onSelect: vi.fn() }} />);
    const card = screen.getByRole("region", { name: copy.title });
    expect(within(card).getByRole("radio", { name: "Website (Tracking source 1)" })).toBeInTheDocument();
    expect(within(card).getByRole("radio", { name: "Website (Tracking source 2)" })).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/\b101\b/);
    expect(card).not.toHaveTextContent(/\b202\b/);
  });

  it("does not change sources or submit repeated checks during a read", () => {
    const onSelect = vi.fn();
    const onCheckAgain = vi.fn();
    render(<BrandFormWithTracking trackingCard={{ tracking: ready, copy, onCheckAgain, onSelect, checking: true }} />);
    const card = screen.getByRole("region", { name: copy.title });
    expect(within(card).getByRole("button", { name: copy.checking })).toBeDisabled();
    const other = within(card).getByRole("radio", { name: "Other website" });
    expect(other).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(other);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCheckAgain).not.toHaveBeenCalled();
  });

  it("keeps the existing Brand form unchanged when tracking is not offered", () => {
    render(<BrandForm business={null} />);
    expect(screen.queryByRole("region", { name: copy.title })).not.toBeInTheDocument();
  });
});
