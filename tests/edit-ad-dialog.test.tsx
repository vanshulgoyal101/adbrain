// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditAdDialog } from "@/components/edit-ad-dialog";
import { BACK_TO_REVIEW, editableAds } from "@/lib/campaign/ad-edit-copy";
import type { Campaign, Creative } from "@/lib/types";

const creatives = [
  { id: "c1", headline: "Stop guessing if your roof is ready", primary_text: "Book your free solar site survey today.", generation: null },
  { id: "c2", headline: "Find Out Before You Commit", primary_text: "Not sure your rooftop can take solar?", generation: null },
] as unknown as Creative[];
const row = (adSetIds: string[], adIds: string[], extra: Record<string, unknown> = {}) => ({
  id: "camp-1", meta_campaign_id: "mc", meta_adset_id: adSetIds[0], meta_ad_ids: adIds, creative_ids: ["c1", "c2"],
  raw: { source: "campaign_operation", metaResult: { campaignId: "mc", adSetIds, adIds }, ...extra },
}) as unknown as Campaign;
// #499's shape: the source ad set (paused) and the capped copy that delivers.
const capped = row(["src-set", "cap-set"], ["src-1", "src-2", "live-1", "live-2"], { cappedAdSetIds: ["cap-set"], cap: { adSetId: "cap-set" } });
// An uncapped A/B by age: two ad sets, both delivering (QA #898).
const abTest = row(["set-a", "set-b"], ["a-1", "a-2", "b-1", "b-2"]);

let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetcher = vi.fn(async () => Response.json({ ok: true, result: { creativeId: "NEW" } }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-2222-4333-8444-555555555555" });
});
afterEach(() => vi.unstubAllGlobals());

describe("edit a launched ad's words (#775)", () => {
  it("offers a capped run's delivering copies, every ad of an uncapped A/B by ad set, and decides from the stored cap", () => {
    expect(editableAds(capped, ["c1", "c2"])).toEqual([
      { adId: "live-1", creativeId: "c1", label: "Ad 1" }, { adId: "live-2", creativeId: "c2", label: "Ad 2" }]);
    expect(editableAds(abTest, ["c1", "c2"])).toEqual([
      { adId: "a-1", creativeId: "c1", label: "Ad set 1 · Ad 1" }, { adId: "a-2", creativeId: "c2", label: "Ad set 1 · Ad 2" },
      { adId: "b-1", creativeId: "c1", label: "Ad set 2 · Ad 1" }, { adId: "b-2", creativeId: "c2", label: "Ad set 2 · Ad 2" }]);
    expect(editableAds(row(["s"], ["x-1", "x-2"]), ["c1", "c2"]).map((ad) => ad.label)).toEqual(["Ad 1", "Ad 2"]);
    // A layout that doesn't line up offers every ad, without guessing its creative.
    expect(editableAds(row(["s"], ["x-1", "x-2", "x-3"]), ["c1", "c2"])).toEqual([
      { adId: "x-1", creativeId: null, label: "Ad 1" }, { adId: "x-2", creativeId: null, label: "Ad 2" }, { adId: "x-3", creativeId: null, label: "Ad 3" }]);
  });

  it("prefills the ad's words, says it goes back to review, and sends only what changed", async () => {
    const onSaved = vi.fn();
    render(<EditAdDialog campaign={capped} campaignName="Solaride" creatives={creatives} onClose={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByLabelText("Headline")).toHaveValue("Stop guessing if your roof is ready");
    expect(screen.getByRole("note")).toHaveTextContent(BACK_TO_REVIEW);
    fireEvent.change(screen.getByLabelText("Ad", { selector: "select" }), { target: { value: "live-2" } });
    expect(screen.getByLabelText("Headline")).toHaveValue("Find Out Before You Commit");
    fireEvent.change(screen.getByLabelText("Ad text"), { target: { value: "Not sure your rooftop can take solar? Ask us on WhatsApp." } });
    fireEvent.click(screen.getByRole("button", { name: "Save and send to review" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(`New words saved. ${BACK_TO_REVIEW}`, { adId: "live-2", change: { message: "Not sure your rooftop can take solar? Ask us on WhatsApp." } }));
    expect(fetcher).toHaveBeenCalledWith("/api/campaigns/camp-1/ads/live-2", expect.objectContaining({ method: "PATCH" }));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ change: { message: "Not sure your rooftop can take solar? Ask us on WhatsApp." }, idempotencyKey: "11111111-2222-4333-8444-555555555555" });
  });

  it("after an edit, it opens on the ad's current words, not the original creative's", () => {
    const edited = row(["src-set", "cap-set"], ["src-1", "src-2", "live-1", "live-2"], { cappedAdSetIds: ["cap-set"], cap: { adSetId: "cap-set" }, adWords: { "live-1": { headline: "Is your roof solar-ready?" } } });
    render(<EditAdDialog campaign={edited} campaignName="Solaride" creatives={creatives} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText("Headline")).toHaveValue("Is your roof solar-ready?");
    expect(screen.getByLabelText("Ad text")).toHaveValue("Book your free solar site survey today.");
  });

  it("lists every A/B ad by ad set, so editing one arm is a visible choice", () => {
    render(<EditAdDialog campaign={abTest} campaignName="Solaride A/B" creatives={creatives} onClose={vi.fn()} onSaved={vi.fn()} />);
    const options = [...(screen.getByLabelText("Ad", { selector: "select" }) as HTMLSelectElement).options].map((option) => option.text);
    expect(options).toEqual([
      "Ad set 1 · Ad 1: Stop guessing if your roof is ready", "Ad set 1 · Ad 2: Find Out Before You Commit",
      "Ad set 2 · Ad 1: Stop guessing if your roof is ready", "Ad set 2 · Ad 2: Find Out Before You Commit"]);
  });

  it("shows a refusal in the dialog and keeps the same key for a retry of the same change", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ error: "Meta needs 30 seconds between ad changes. Try again in a moment.", retryable: true }, { status: 429 }));
    render(<EditAdDialog campaign={row(["s"], ["a1", "a2"])} campaignName="Solaride" creatives={creatives} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Headline"), { target: { value: "Free solar site survey this week" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and send to review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("30 seconds");
    fireEvent.click(screen.getByRole("button", { name: "Save and send to review" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetcher.mock.calls[1][1].body).idempotencyKey).toBe(JSON.parse(fetcher.mock.calls[0][1].body).idempotencyKey);
  });

  it("asks for a change before sending anything", () => {
    render(<EditAdDialog campaign={row(["s"], ["a1", "a2"])} campaignName="Solaride" creatives={creatives} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save and send to review" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Change the headline, text or description first.");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
