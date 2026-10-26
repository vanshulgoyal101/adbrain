// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadyAdsNextStep } from "@/components/ready-ads-next-step";
import type { Creative } from "@/lib/types";

vi.mock("@/components/share-creative-button", () => ({ ShareCreativeButton: ({ creative }: { creative: Creative }) => <button type="button">Share {creative.id}</button> }));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadBlob: download }));

const BUSINESS = "927f384c-0000-4000-8000-000000000001";
const ad = (id: string) => ({ id, image_url: `https://example.test/${id}.png`, headline: `Headline ${id}` }) as Creative;

afterEach(() => vi.restoreAllMocks());

describe("<ReadyAdsNextStep>", () => {
  it("leads with sharing the newest approved ad and says plainly that launching opens soon", () => {
    render(<ReadyAdsNextStep approved={[ad("new"), ad("old")]} phone="+91 98765 43210" businessId={BUSINESS} />);
    expect(screen.getByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(screen.getByText(/Launching on Facebook and Instagram opens soon/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share new" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Your ad: Headline new" })).toHaveAttribute("src", "https://example.test/new.png");
    expect(screen.getByRole("link", { name: "See all approved ads" })).toHaveAttribute("href", "/studio?status=approved");
    expect(screen.queryByText(/top up|add money/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Connect Facebook" })).toHaveAttribute("href", "/settings");
  });

  it("downloads every approved ad as one pack", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["zip"])));
    render(<ReadyAdsNextStep approved={[ad("a"), ad("b")]} phone={null} businessId={BUSINESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Download all 2 ads" }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), "adbrain-ad-pack.zip"));
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ creativeIds: ["a", "b"] });
  });

  it("explains a failed download", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 503 }));
    render(<ReadyAdsNextStep approved={[ad("a")]} phone={null} businessId={BUSINESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Download your ad" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("didn't finish");
  });

  it("records a Facebook access request on the server and says how the owner will be reached", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
    const { rerender } = render(<ReadyAdsNextStep approved={[ad("a")]} phone="+91 98765 43210" businessId={BUSINESS} />);
    const ask = screen.getByRole("button", { name: "Ask for Facebook access" });
    expect(ask).toHaveAttribute("data-product-event", "meta.access_request");
    fireEvent.click(ask);
    expect(await screen.findByRole("status")).toHaveTextContent("We'll WhatsApp you on +91 98765 43210 within a working day");
    expect(send).toHaveBeenCalledWith("/api/meta/access-request", expect.objectContaining({ method: "POST", body: JSON.stringify({ businessId: BUSINESS }) }));
    rerender(<ReadyAdsNextStep approved={[ad("a")]} phone={null} businessId={BUSINESS} />);
    expect(screen.getByRole("status")).toHaveTextContent("Add your WhatsApp number in Brand");
  });

  // #725: never say "Request sent" unless the server recorded it.
  it("keeps the button and explains when the request didn't reach the server", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    render(<ReadyAdsNextStep approved={[ad("a")]} phone="+91 98765 43210" businessId={BUSINESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for Facebook access" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your request didn't send");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Ask for Facebook access" })).toBeEnabled();
  });
});
