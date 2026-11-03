// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateFlow } from "@/components/create-flow";
import type { MediaView } from "@/lib/media/store";
import type { Business } from "@/lib/types";
import hi from "../messages/hi.json";

// #780 slice 2b: with library photos picked, the owner can write each ad's words himself; no AI call.
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: vi.fn(), updateCreativeCopy: vi.fn() }));

const business = { id: "biz-780", name: "Glow Salon" } as Business;
const photo = (id: string, name: string) => ({
  id, kind: "image", name, tags: [], width: 1080, height: 1350, bytes: 1, durationMs: null, fit: null,
  url: `https://example.com/${id}.jpg`, createdAt: "2026-11-03T00:00:00Z",
}) as MediaView;
const photos = [photo("11111111-1111-4111-8111-111111111111", "Shop front"), photo("22222222-2222-4222-8222-222222222222", "Chair")];
const type = (label: string, index: number, value: string) => fireEvent.change(screen.getAllByLabelText(label)[index], { target: { value } });

describe("<CreateFlow> I'll write them (#780 slice 2b)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("swaps the assistant for one card per photo, posts the owner's words, then offers the campaign", async () => {
    const fetch = vi.fn(async () => Response.json({
      variantGroup: "g", failed: 0,
      creatives: [{ id: "c1", headline: "Haircut ₹149", image_url: "https://store/c1.webp" }, { id: "c2", headline: "New chairs", image_url: null }],
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
    expect(JSON.parse(String(init.body))).toEqual({
      businessId: business.id,
      items: [
        { mediaId: photos[0].id, headline: "Haircut ₹149", primary_text: "Walk in today.", description: "", cta: "Get Quote", offer: true },
        { mediaId: photos[1].id, headline: "New chairs", primary_text: "Come see them.", description: "", cta: "Call Now", offer: false },
      ],
    });

    expect(await screen.findByRole("status")).toHaveTextContent("2 ads saved");
    expect(screen.getByText("Check this claim: guaranteed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /campaign/i })).toHaveAttribute("href", "/campaigns?new=1&creatives=c1,c2&review=1");
    expect(screen.getByRole("list", { name: "Steps to an ad" }).querySelector('[aria-current="step"]')?.textContent).toBe("Create");
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Remove photo/ })).toBeNull();
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

  it("says the choice and the form in Hindi", () => {
    render(<CreateFlow business={business} opening={null} photos={[photos[0]]} words={{ locale: "hi", messages: hi.create }}><aside /></CreateFlow>);
    fireEvent.click(screen.getByRole("radio", { name: hi.create.wordsMine }));
    expect(screen.getByRole("form", { name: hi.create.ownFormLabel })).toHaveAttribute("lang", "hi");
    expect(screen.getByLabelText(hi.create.ownHeadline)).toBeInTheDocument();
    expect(screen.queryByText(/I'll write them|Headline|Main text/)).toBeNull();
  });
});
