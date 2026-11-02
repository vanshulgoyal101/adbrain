// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaLibrary } from "@/components/media-library";
import type { MediaView } from "@/lib/media/store";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
afterEach(() => vi.useRealTimers());

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const photo = (id: string, name: string): MediaView => ({ id, name, tags: [], width: 1080, height: 1350, bytes: 1, fit: { level: "ready", ratio: "4:5", message: "Ready for Feed, Stories and Reels" }, url: `https://example.com/${id}.jpg`, createdAt: "2026-10-29T10:00:00Z" });

function setup(fetch: ReturnType<typeof vi.fn>) {
  return render(<MediaLibrary business={{ id: "b1", vertical: null }} media={[photo("m1", "Kitchen"), photo("m2", "Shop front")]} creatives={[]} brandAssets={[]} consented
    deps={{ fetch: fetch as never, uploadToSignedUrl: vi.fn() }} />);
}

// Radix opens its menu on keyboard in jsdom (no pointer capture).
function choose(name: string, item: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: `More for ${name}` }), { key: "Enter" });
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

describe("own-photo tile actions (#778 slice 3c)", () => {
  it("own photos have one ⋯ menu (Rename · Download · Delete), not Copy link or Open", () => {
    setup(vi.fn());
    expect(screen.queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "More for Kitchen" }), { key: "Enter" });
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual(["Rename", "Download", "Delete"]);
  });

  it("Rename saves the new name and shows it", async () => {
    const fetch = vi.fn(async () => json(200, { ok: true, asset: photo("m1", "Finished kitchen") }));
    setup(fetch);
    choose("Kitchen", "Rename");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Finished kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "Finished kitchen" })).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/media/m1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Finished kitchen" }) }));
  });

  it("Delete hides the photo with Undo; Undo brings it back and nothing is deleted", () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    setup(fetch);
    choose("Kitchen", "Delete");
    expect(screen.queryByRole("img", { name: "Kitchen" })).not.toBeInTheDocument();
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Deleted ‘Kitchen’");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("img", { name: "Kitchen" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("without Undo the delete is sent after a few seconds", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => json(200, { ok: true }));
    setup(fetch);
    choose("Kitchen", "Delete");
    await act(async () => { vi.advanceTimersByTime(6_000); });
    expect(fetch).toHaveBeenCalledWith("/api/media/m1", expect.objectContaining({ method: "DELETE" }));
    expect(screen.queryByRole("img", { name: "Kitchen" })).not.toBeInTheDocument();
  });

  it("a photo in a running ad comes back with the reason", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => json(409, { code: "MEDIA_IN_USE", error: "\"Diwali offer\" uses this photo. Pause that campaign first." }));
    setup(fetch);
    choose("Kitchen", "Delete");
    await act(async () => { vi.advanceTimersByTime(6_000); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByRole("img", { name: "Kitchen" })).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("\"Diwali offer\" uses this photo. Pause that campaign first.");
    expect(screen.getByRole("alert")).toHaveClass("rounded-lg");
    expect(screen.getByRole("alert").parentElement).toHaveClass("fixed", "bottom-4");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaving the page sends a pending delete now instead of dropping it", () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => json(200, { ok: true }));
    setup(fetch);
    choose("Kitchen", "Delete");
    window.dispatchEvent(new Event("pagehide"));
    expect(fetch).toHaveBeenCalledWith("/api/media/m1", expect.objectContaining({ method: "DELETE", keepalive: true }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("leaving the library sends a pending delete; an undone one is not sent", () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => json(200, { ok: true }));
    const view = setup(fetch);
    choose("Kitchen", "Delete");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    choose("Shop front", "Delete");
    view.unmount();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/media/m2", expect.objectContaining({ method: "DELETE", keepalive: true }));
  });
});
