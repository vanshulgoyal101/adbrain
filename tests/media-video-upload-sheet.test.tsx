// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaLibrary } from "@/components/media-library";
import type { SignedUpload, VideoReader } from "@/lib/media/client-upload";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const quota = (used = 0) => ({
  ok: true, items: [], next: null,
  uploads: { used: 0, limit: 50, videos: { enabled: true, used, limit: 3, maxSeconds: 60, maxBytes: 50 * 1024 * 1024 } },
});
const video = () => new File(["video"], "tour.mov", { type: "video/quicktime" });
const videoAsset = {
  id: "m2", kind: "video", name: "tour", tags: [], width: 1280, height: 720, bytes: 5, durationMs: 2000,
  fit: { level: "feed", ratio: "16:9", message: "Wide (16:9): Feed shows it; Stories and Reels need a tall picture." },
  url: "https://example.com/tour.mov", createdAt: "2026-11-03T08:00:00Z",
};
const reader: VideoReader = async () => ({ width: 1280, height: 720, durationMs: 2000 });

afterEach(() => vi.unstubAllGlobals());

function setup(options: { consented?: boolean; request?: typeof fetch; videoReader?: VideoReader; upload?: SignedUpload } = {}) {
  const request = options.request ?? vi.fn(async (input: RequestInfo | URL) =>
    String(input).startsWith("/api/media?") ? json(200, quota()) :
      String(input) === "/api/media/sign" ? json(200, { ok: true, duplicate: false, id: "m2", bucket: "media-video", path: "b1/m2.mov", token: "t" }) :
        json(200, { ok: true, asset: videoAsset }));
  const uploadToSignedUrl = options.upload ?? vi.fn(async () => ({ error: null }));
  render(<MediaLibrary business={{ id: "b1", vertical: null }} media={[]} creatives={[]} brandAssets={[]}
    consented={options.consented ?? true} startOpen videoEnabled videoReader={options.videoReader ?? reader}
    deps={{ fetch: request, uploadToSignedUrl }} />);
  return { request, uploadToSignedUrl };
}

async function chooseVideo(file = video()) {
  const input = await screen.findByLabelText("Choose photos and videos");
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.queryByText("Checking…")).not.toBeInTheDocument());
}

