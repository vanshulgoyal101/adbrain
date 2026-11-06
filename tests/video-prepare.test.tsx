// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VideoPrepare } from "@/components/video-prepare";

// #781: choosing an owner's file starts its send to Meta and shows where it is.
const words = { working: "Preparing", delayed: "Still checking", waiting: "Waiting to check again", ready: "Ready", error: "Failed", retry: "Try again" };
const ready = { ok: true, status: "ready", kind: "video", videoId: "123" };
const processing = { ok: true, status: "processing", kind: "video", videoId: "123" };
const reply = (status: number, body: object) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

describe("VideoPrepare (#781)", () => {
  it("posts once per file to the business's own route and says when ready", async () => {
    const request = reply(200, ready);
    render(<VideoPrepare assetIds={["a", "a", "b"]} words={words} request={request} />);
    await waitFor(() => expect(screen.getAllByText("Ready")).toHaveLength(2));
    expect(request.mock.calls.map((call) => call[0]).sort()).toEqual(["/api/media/a/meta", "/api/media/b/meta"]);
  });
  it("shows each video's state and retries only the failed video", async () => {
    const request = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("/a/")) return Response.json(ready);
      if (String(url).includes("/b/")) return Response.json(processing);
      return init?.body ? Response.json(ready) : Response.json({ status: "error", kind: "video" });
    });
    render(<VideoPrepare assetIds={["a", "b", "c"]} labels={{ a: "First video", b: "Second video", c: "Third video" }} words={words} request={request} />);
    const first = () => screen.getByText("First video").closest("li")!;
    const second = () => screen.getByText("Second video").closest("li")!;
    const third = () => screen.getByText("Third video").closest("li")!;
    await waitFor(() => expect(within(first()).getByText("Ready")).toBeTruthy());
    expect(within(second()).getByText("Preparing")).toBeTruthy();
    expect(within(third()).getByText("Failed")).toBeTruthy();
    fireEvent.click(within(third()).getByRole("button", { name: /Try again/i }));
    await waitFor(() => expect(within(third()).getByText("Ready")).toBeTruthy());
    expect(request.mock.calls.filter(([url]) => String(url).includes("/a/"))).toHaveLength(1);
    expect(request.mock.calls.filter(([url]) => String(url).includes("/b/"))).toHaveLength(1);
    expect(request.mock.calls.filter(([url]) => String(url).includes("/c/"))).toHaveLength(2);
  });
  it("says so when Meta or the server refuses", async () => {
    render(<VideoPrepare assetIds={["a"]} words={words} request={reply(409, { code: "META_NOT_CONNECTED" })} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed"));
  });
  it("shows nothing with no files", () => {
    const { container } = render(<VideoPrepare assetIds={[]} words={words} request={reply(200, {})} />);
    expect(container.textContent).toBe("");
  });
  it("with the default request, asks once per file and stops after ready, even across re-renders", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ready), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { rerender } = render(<VideoPrepare assetIds={["a"]} words={words} />);
      await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());
      rerender(<VideoPrepare assetIds={["a"]} words={{ ...words }} />);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it("stops asking after an error", async () => {
    const request = reply(200, { status: "error" });
    render(<VideoPrepare assetIds={["a"]} words={words} request={request} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("keeps polling while processing, and says so when the server can't be reached three times", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(async () => { throw new TypeError("offline"); });
      render(<VideoPrepare assetIds={["a"]} words={words} request={request} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByRole("status").textContent).toBe("Preparing");
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(screen.getByRole("alert").textContent).toBe("Failed");
      expect(request).toHaveBeenCalledTimes(3);
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(request).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
  it("keeps checking a video that is still processing after ten minutes", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => new Response(JSON.stringify(processing), { status: 200 }));
    const { unmount } = render(<VideoPrepare assetIds={["a"]} words={words} request={request} />);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(605_000); });
      expect(screen.getByRole("status").textContent).toBe("Preparing");
      expect(request).toHaveBeenCalledTimes(122);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });
  it("explains a long preparation after fifteen minutes and keeps checking", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => new Response(JSON.stringify(processing), { status: 200 }));
    const { unmount } = render(<VideoPrepare assetIds={["a"]} words={words} request={request} />);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(905_000); });
      expect(screen.getByRole("status").textContent).toBe("Still checking");
      expect(request).toHaveBeenCalledTimes(182);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });
  it("paces six selected videos below the owner's route limit", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => new Response(JSON.stringify(processing), { status: 200 }));
    const { unmount } = render(<VideoPrepare assetIds={["a", "b", "c", "d", "e", "f"]} words={words} request={request} />);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
      expect(request).toHaveBeenCalledTimes(246);
      expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual(Array(6).fill("Preparing"));
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });
  it("reports an unexpected successful response instead of claiming it is processing", async () => {
    render(<VideoPrepare assetIds={["a"]} words={words} request={reply(200, { status: "unexpected" })} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed"));
  });
  it.each([
    { status: "ready", kind: "video" },
    { status: "ready", kind: "image", imageHash: "hash" },
    { status: "ready", kind: "video", videoId: "not-an-id" },
    { status: "processing", kind: "video" },
    { status: "processing", kind: "video", videoId: 123 },
  ])(
    "does not accept an invalid video response: %o", async (body) => {
      render(<VideoPrepare assetIds={["a"]} words={words} request={reply(200, body)} />);
      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed"));
    },
  );
  it("waits for the server's rate-limit delay before checking again", async () => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "20" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ready), { status: 200 }));
    const { unmount } = render(<VideoPrepare assetIds={["a"]} words={words} request={request} />);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(19_999); });
      expect(screen.getByRole("status").textContent).toBe("Waiting to check again");
      expect(request).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getByRole("status").textContent).toBe("Ready");
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });
  it("does not restart a selected video when another video is added", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(processing), { status: 200 }));
    const { rerender } = render(<VideoPrepare assetIds={["a"]} words={words} request={request} />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    rerender(<VideoPrepare assetIds={["a", "b"]} words={words} request={request} />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls.map(([url]) => url)).toEqual(["/api/media/a/meta", "/api/media/b/meta"]);
  });
  it("starts over for a file that is unticked and ticked again, not showing the old Ready", async () => {
    let release: (response: Response) => void = () => {};
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(ready), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    const { rerender } = render(<VideoPrepare assetIds={["a"]} words={words} request={request} />);
    await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());
    rerender(<VideoPrepare assetIds={[]} words={words} request={request} />);
    rerender(<VideoPrepare assetIds={["a"]} words={words} request={request} />);
    expect(screen.getByText("Preparing")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(2);
    release(new Response(JSON.stringify(ready), { status: 200 }));
    await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());
  });
  it("retries an errored video only when the owner asks", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "error", kind: "video" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ready), { status: 200 }));
    render(<VideoPrepare assetIds={["a"]} words={words} request={request} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Failed"));
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());
    expect(request.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ retry: true }) });
  });
});
