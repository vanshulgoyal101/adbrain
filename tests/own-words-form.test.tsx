// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateFlow } from "@/components/create-flow";
import type { MediaView } from "@/lib/media/store";
import type { Business } from "@/lib/types";
import hi from "../messages/hi.json";

// #780 slice 2b: with library photos picked, the owner can write each ad's words himself; no AI call.
const status = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: status, updateCreativeCopy: vi.fn() }));
vi.mock("@/components/ad-assistant", () => ({ AdAssistant: () => <div>AI assistant</div> }));

const business = { id: "biz-780", name: "Glow Salon" } as Business;
const photo = (id: string, name: string) => ({
  id, kind: "image", name, tags: [], width: 1080, height: 1350, bytes: 1, durationMs: null, fit: null,
  url: `https://example.com/${id}.jpg`, createdAt: "2026-11-03T00:00:00Z",
}) as MediaView;
const photos = [photo("11111111-1111-4111-8111-111111111111", "Shop front"), photo("22222222-2222-4222-8222-222222222222", "Chair")];
const clip = {
  id: "33333333-3333-4333-8333-333333333333", kind: "video", name: "Bridal reel", tags: [], width: 1080, height: 1920, bytes: 1,
  durationMs: 30_000, fit: null, url: "https://example.com/bridal.mp4", createdAt: "2026-11-03T00:00:00Z",
} as MediaView;
const type = (label: string, index: number, value: string) => fireEvent.change(screen.getAllByLabelText(label)[index], { target: { value } });