describe("video upload sheet (#778)", () => {
  it("shows the approved limits and quota warning before an MP4/MOV is chosen", async () => {
    setup();
    const sheet = await screen.findByRole("dialog", { name: "Add photos & videos" });
    const input = await within(sheet).findByLabelText("Choose photos and videos");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,video/mp4,video/quicktime");
    expect(within(sheet).getByText("0 of 3 video uploads used this month. Each video can be up to 50 MB and 60 seconds.")).toBeInTheDocument();
    expect(within(sheet).getByText("A video uses one monthly spot when upload starts. Removing it won’t give the spot back.")).toBeInTheDocument();
    expect(within(sheet).getByText("If the connection drops, tap Try again to upload the video from the start.")).toBeInTheDocument();
  });

  it("checks a wide video, shows its own preview, and signs and finalizes it in the video bucket", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (file: File) => `blob:${file.name}`, revokeObjectURL: vi.fn() }));
    const { request, uploadToSignedUrl } = setup();
    await chooseVideo();
    const sheet = screen.getByRole("dialog", { name: "Add photos & videos" });
    const item = within(sheet).getByRole("listitem");
    expect(within(item).getByText("Wide video (16:9): Feed only. Reels needs a tall (9:16) video.")).toBeInTheDocument();
    expect(item.querySelector("video")).toHaveAttribute("src", "blob:tour.mov");
    fireEvent.click(within(sheet).getByRole("button", { name: "Add 1 video" }));
    await waitFor(() => expect(within(item).getByText("Added")).toBeInTheDocument());
    const calls = vi.mocked(request).mock.calls;
    const sign = calls.find(([input]) => String(input) === "/api/media/sign");
    expect(sign).toBeDefined();
    expect(JSON.parse(String(sign?.[1]?.body))).toMatchObject({
      businessId: "b1", mime: "video/quicktime", bytes: 5, width: 1280, height: 720, durationMs: 2000,
    });
    expect(uploadToSignedUrl).toHaveBeenCalledWith("media-video", "b1/m2.mov", "t", expect.any(File), "video/quicktime");
  });

  it("rejects an oversized short clip with a smaller-export suggestion before signing", async () => {
    const { request } = setup();
    const large = video();
    Object.defineProperty(large, "size", { value: 100 * 1024 * 1024 });
    await chooseVideo(large);
    const sheet = screen.getByRole("dialog", { name: "Add photos & videos" });
    expect(within(sheet).getByText(/100 MB.*50 MB.*smaller, lower-resolution/i)).toBeInTheDocument();
    expect(within(sheet).queryByText(/trim.*5 seconds/i)).not.toBeInTheDocument();
    expect(vi.mocked(request).mock.calls.some(([input]) => String(input) === "/api/media/sign")).toBe(false);
  });

  it("keeps photos usable and offers a retry when video limits cannot be checked", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(json(503, { ok: false }))
      .mockResolvedValueOnce(json(200, quota(1)));
    setup({ request });
    const sheet = await screen.findByRole("dialog", { name: "Add photos & videos" });
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Couldn't check video limits. Try again; you can still add photos.");
    expect(within(sheet).getByLabelText("Choose photos")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    fireEvent.click(within(sheet).getByRole("button", { name: "Try again" }));
    expect(await within(sheet).findByLabelText("Choose photos and videos")).toBeInTheDocument();
    expect(within(sheet).getByText(/1 of 3 video uploads used this month/)).toBeInTheDocument();
  });

  it("shows the music note when a video needs the owner's rights confirmation", async () => {
    setup({ consented: false });
    await chooseVideo();
    expect(screen.getByText(/Music from films or popular songs can get your ad muted or rejected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add 1 video" })).toBeDisabled();
  });

  it("refreshes the quota after a signed upload, and keeps the warning visible", async () => {
    let quotaReads = 0;
    const request = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith("/api/media?") ? json(200, quota(quotaReads++ ? 1 : 0)) :
        String(input) === "/api/media/sign" ? json(200, { ok: true, duplicate: false, id: "m2", bucket: "media-video", path: "b1/m2.mov", token: "t" }) :
          json(200, { ok: true, asset: videoAsset }));
    setup({ request });
    await chooseVideo();
    fireEvent.click(screen.getByRole("button", { name: "Add 1 video" }));
    expect(await screen.findByText(/1 of 3 video uploads used this month/)).toBeInTheDocument();
    expect(screen.getByText("A video uses one monthly spot when upload starts. Removing it won’t give the spot back.")).toBeInTheDocument();
  });

  it("refreshes the used count when signing succeeds, before the upload finishes", async () => {
    let quotaReads = 0;
    let finish!: (value: { error: null }) => void;
    const request = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith("/api/media?") ? json(200, quota(quotaReads++ ? 1 : 0)) :
        String(input) === "/api/media/sign" ? json(200, { ok: true, duplicate: false, id: "m2", bucket: "media-video", path: "b1/m2.mov", token: "t" }) :
          json(200, { ok: true, asset: videoAsset }));
    setup({ request, upload: () => new Promise((resolve) => { finish = resolve; }) });
    await chooseVideo();
    fireEvent.click(screen.getByRole("button", { name: "Add 1 video" }));
    expect(await screen.findByText(/1 of 3 video uploads used this month/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Uploading…" })).toBeInTheDocument();
    finish({ error: null });
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
  });

  it("retries the same pending file when its first attempt filled the monthly quota", async () => {
    let quotaReads = 0;
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const [input] = args;
      return String(input).startsWith("/api/media?") ? json(200, quota(quotaReads++ ? 3 : 2)) :
        String(input) === "/api/media/sign" ? json(200, { ok: true, duplicate: false, id: "m2", bucket: "media-video", path: "b1/m2.mov", token: "t" }) :
          json(200, { ok: true, asset: videoAsset });
    });
    const upload = vi.fn()
      .mockResolvedValueOnce({ error: new Error("offline") })
      .mockResolvedValueOnce({ error: null });
    setup({ request, upload });
    await chooseVideo();
    const item = screen.getByRole("listitem");
    fireEvent.click(screen.getByRole("button", { name: "Add 1 video" }));
    expect(await screen.findByText(/3 of 3 video uploads used this month/)).toBeInTheDocument();
    const retry = within(item).getByRole("button", { name: "Try again" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await waitFor(() => expect(within(item).getByText("Added")).toBeInTheDocument());
    const signs = request.mock.calls.filter(([input]) => String(input) === "/api/media/sign");
    expect(signs).toHaveLength(2);
    expect(JSON.parse(String(signs[0][1]?.body)).sha256).toBe(JSON.parse(String(signs[1][1]?.body)).sha256);
    expect(upload.mock.calls[0].slice(0, 2)).toEqual(upload.mock.calls[1].slice(0, 2));
  });

  it("keeps the picker photo-only if the quota response is malformed", async () => {
    const request = vi.fn(async () => json(200, { ok: true, uploads: { videos: { enabled: true } } }));
    setup({ request });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't check video limits. Try again; you can still add photos.");
    expect(screen.getByLabelText("Choose photos")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  });

  it.each([
    ["the quota response is not JSON", () => Promise.resolve(new Response("invalid", { status: 200 }))],
    ["the quota request fails", () => Promise.reject(new TypeError("offline"))],
  ])("keeps photos available and retries when %s", async (_reason, fail) => {
    const request = vi.fn().mockImplementationOnce(fail).mockResolvedValueOnce(json(200, quota()));
    setup({ request });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't check video limits. Try again; you can still add photos.");
    expect(screen.getByLabelText("Choose photos")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Choose photos and videos")).toBeInTheDocument();
  });

  it("keeps photos available when video uploads are disabled", async () => {
    const disabled = quota();
    disabled.uploads.videos.enabled = false;
    setup({ request: vi.fn(async () => json(200, disabled)) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Video uploads aren't available right now. You can still add photos.");
    expect(screen.getByLabelText("Choose photos")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("lets a picked video be removed before signing", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (file: File) => `blob:${file.name}`, revokeObjectURL: vi.fn() }));
    const { request } = setup();
    await chooseVideo();
    fireEvent.click(screen.getByRole("button", { name: "Remove tour.mov" }));
    expect(screen.queryByText("tour.mov")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:tour.mov");
    expect(vi.mocked(request).mock.calls.some(([input]) => String(input) === "/api/media/sign")).toBe(false);
  });

  it("shows the music note for videos even when rights were previously confirmed", async () => {
    setup();
    await chooseVideo();
    expect(screen.getByText(/Music from films or popular songs can get your ad muted or rejected/)).toBeInTheDocument();
  });

  it("shows indeterminate progress and continues when the sheet closes", async () => {
    let finish!: (value: { error: null }) => void;
    const upload = vi.fn(() => new Promise<{ error: null }>((resolve) => { finish = resolve; }));
    setup({ upload });
    await chooseVideo();
    const add = screen.getByRole("button", { name: "Add 1 video" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(await screen.findByRole("progressbar", { name: "Uploading…" })).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText(/Keep this page open until it finishes/)).toBeInTheDocument();
    finish({ error: null });
    await waitFor(() => expect(screen.queryByText(/Keep this page open until it finishes/)).not.toBeInTheDocument());
  });

  it("clearly queues later files and does not offer a nonfunctional remove action", async () => {
    let finish!: (value: { error: null }) => void;
    const upload = vi.fn()
      .mockImplementationOnce(() => new Promise<{ error: null }>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ error: null });
    setup({ upload });
    const input = await screen.findByLabelText("Choose photos and videos");
    fireEvent.change(input, { target: { files: [video(), new File(["other"], "second.mov", { type: "video/quicktime" })] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add 2 videos" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Add 2 videos" }));
    const item = screen.getByText("second.mov").closest("li");
    if (!item) throw new Error("Missing queued item");
    expect(within(item).getByText("Waiting to upload…")).toBeInTheDocument();
    expect(within(item).queryByRole("button", { name: "Remove second.mov" })).not.toBeInTheDocument();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    finish({ error: null });
    await waitFor(() => expect(within(item).getByText("Added")).toBeInTheDocument());
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
