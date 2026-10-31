// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "@/components/studio";
import { shareText } from "@/lib/share-creative";
import type { Business, Creative } from "@/lib/types";

/** #337: share an approved ad's picture and text to WhatsApp or Instagram. */

const h = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: vi.fn(), deleteCreative: vi.fn(), updateCreativeCopy: vi.fn() }));
vi.mock("@/lib/download", () => ({ downloadBlob: h.downloadBlob }));

const business = { id: "b1", name: "Solaride" } as unknown as Business;
const ad = (over: Partial<Creative> = {}) => ({
  id: "c1", business_id: "b1", brief: "x", angle: "savings", status: "approved",
  image_url: "https://cdn.example/creatives/b1/g1/offer-ad.png",
  headline: "Cut your power bill", primary_text: "Rooftop solar for Jaipur homes.\nFree site visit.", cta: "Get Quote",
  ...over,
}) as unknown as Creative;

const share = vi.fn();
const canShare = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "canShare");
});

function phone() {
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: canShare });
  canShare.mockReturnValue(true);
}

function webpPicture() {
  global.fetch = vi.fn(async () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "content-type": "image/webp" } }));
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1200, height: 900, close }));
  const context: Partial<CanvasRenderingContext2D> = {
    drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: "",
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as CanvasRenderingContext2D);
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    callback(new Blob(["jpeg"], { type: "image/jpeg" }));
  });
  return { close, encode };
}

const shareButton = () => screen.getByRole("button", { name: "Share to WhatsApp or Instagram" });

describe("Share an approved ad (#337)", () => {
  it("builds the post text from the headline and main text", () => {
    expect(shareText(ad())).toBe("Cut your power bill\n\nRooftop solar for Jaipur homes.\nFree site visit.");
    expect(shareText(ad({ headline: null }))).toBe("Rooftop solar for Jaipur homes.\nFree site visit.");
  });

  it("#1317: isn't offered on a prospect's sample ads, so no clean picture leaves AdBrain", () => {
    render(<Studio business={business} initialCreatives={[ad()]} sample />);
    expect(screen.queryByRole("button", { name: /Share to WhatsApp or Instagram/ })).not.toBeInTheDocument();
  });

  it("is offered only on approved ads", () => {
    render(<Studio business={business} initialCreatives={[ad({ status: "draft" })]} />);
    expect(screen.queryByRole("button", { name: "Share to WhatsApp or Instagram" })).toBeNull();
  });

  it("opens the phone's share sheet with the picture and the text", async () => {
    phone();
    share.mockResolvedValue(undefined);
    render(<Studio business={business} initialCreatives={[ad()]} />);
    await userEvent.setup().click(shareButton());
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const data = share.mock.calls[0][0] as ShareData;
    expect(data.text).toBe(shareText(ad()));
    expect(data.files?.[0]).toBeInstanceOf(File);
    expect(data.files?.[0]).toMatchObject({ name: "cut-your-power-bill.png", type: "image/png" });
    expect(global.fetch).toHaveBeenCalledWith("https://cdn.example/creatives/b1/g1/offer-ad.png");
    expect(h.downloadBlob).not.toHaveBeenCalled();
    expect(shareButton()).toHaveAttribute("data-product-event", "creative.share");
  });

  it("says nothing when the owner closes the share sheet", async () => {
    phone();
    share.mockRejectedValue(new DOMException("closed", "AbortError"));
    render(<Studio business={business} initialCreatives={[ad()]} />);
    await userEvent.setup().click(shareButton());
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(h.downloadBlob).not.toHaveBeenCalled();
  });

  it("asks for a second tap when the phone refused because the picture took too long", async () => {
    phone();
    share.mockRejectedValueOnce(new DOMException("no gesture", "NotAllowedError")).mockResolvedValueOnce(undefined);
    render(<Studio business={business} initialCreatives={[ad()]} />);
    const user = userEvent.setup();
    await user.click(shareButton());
    expect(await screen.findByText("Your picture is ready. Tap Share again.")).toBeInTheDocument();
    await user.click(shareButton());
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("on a desktop, downloads the picture and copies the text", async () => {
    render(<Studio business={business} initialCreatives={[ad()]} />);
    await userEvent.setup().click(shareButton());
    expect(await screen.findByText("Picture downloaded and text copied. Paste it with the picture.")).toBeInTheDocument();
    expect(h.downloadBlob).toHaveBeenCalledWith(expect.any(File), "cut-your-power-bill.png");
    expect(await navigator.clipboard.readText()).toBe(shareText(ad()));
  });

  it("#2016: shares a WebP-stored ad as a JPEG file", async () => {
    const { close } = webpPicture();
    phone();
    share.mockResolvedValue(undefined);
    render(<Studio business={business} initialCreatives={[ad({ image_url: "https://cdn.example/ad.webp" })]} />);
    await userEvent.setup().click(shareButton());
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const data = share.mock.calls[0][0] as ShareData;
    expect(data.files?.[0]).toMatchObject({ name: "cut-your-power-bill.jpg", type: "image/jpeg" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(h.downloadBlob).not.toHaveBeenCalled();
  });

  it("#2016: the desktop fallback also downloads JPEG, not WebP", async () => {
    webpPicture();
    render(<Studio business={business} initialCreatives={[ad({ image_url: "https://cdn.example/ad.webp" })]} />);
    await userEvent.setup().click(shareButton());
    expect(await screen.findByText("Picture downloaded and text copied. Paste it with the picture.")).toBeInTheDocument();
    expect(h.downloadBlob).toHaveBeenCalledWith(
      expect.objectContaining({ name: "cut-your-power-bill.jpg", type: "image/jpeg" }),
      "cut-your-power-bill.jpg",
    );
  });

  it.each(["empty", "wrong type", "no context", "decode failed"])("#2016: reports %s conversion instead of sharing the original WebP", async (failure) => {
    const { close, encode } = webpPicture();
    if (failure === "empty") encode.mockImplementation((callback) => callback(null));
    if (failure === "wrong type") encode.mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })));
    if (failure === "no context") vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    if (failure === "decode failed") vi.mocked(createImageBitmap).mockRejectedValue(new Error("Cannot decode WebP"));
    phone();
    render(<Studio business={business} initialCreatives={[ad({ image_url: "https://cdn.example/ad.webp" })]} />);
    await userEvent.setup().click(shareButton());
    expect(await screen.findByText("Couldn't prepare the picture. Check your connection and try again.")).toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
    expect(h.downloadBlob).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(failure === "decode failed" ? 0 : 1);
  });

  it("explains when the picture can't be fetched", async () => {
    global.fetch = vi.fn(async () => new Response("gone", { status: 404 })) as unknown as typeof fetch;
    render(<Studio business={business} initialCreatives={[ad()]} />);
    await userEvent.setup().click(shareButton());
    expect(await screen.findByText("Couldn't prepare the picture. Check your connection and try again.")).toBeInTheDocument();
    expect(h.downloadBlob).not.toHaveBeenCalled();
  });
});
