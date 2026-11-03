// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaLibrary } from "@/components/media-library";
import { downloadBlob } from "@/lib/download";
import type { MediaView } from "@/lib/media/store";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));

const photo: MediaView = {
  id: "p1", kind: "image", name: "Kitchen", tags: [], width: 1080, height: 1350, bytes: 42, durationMs: null,
  fit: { level: "ready", ratio: "4:5", message: "" }, url: "https://example.com/kitchen.jpg", createdAt: "2026-11-03T08:00:00Z",
};
const video: MediaView = {
  id: "v1", kind: "video", name: "Studio tour", tags: [], width: 1280, height: 720, bytes: 100, durationMs: 60_000,
  fit: { level: "feed", ratio: "16:9", message: "" }, url: "https://example.com/tour.mov", createdAt: "2026-11-03T08:00:00Z",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function library(videoEnabled = true, media: MediaView[] = [photo, video]) {
  return render(<MediaLibrary business={{ id: "b1", vertical: null }} media={media} creatives={[]} brandAssets={[]} videoEnabled={videoEnabled} />);
}

describe("video library (#778)", () => {
  it("plays the owner's video and filters photos and videos separately", () => {
    library();
    const preview = screen.getByLabelText("Studio tour");
    expect(preview.tagName).toBe("VIDEO");
    expect(preview).toHaveAttribute("controls");
    expect(preview).not.toHaveAttribute("autoplay");
    expect(screen.getByText("1:00")).toBeInTheDocument();
    expect(screen.getByText("Wide video (16:9): Feed only. Reels needs a tall (9:16) video.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Photos" }));
    expect(screen.getByRole("img", { name: "Kitchen" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Studio tour")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Videos" }));
    expect(screen.getByLabelText("Studio tour")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Kitchen" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Made by AdBrain" }));
    expect(screen.queryByLabelText("Studio tour")).not.toBeInTheDocument();
  });

  it("keeps the existing photo-only view when the video flag is off", () => {
    library(false, [photo]);
    expect(screen.queryByRole("tab", { name: "Videos" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add photos" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Kitchen" })).toBeInTheDocument();
  });

  it.each([
    ["video/mp4", "mp4"],
    ["video/quicktime", "mov"],
  ])("downloads a checked %s response with the matching extension", async (mime, extension) => {
    const blob = new Blob(["video"], { type: mime });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }));
    library();
    fireEvent.keyDown(screen.getByRole("button", { name: "More for Studio tour" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download" }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, `adbrain-studio-tour.${extension}`));
  });

  it("does not download an unexpected response as a video", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["bad"], { type: "text/html" }) }));
    library();
    fireEvent.keyDown(screen.getByRole("button", { name: "More for Studio tour" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Download" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Download failed. Try again.");
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("shows a clear empty state on the Videos tab without hiding photos", () => {
    library(true, [photo]);
    fireEvent.click(screen.getByRole("tab", { name: "Videos" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("No videos yet. Add a video of your work.")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Add photos & videos" })).toBeInTheDocument();
  });

  it("restores a video and identifies it when deletion fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    library();
    fireEvent.keyDown(screen.getByRole("button", { name: "More for Studio tour" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(screen.getByLabelText("Studio tour")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't delete the video. Try again.");
  });
});
