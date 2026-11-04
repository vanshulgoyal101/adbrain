// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserVideoReader } from "@/lib/media/client-upload";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setupVideo() {
  const element = document.createElement("video");
  Object.defineProperties(element, {
    videoWidth: { value: 720 },
    videoHeight: { value: 1280 },
    duration: { value: 2.001 },
  });
  const load = vi.spyOn(element, "load").mockImplementation(() => {});
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => tag === "video" ? element : original(tag)) as typeof document.createElement);
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:clip"), revokeObjectURL: revoke }));
  return { element, load, revoke };
}

describe("browser video metadata (#778)", () => {
  it("reads actual video dimensions and duration, then releases the temporary object URL", async () => {
    const { element, load, revoke } = setupVideo();
    const reading = browserVideoReader(new File(["x"], "clip.mp4", { type: "video/mp4" }));
    expect(element.src).toBe("blob:clip");
    element.dispatchEvent(new Event("loadedmetadata"));
    await expect(reading).resolves.toEqual({ width: 720, height: 1280, durationMs: 2001 });
    expect(revoke).toHaveBeenCalledWith("blob:clip");
    expect(element.getAttribute("src")).toBeNull();
    expect(load).toHaveBeenCalled();
  });

  it("releases the temporary URL when the video is unreadable or metadata never arrives", async () => {
    vi.useFakeTimers();
    const { element, revoke } = setupVideo();
    const unreadable = browserVideoReader(new File(["x"], "bad.mp4", { type: "video/mp4" }));
    const rejected = expect(unreadable).rejects.toThrow();
    element.dispatchEvent(new Event("error"));
    await rejected;
    expect(revoke).toHaveBeenCalledWith("blob:clip");

    const stalled = browserVideoReader(new File(["x"], "stalled.mp4", { type: "video/mp4" }));
    const timedOut = expect(stalled).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15_000);
    await timedOut;
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
