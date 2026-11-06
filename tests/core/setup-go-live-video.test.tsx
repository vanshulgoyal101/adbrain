// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Business, Creative } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/lib/campaign/setup-go-live-flow", () => ({ goLive: vi.fn() }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => ({}) }));
import { SetupGoLive } from "@/components/setup-go-live";

const business = { id: "b1", name: "Spine Care", locations: ["Jaipur"] } as Pick<Business, "id" | "name" | "locations">;
const ads = [{ id: "a", headline: "Ad a", image_url: "/a.png" }, { id: "b", headline: "Ad b", image_url: "/b.png" }] as Creative[];
const prepareWords = { working: "Preparing", delayed: "Still checking", waiting: "Waiting", ready: "Prepared", error: "Failed", retry: "Try again" };

describe("core: Go live with a selected video (#781)", () => {
  it("prepares the picked video, not the linked photo", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true, status: "ready", kind: "video", videoId: "123" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const withVideo = [{ ...ads[0], media_asset_id: "video-1" }, { ...ads[1], media_asset_id: "photo-1" }] as Creative[];
      render(<SetupGoLive business={business} ads={withVideo} pageConnected funding="managed" whatsappNumber="+91 ••••• 3210"
        weeklyCap={{ capRupees: null, active: [] }} videoAssetIds={["video-1"]} prepareWords={prepareWords} />);
      await waitFor(() => expect(screen.getByText("Prepared")).toBeInTheDocument());
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/media/video-1/meta"]);
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not send media when video uploads are disabled", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, status: "ready" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const withVideo = [{ ...ads[0], media_asset_id: "video-1" }, ads[1]] as Creative[];
      render(<SetupGoLive business={business} ads={withVideo} pageConnected funding="managed" whatsappNumber="+91 ••••• 3210"
        weeklyCap={{ capRupees: null, active: [] }} videoAssetIds={[]} prepareWords={prepareWords} />);
      await act(async () => {});
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("disables Go live while a selected video is preparing", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => pending));
    try {
      const withVideo = [{ ...ads[0], media_asset_id: "video-1" }, ads[1]] as Creative[];
      render(<SetupGoLive business={business} ads={withVideo} pageConnected funding="managed" whatsappNumber="+91 ••••• 3210"
        weeklyCap={{ capRupees: null, active: [] }} videoAssetIds={["video-1"]} prepareWords={prepareWords} />);
      const goLiveButton = within(screen.getByRole("navigation", { name: "Setup steps" })).getByRole("button", { name: /Go live/ });
      expect(goLiveButton).toBeDisabled();
      await act(async () => { finish(new Response(JSON.stringify({ status: "ready", kind: "video", videoId: "123" }), { status: 200 })); });
      await waitFor(() => expect(goLiveButton).toBeEnabled());
    } finally { vi.unstubAllGlobals(); }
  });
});
