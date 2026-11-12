// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMediaUploads } from "@/components/media-upload";
import { mediaTranslator } from "@/i18n/words";
import type { Codec, VideoReader } from "@/lib/media/client-upload";

const MAX = 50 * 1024 * 1024;
const read: VideoReader = async () => ({ width: 720, height: 1280, durationMs: 1000 });
const codec: Codec = async () => ({ blob: new Blob(["photo"], { type: "image/jpeg" }), width: 1080, height: 1350 });

describe("video preparation lifecycle", () => {
  it("buffers at most one maximum-size video across overlapping picks and skips a removed queued video", async () => {
    let activeBytes = 0;
    let peakBytes = 0;
    let draining = false;
    const waiting: Array<() => void> = [];
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(async () => {
      if (!draining) await new Promise<void>((resolve) => { waiting.push(resolve); });
      activeBytes -= MAX;
      return new ArrayBuffer(32);
    });
    const files = Array.from({ length: 11 }, (_, index) => {
      const file = new File(["v"], `video-${index}.mp4`, { type: "video/mp4" });
      const readBytes = vi.fn(async () => {
        activeBytes += MAX;
        peakBytes = Math.max(peakBytes, activeBytes);
        return new ArrayBuffer(1);
      });
      Object.defineProperty(file, "size", { value: MAX });
      Object.defineProperty(file, "arrayBuffer", { value: readBytes });
      return { file, readBytes };
    });
    const { result } = renderHook(() => useMediaUploads({
      t: mediaTranslator(), businessId: "b1", onAdded: vi.fn(), codec, videoReader: read,
    }));
    let picks: Promise<void>[] = [];
    try {
      act(() => {
        picks = [result.current.pick(files.slice(0, 10).map(({ file }) => file), true), result.current.pick([files[10].file], true)];
      });
      await waitFor(() => expect(digest).toHaveBeenCalled());
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      const removed = result.current.items.find((item) => item.name === "video-10.mp4");
      if (!removed) throw new Error("Missing queued video");
      act(() => result.current.remove(removed.key));
      expect(peakBytes).toBe(MAX);
    } finally {
      draining = true;
      await act(async () => { waiting.splice(0).forEach((resolve) => resolve()); await Promise.all(picks); });
      digest.mockRestore();
    }
    expect(files[10].readBytes).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(10);
    expect(result.current.items.every((item) => item.status === "ready")).toBe(true);
  });
});
