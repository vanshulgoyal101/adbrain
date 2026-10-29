// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MediaLibrary } from "@/components/media-library";
import type { Codec } from "@/lib/media/client-upload";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const shapes: Record<string, [number, number]> = { "tall.jpg": [1080, 1350], "wide.jpg": [1600, 900], "tiny.jpg": [400, 300] };
const codec: Codec = async (file) => {
  const [width, height] = shapes[file.name] ?? [1080, 1080];
  return { blob: new Blob([file.name], { type: "image/jpeg" }), width, height };
};
const pick = async (names: string[]) => {
  const input = screen.getByLabelText("Choose photos");
  fireEvent.change(input, { target: { files: names.map((name) => new File(["x"], name, { type: name.endsWith(".gif") ? "image/gif" : "image/jpeg" })) } });
  await waitFor(() => expect(screen.queryByText("Checking…")).not.toBeInTheDocument());
};
const asset = (id: string, name: string) => ({ id, name, tags: [], width: 1080, height: 1350, bytes: 1, fit: { level: "ready", ratio: "4:5", message: "Ready for Feed, Stories and Reels" }, url: `https://example.com/${id}.jpg`, createdAt: "2026-10-29T10:00:00Z" });

function setup({ consented = true, vertical = "Interior design", fetch = vi.fn() } = {}) {
  const uploadToSignedUrl = vi.fn(async () => ({ error: null }));
  render(<MediaLibrary business={{ id: "b1", vertical }} media={[]} creatives={[]} brandAssets={[]} consented={consented} startOpen
    deps={{ fetch, uploadToSignedUrl }} codec={codec} />);
  return { fetch, uploadToSignedUrl, sheet: screen.getByRole("dialog", { name: "Add photos & videos" }) };
}

describe("upload sheet (#778 slice 3b)", () => {
  it("gives each pick its fit line before anything is sent, and refuses what can't be used", async () => {
    const { fetch, sheet } = setup();
    await pick(["tall.jpg", "wide.jpg", "tiny.jpg", "anim.gif"]);
    const list = within(sheet).getByRole("list", { name: "Your picks" });
    expect(within(list).getByText("Ready for Feed, Stories and Reels")).toBeInTheDocument();
    expect(within(list).getByText("Wide (16:9): Feed shows it; Stories and Reels need a tall picture.")).toBeInTheDocument();
    expect(within(list).getByText("Too small (300 px wide). Use the original photo, not a screenshot or a WhatsApp copy.")).toBeInTheDocument();
    expect(within(list).getByText(/This file type can't be used/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  // Designer on #1999: "warning, can proceed" reads differently from "fine" and from red "refused".
  it("shows a usable-with-limits fit in amber, a fine one in slate, and labels the button with the ready count", async () => {
    const { sheet } = setup();
    await pick(["tall.jpg", "wide.jpg", "tiny.jpg"]);
    const list = within(sheet).getByRole("list", { name: "Your picks" });
    expect(within(list).getByText(/^Wide \(16:9\)/)).toHaveClass("text-amber-800");
    expect(within(list).getByText("Ready for Feed, Stories and Reels")).toHaveClass("text-slate-600");
    expect(within(list).getByText(/^Too small/)).toHaveClass("text-red-700");
    expect(within(sheet).getByRole("button", { name: "Add 2 photos" })).toBeEnabled();
  });

  // Designer on #1999: uploads stop if the page closes, so the line says to stay and the tab asks before leaving.
  it("while uploading, says to keep the page open and asks before the tab closes; not after", async () => {
    let finish: (response: Response) => void = () => {};
    const fetch = vi.fn((url: string) => url === "/api/media/sign" ? new Promise<Response>((resolve) => { finish = resolve; }) : Promise.resolve(json(200, { ok: true, asset: asset("m1", "tall") })));
    const { sheet } = setup({ fetch: fetch as never });
    await pick(["tall.jpg"]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Add 1 photo" }));
    await waitFor(() => expect(within(sheet).getByRole("status")).toHaveTextContent("Uploading 1 of 1… You can close this. Keep this page open until it finishes."));
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    finish(json(200, { ok: true, duplicate: false, id: "m1", path: "p", token: "t" }));
    await waitFor(() => expect(within(sheet).getByText("Added")).toBeInTheDocument());
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("keeps at most 10 a time with the CPO's line", async () => {
    setup();
    await pick(Array.from({ length: 12 }, (_, index) => `p${index}.jpg`));
    expect(screen.getByText("You can add up to 10 at a time. Add the rest after these finish.")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Your picks" })).getAllByRole("listitem")).toHaveLength(10);
  });

  it("uploads the usable picks on 'Add {n} photos' and adds them to the library; a duplicate says it reuses the saved copy", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (url === "/api/media/sign") return body.name === "wide" ? json(200, { ok: true, duplicate: true, asset: asset("m0", "wide") }) : json(200, { ok: true, duplicate: false, id: "m1", path: "b1/m1.jpg", token: "t" });
      return json(200, { ok: true, asset: asset("m1", "tall") });
    });
    const { uploadToSignedUrl, sheet } = setup({ fetch: fetch as never });
    await pick(["tall.jpg", "wide.jpg", "tiny.jpg"]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Add 2 photos" }));
    await waitFor(() => expect(within(sheet).getByText("Added")).toBeInTheDocument());
    expect(within(sheet).getByText("You already added this one; using the saved copy.")).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => url === "/api/media/sign")).toHaveLength(2);
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(1);
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("img", { name: "tall" })).toHaveAttribute("src", "https://example.com/m1.jpg");
  });

  it("asks for the rights tick (and the people clause for a salon) once, saves it, then uploads", async () => {
    const fetch = vi.fn(async (url: string) => url === "/api/media/consent" ? json(200, { ok: true })
      : url === "/api/media/sign" ? json(200, { ok: true, duplicate: false, id: "m1", path: "p", token: "t" }) : json(200, { ok: true, asset: asset("m1", "tall") }));
    const { sheet } = setup({ consented: false, vertical: "Bridal salon", fetch: fetch as never });
    await pick(["tall.jpg"]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Add 1 photo" }));
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Tick the box above to add your photos.");
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(within(sheet).getByRole("checkbox", { name: /I own these photos/ }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Everyone recognisable/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Add 1 photo" }));
    await waitFor(() => expect(within(sheet).getByText("Added")).toBeInTheDocument());
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ businessId: "b1", rights: true, people: true });
    expect(within(sheet).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("a failed upload says so and Try again sends it again", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(json(200, { ok: true, duplicate: false, id: "m1", path: "p", token: "t" }))
      .mockResolvedValueOnce(json(200, { ok: true, asset: asset("m1", "tall") }));
    const { sheet } = setup({ fetch });
    await pick(["tall.jpg"]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Add 1 photo" }));
    await waitFor(() => expect(within(sheet).getByText("This didn't upload. Check your connection and tap Try again.")).toBeInTheDocument());
    fireEvent.click(within(sheet).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(sheet).getByText("Added")).toBeInTheDocument());
  });
});