describe("<CreateFlow> I'll write them (#780 slice 2b)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    status.mockReset().mockResolvedValue({ ok: true });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("saves drafts and sends only explicitly selected, approved ads to the full campaign Review", async () => {
    const fetch = vi.fn(async () => Response.json({
      variantGroup: "g", failed: 0,
      creatives: [{ id: "c1", headline: "Haircut ₹149", image_url: "https://store/c1.webp", status: "draft" }, { id: "c2", headline: "New chairs", image_url: null, status: "draft" }],
      warnings: [["Check this claim: guaranteed."], []],
    }));
    vi.stubGlobal("fetch", fetch);
    render(<CreateFlow business={business} opening={null} photos={photos}><aside>Brand context</aside></CreateFlow>);

    const choice = screen.getByRole("radiogroup", { name: "Who writes the words" });
    expect(within(choice).getByRole("radio", { name: "Write the words for me" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("form", { name: "Your words for each ad" })).toBeNull();
    fireEvent.click(within(choice).getByRole("radio", { name: "I'll write them" }));
    const form = screen.getByRole("form", { name: "Your words for each ad" });
    expect(screen.getByText("Type the words for each photo’s ad. No AI is used.")).toBeInTheDocument();
    expect(within(form).getAllByRole("group")).toHaveLength(2);

    const save = screen.getByRole("button", { name: "Save 2 ads" });
    expect(save).toBeDisabled();
    type("Headline", 0, "Haircut ₹149");
    type("Main text", 0, "Walk in today.");
    type("Headline", 1, "New chairs");
    type("Main text", 1, "Come see them.");
    fireEvent.change(screen.getAllByLabelText("Button")[1], { target: { value: "Call Now" } });
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Put the headline on the photo" })[0]);
    expect(save).toBeEnabled();
    await act(async () => { fireEvent.click(save); });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/creatives/own");
    const request = JSON.parse(String(init.body));
    expect(request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect({ ...request, idempotencyKey: undefined }).toEqual({
      businessId: business.id,
      items: [
        { mediaId: photos[0].id, headline: "Haircut ₹149", primary_text: "Walk in today.", description: "", cta: "Get Quote", offer: true },
        { mediaId: photos[1].id, headline: "New chairs", primary_text: "Come see them.", description: "", cta: "Call Now", offer: false },
      ],
    });

    expect(await screen.findByRole("status")).toHaveTextContent("2 ads saved");
    expect(screen.getByText("Check this claim: guaranteed.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /campaign/i })).toBeNull();
    expect(status).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tap to pick: Haircut ₹149" }));
    await waitFor(() => expect(status).toHaveBeenCalledWith("c1", "approved"));
    expect(await screen.findByRole("button", { name: "Picked: Haircut ₹149" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: /campaign/i })).toHaveAttribute("href", "/campaigns?all=1&new=1&creatives=c1&review=1");
    fireEvent.click(screen.getByRole("button", { name: "Tap to pick: New chairs" }));
    await screen.findByRole("button", { name: "Picked: New chairs" });
    expect(screen.getByRole("link", { name: /campaign/i })).toHaveAttribute("href", "/campaigns?all=1&new=1&creatives=c1,c2&review=1");
    fireEvent.click(screen.getByRole("button", { name: "Picked: Haircut ₹149" }));
    await screen.findByRole("button", { name: "Tap to pick: Haircut ₹149" });
    expect(status).toHaveBeenCalledWith("c1", "draft");
    expect(screen.getByRole("link", { name: /campaign/i })).toHaveAttribute("href", "/campaigns?all=1&new=1&creatives=c2&review=1");
    expect(screen.getByRole("list", { name: "Steps to an ad" }).querySelector('[aria-current="step"]')?.textContent).toBe("Create");
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Remove photo/ })).toBeNull();
  });

  it("uses owner-written words for video, with no AI mode or image overlay", async () => {
    const fetch = vi.fn(async () => Response.json({
      creatives: [{ id: "cv1", media_asset_id: clip.id, headline: "Bridal reel", image_url: null, status: "draft" }],
      warnings: [[]],
    }));
    vi.stubGlobal("fetch", fetch);
    render(<CreateFlow business={business} opening={null} media={[clip]} overlayAvailable><aside /></CreateFlow>);

    expect(screen.queryByText("AI assistant")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Who writes the words" })).toBeNull();
    expect(screen.getByRole("form", { name: "Your words for each ad" })).toBeInTheDocument();
    expect(screen.getByLabelText("Picked video 1")).toHaveAttribute("src", clip.url);
    expect(screen.queryByRole("checkbox", { name: "Put the headline on the photo" })).toBeNull();
    type("Headline", 0, "Bridal reel");
    type("Main text", 0, "See our latest work.");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save ad" })); });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const request = JSON.parse(String(init.body));
    expect(request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect({ ...request, idempotencyKey: undefined }).toEqual({
      businessId: business.id,
      items: [{ mediaId: clip.id, headline: "Bridal reel", primary_text: "See our latest work.", description: "", cta: "Get Quote", offer: false }],
    });
    expect(screen.getByLabelText("Saved video")).toHaveAttribute("src", clip.url);
  });

  it("holds the Review link while a choice is saving and never selects an ad when approval fails", async () => {
    let finish!: (result: { ok: boolean }) => void;
    status.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      creatives: [{ id: "c1", headline: "Haircut ₹149", image_url: null, status: "draft" }], warnings: [[]],
    })));
    render(<CreateFlow business={business} opening={null} photos={[photos[0]]}><aside /></CreateFlow>);
    fireEvent.click(screen.getByRole("radio", { name: "I'll write them" }));
    type("Headline", 0, "Haircut ₹149");
    type("Main text", 0, "Walk in today.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save ad" })); });

    fireEvent.click(screen.getByRole("button", { name: "Tap to pick: Haircut ₹149" }));
    expect(screen.getByRole("button", { name: "Tap to pick: Haircut ₹149" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /campaign/i })).toBeNull();
    await act(async () => { finish({ ok: false }); });
    expect(screen.getByRole("alert")).toHaveTextContent("Your choice wasn't saved. Tap it again.");
    expect(screen.getByRole("button", { name: "Tap to pick: Haircut ₹149" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("link", { name: /campaign/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tap to pick: Haircut ₹149" }));
    await screen.findByRole("button", { name: "Picked: Haircut ₹149" });
    expect(screen.getByRole("link", { name: /campaign/i })).toHaveAttribute("href", "/campaigns?all=1&new=1&creatives=c1&review=1");
  });

  it("keeps the last photo in own-words mode, shows the error and leaves the words for another try", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "This photo isn't ready yet." }, { status: 409 })));
    render(<CreateFlow business={business} opening={null} photos={[photos[0]]}><aside /></CreateFlow>);
    fireEvent.click(screen.getByRole("radio", { name: "I'll write them" }));
    expect(screen.queryByRole("button", { name: "Remove photo 1" })).toBeNull();
    type("Headline", 0, "Haircut ₹149");
    type("Main text", 0, "Walk in today.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save ad" })); });
    expect(screen.getByRole("alert")).toHaveTextContent("This photo isn't ready yet.");
    expect(screen.getByLabelText("Headline")).toHaveValue("Haircut ₹149");
    fireEvent.click(screen.getByRole("radio", { name: "Write the words for me" }));
    expect(screen.getByRole("button", { name: "Remove photo 1" })).toBeInTheDocument();
  });

  it("shows a policy fix and keeps the owner's words in the form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      code: "OWN_WORDS_COPY_REJECTED", index: 0, field: "headline",
      error: 'Ad 1, Headline: "guaranteed" is a promise Meta rejects. Reword it.',
    }, { status: 422 })));
    render(<CreateFlow business={business} opening={null} photos={[photos[0]]}><aside /></CreateFlow>);
    fireEvent.click(screen.getByRole("radio", { name: "I'll write them" }));
    type("Headline", 0, "Guaranteed visa");
    type("Main text", 0, "Apply today.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save ad" })); });
    expect(screen.getByRole("alert")).toHaveTextContent(/headline.*guaranteed.*reword/i);
    expect(screen.getByLabelText("Headline")).toHaveValue("Guaranteed visa");
    expect(screen.getByRole("button", { name: "Save ad" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: /campaign/i })).toBeNull();
  });

  it("locks submitted photos and words while saving, then unlocks them if saving fails", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    render(<CreateFlow business={business} opening={null} photos={photos}><aside /></CreateFlow>);
    fireEvent.click(screen.getByRole("radio", { name: "I'll write them" }));
    type("Headline", 0, "Haircut ₹149");
    type("Main text", 0, "Walk in today.");
    type("Headline", 1, "New chairs");
    type("Main text", 1, "Come see them.");
    fireEvent.click(screen.getByRole("button", { name: "Save 2 ads" }));

    expect(screen.getByRole("radio", { name: "Write the words for me" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "I'll write them" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Remove photo/ })).toBeNull();
    expect(screen.getAllByLabelText("Headline")[0]).toBeDisabled();
    expect(screen.getAllByLabelText("Main text")[1]).toBeDisabled();
    expect(screen.getAllByLabelText("Button")[0]).toBeDisabled();
    expect(screen.getAllByRole("checkbox", { name: "Put the headline on the photo" })[0]).toBeDisabled();

    await act(async () => { finish(Response.json({ error: "Save unavailable. Try again." }, { status: 503 })); });
    expect(screen.getByRole("alert")).toHaveTextContent("Save unavailable. Try again.");
    expect(screen.getByRole("radio", { name: "Write the words for me" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove photo 1" })).toBeEnabled();
    expect(screen.getAllByLabelText("Headline")[0]).toBeEnabled();
    expect(screen.getAllByLabelText("Headline")[0]).toHaveValue("Haircut ₹149");
    expect(screen.getByRole("button", { name: "Save 2 ads" })).toBeEnabled();
  });

  it("does not offer on-photo text when drawing is disabled", () => {
    render(<CreateFlow business={business} opening={null} photos={[photos[0]]} overlayAvailable={false}><aside /></CreateFlow>);
    fireEvent.click(screen.getByRole("radio", { name: "I'll write them" }));
    expect(screen.queryByRole("checkbox", { name: "Put the headline on the photo" })).toBeNull();
  });

  it("says the choice, form and ad selection in Hindi", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      creatives: [{ id: "c1", headline: "मेरी दुकान", image_url: null, status: "draft" }], warnings: [[]],
    })));
    render(<CreateFlow business={business} opening={null} photos={[photos[0]]} words={{ locale: "hi", messages: hi.create }}
      photoPickWords={hi.setup.ads}><aside /></CreateFlow>);
    fireEvent.click(screen.getByRole("radio", { name: hi.create.wordsMine }));
    expect(screen.getByRole("form", { name: hi.create.ownFormLabel })).toHaveAttribute("lang", "hi");
    expect(screen.getByLabelText(hi.create.ownHeadline)).toBeInTheDocument();
    expect(screen.queryByText(/I'll write them|Headline|Main text/)).toBeNull();
    type(hi.create.ownHeadline, 0, "मेरी दुकान");
    type(hi.create.ownMainText, 0, "आज आइए।");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "विज्ञापन सेव करें" })); });
    fireEvent.click(screen.getByRole("button", { name: `${hi.setup.ads.tapToPick}: मेरी दुकान` }));
    expect(await screen.findByRole("button", { name: `${hi.setup.ads.picked}: मेरी दुकान` })).toHaveAttribute("aria-pressed", "true");
  });
});
