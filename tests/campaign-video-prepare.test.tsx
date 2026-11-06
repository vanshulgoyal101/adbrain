// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Business, Creative } from "@/lib/types";

const client = vi.hoisted(() => ({ drafts: vi.fn(), status: vi.fn(), saveDraft: vi.fn(), preflight: vi.fn() }));
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: vi.fn(), updateCreativeCopy: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => client, MetaConnectClientError: class extends Error {} }));
import { Campaigns } from "@/components/campaigns";

const business = { id: "business-1", owner_id: "owner-1", name: "Solaride", phone: "+91 73802 80874", locations: ["Chandigarh"] } as Business;
const photo = { id: "photo-ad", headline: "Photo ad", image_url: "/photo.png", status: "approved", media_asset_id: "photo-1" } as Creative;
const video = { id: "video-ad", headline: "Video ad", image_url: "/poster.png", status: "approved", media_asset_id: "video-1" } as Creative;

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_1`, String(Date.now()));
  client.drafts.mockResolvedValue([]);
  client.status.mockResolvedValue({ authorization: "connected", selected: { adAccountId: "act_1", pageId: "page_1" }, generation: 1 });
});

describe("campaign composer video preparation (#781)", () => {
  it("prepares selected videos, not photos, and stops when the manual chooser is hidden", async () => {
    const request = vi.fn<typeof fetch>(async (url) => String(url).startsWith("/api/media/")
      ? Response.json({ status: "processing", kind: "video", videoId: "123" })
      : Response.json({ state: "ready", numbers: [] }));
    vi.stubGlobal("fetch", request);
    try {
      render(<Campaigns business={business} approved={[photo, video]} initialCampaigns={[]} initialResults={{}}
        leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" videoAssetIds={["video-1"]} />);
      fireEvent.click(screen.getByRole("tab", { name: "Yours" }));
      fireEvent.click(screen.getByRole("button", { name: "Photo ad, Your photo" }));
      const mediaCalls = () => request.mock.calls.filter(([url]) => String(url).startsWith("/api/media/"));
      expect(mediaCalls()).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Video ad, Your video" }));
      await waitFor(() => expect(mediaCalls()).toHaveLength(1));
      expect(mediaCalls()[0][0]).toBe("/api/media/video-1/meta");
      const signal = mediaCalls()[0][1]?.signal;
      fireEvent.click(screen.getByRole("radio", { name: "Plan with AdBrain" }));
      expect(signal?.aborted).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not call the video endpoint when video uploads are disabled", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ state: "ready", numbers: [] }));
    vi.stubGlobal("fetch", request);
    try {
      render(<Campaigns business={business} approved={[video]} initialCampaigns={[]} initialResults={{}}
        leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" videoAssetIds={[]} />);
      fireEvent.click(screen.getByRole("tab", { name: "Yours" }));
      fireEvent.click(screen.getByRole("button", { name: "Video ad, Your photo" }));
      await act(async () => {});
      expect(request.mock.calls.filter(([url]) => String(url).startsWith("/api/media/"))).toHaveLength(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it("explains an over-limit selection without silently dropping an ad", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ state: "ready", numbers: [] }));
    vi.stubGlobal("fetch", request);
    const ads = Array.from({ length: 7 }, (_, index) => ({ ...photo, id: `ad-${index + 1}`, headline: `Ad ${index + 1}`, media_asset_id: null }));
    try {
      render(<Campaigns business={business} approved={ads} initialCampaigns={[]} initialResults={{}}
        leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" mediaPilotEnabled />);
      for (let index = 1; index <= 7; index++) fireEvent.click(screen.getByRole("button", { name: `Ad ${index}` }));
      expect(screen.getByText(/6 ads.*7|7 ads.*6/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ad 7" })).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(screen.getByRole("button", { name: /Check my campaign/ }));
      expect(client.saveDraft).not.toHaveBeenCalled();
      expect(client.preflight).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Ad 7" }));
      expect(screen.queryByText(/6 ads.*7|7 ads.*6/i)).not.toBeInTheDocument();
      await act(async () => {});
    } finally { vi.unstubAllGlobals(); }
  });
});
