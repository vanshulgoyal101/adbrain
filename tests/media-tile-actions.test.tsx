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
  render(<MediaLibrary business={{ id: "b1", vertical: null }} media={[photo("m1", "Kitchen"), photo("m2", "Shop front")]} creatives={[]} brandAssets={[]} consented
    deps={{ fetch: fetch as never, uploadToSignedUrl: vi.fn() }} />);
}

describe("own-photo tile actions (#778 slice 3c)", () => {
  it("Rename saves the new name and shows it", async () => {
    const fetch = vi.fn(async () => json(200, { ok: true, asset: photo("m1", "Finished kitchen") }));
    setup(fetch);
    fireEvent.click(screen.getByRole("button", { name: "Rename Kitchen" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Finished kitchen" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "Finished kitchen" })).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/media/m1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Finished kitchen" }) }));
  });

  it("Delete hides the photo with Undo; Undo brings it back and nothing is deleted", () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    setup(fetch);
    fireEvent.click(screen.getByRole("button", { name: "Delete Kitchen" }));
    expect(screen.queryByRole("img", { name: "Kitchen" })).not.toBeInTheDocument();
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Deleted");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("img", { name: "Kitchen" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("without Undo the delete is sent after a few seconds", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => json(200, { ok: true }));
    setup(fetch);
    fireEvent.click(screen.getByRole("button", { name: "Delete Kitchen" }));
    await act(async () => { vi.advanceTimersByTime(6_000); });
    expect(fetch).toHaveBeenCalledWith("/api/media/m1", expect.objectContaining({ method: "DELETE" }));
    expect(screen.queryByRole("img", { name: "Kitchen" })).not.toBeInTheDocument();
  });

  it("a photo in a running ad comes back with the reason", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => json(409, { code: "MEDIA_IN_USE", error: "\"Diwali offer\" uses this photo. Pause that campaign first." }));
    setup(fetch);
    fireEvent.click(screen.getByRole("button", { name: "Delete Kitchen" }));
    await act(async () => { vi.advanceTimersByTime(6_000); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByRole("img", { name: "Kitchen" })).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("\"Diwali offer\" uses this photo. Pause that campaign first.");
  });
});
