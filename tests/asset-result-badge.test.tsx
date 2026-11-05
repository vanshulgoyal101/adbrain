// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssetResultBadge, AssetResultsNotice } from "@/components/asset-result-badge";
import { MediaLibrary } from "@/components/media-library";
import type { MediaView } from "@/lib/media/store";
import type { AssetResults, AssetTotals } from "@/lib/campaign/asset-results";
import hi from "../messages/hi.json";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const totals: AssetTotals = { destination: "whatsapp", objective: "OUTCOME_ENGAGEMENT", results: 3, spendPaise: 28_800, delivered: true, syncedAt: "2026-11-02T10:00:00Z" };
const ready = (groups: AssetTotals[] = [totals]): Extract<AssetResults, { state: "ready" }> => ({
  state: "ready", byMedia: { photo: groups }, byCreative: { creative: groups }, unmatched: 0, asOf: Date.parse("2026-11-02T10:03:00Z"),
});
describe("quiet lifetime asset result badges", () => {
  it("shows a media's chats, pooled cost and freshness without declaring a winner", () => {
    render(<AssetResultBadge results={ready()} assetId="photo" kind="media" />);
    expect(screen.getByText(/3 chats/)).toHaveTextContent("₹96 per chat");
    expect(screen.getByText("Updated 3m ago")).toBeInTheDocument();
    expect(screen.queryByText(/Best/)).not.toBeInTheDocument();
  });
  it("keeps different goals on separate lines, including website visits", () => {
    render(<AssetResultBadge results={ready([totals, { ...totals, destination: "website", results: 20, spendPaise: 10_000 }])} assetId="creative" kind="creative" />);
    expect(screen.getByText(/3 chats/)).toBeInTheDocument();
    expect(screen.getByText(/20 visits/)).toHaveTextContent("₹5 per visit");
  });
  it("distinguishes no read, a delivered zero and no delivery; never shows a zero cost", () => {
    const { rerender } = render(<AssetResultBadge results={ready()} assetId="unread" kind="media" />);
    expect(screen.getByText("No results yet")).toBeInTheDocument();
    rerender(<AssetResultBadge results={ready([{ ...totals, results: 0 }])} assetId="photo" kind="media" />);
    expect(screen.getByText(/0 chats/)).toHaveTextContent("— per chat");
    rerender(<AssetResultBadge results={ready([{ ...totals, results: 0, spendPaise: 0, delivered: false }])} assetId="photo" kind="media" />);
    expect(screen.getByText("Meta hasn't shown this ad yet")).toBeInTheDocument();
    expect(screen.queryByText(/0 chats/)).not.toBeInTheDocument();
  });
  it("reports failed/partial attribution once, and stays absent with the flag off", () => {
    const { rerender, container } = render(<><AssetResultBadge assetId="photo" kind="media" /><AssetResultsNotice /></>);
    expect(container).toBeEmptyDOMElement();
    rerender(<><AssetResultBadge results={{ state: "unavailable" }} assetId="photo" kind="media" /><AssetResultsNotice results={{ state: "unavailable" }} /></>);
    expect(screen.getByRole("status")).toHaveTextContent("Results couldn't be loaded. Try reloading this page.");
    expect(screen.queryByText(/0 chats/)).not.toBeInTheDocument();
    rerender(<AssetResultsNotice results={{ ...ready(), unmatched: 2 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Some ad results couldn't be linked to a photo or saved ad.");
  });
  it("says an empty tile's results are not linked yet, not absent, while some ad results are unlinked", () => {
    const { rerender } = render(<AssetResultBadge results={{ ...ready(), unmatched: 1 }} assetId="unread" kind="media" />);
    expect(screen.getByText("Results not linked yet")).toBeInTheDocument();
    rerender(<AssetResultBadge results={{ ...ready(), unmatched: 1 }} assetId="photo" kind="media" />);
    expect(screen.getByText(/3 chats/)).toBeInTheDocument();
  });
  it("uses Hindi words and a server-pinned clock even across a hydration time boundary", () => {
    const view = <AssetResultBadge results={ready()} assetId="photo" kind="media" words={{ locale: "hi", messages: hi.verdict }} />;
    const html = renderToString(view);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-03T00:01:00Z"));
      expect(renderToString(view)).toBe(html);
      render(view);
      expect(screen.getByText(/3 चैट/)).toBeInTheDocument();
      expect(screen.getByText("3 मिनट पहले अपडेट हुआ")).toBeInTheDocument();
      expect(screen.getByText(/3 चैट/).closest("[lang]")).toHaveAttribute("lang", "hi");
    } finally { vi.useRealTimers(); }
  });
  it("keeps the photo library's own words and the result words apart (#2759 merge)", () => {
    const photo: MediaView = { id: "photo", kind: "image", durationMs: null, name: "Kitchen", tags: [], width: 1080, height: 1080, bytes: 1, fit: { level: "feed", ratio: "1:1", message: "Square: fine for Feed." }, url: "https://example.com/m1.jpg", createdAt: "2026-10-29T10:00:00Z" };
    render(<MediaLibrary words={{ locale: "hi", messages: hi.media }} resultWords={{ locale: "hi", messages: hi.verdict }} results={ready()}
      business={{ id: "b1", vertical: null }} media={[photo]} creatives={[]} brandAssets={[]} consented />);
    expect(screen.getByRole("button", { name: "फ़ोटो जोड़ें" })).toBeInTheDocument();
    expect(screen.getByText(/3 चैट/).closest("[lang]")).toHaveAttribute("lang", "hi");
  });
});
