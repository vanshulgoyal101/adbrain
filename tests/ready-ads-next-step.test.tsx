// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadyAdsNextStep } from "@/components/ready-ads-next-step";
import type { Creative } from "@/lib/types";
import hi from "../messages/hi.json";

vi.mock("@/components/share-creative-button", () => ({ ShareCreativeButton: ({ creative }: { creative: Creative }) => <button type="button">Share {creative.id}</button> }));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/download", () => ({ downloadBlob: download }));

const BUSINESS = "927f384c-0000-4000-8000-000000000001";
const ad = (id: string) => ({ id, image_url: `https://example.test/${id}.png`, headline: `Headline ${id}` }) as Creative;

afterEach(() => vi.restoreAllMocks());

describe("<ReadyAdsNextStep>", () => {
  const pending = "Connecting a new Facebook account requires Meta approval for AdBrain. You can make, approve and download ads now.";
  const requested = "Your request is recorded. You can connect Facebook once Meta approves AdBrain. Until then, your approved ads stay here for you to download and share.";
  const pendingHi = "नया Facebook अकाउंट जोड़ने के लिए AdBrain को Meta की मंज़ूरी चाहिए। आप अभी विज्ञापन बना, मंज़ूर और डाउनलोड कर सकते हैं।";
  const requestedHi = "आपका अनुरोध दर्ज हो गया है। Meta से AdBrain को मंज़ूरी मिलने के बाद आप Facebook जोड़ सकेंगे। तब तक आपके मंज़ूर किए गए विज्ञापन यहीं रहेंगे, ताकि आप उन्हें डाउनलोड करके शेयर कर सकें।";
  const obsolete = /Tester|invite|working day|this week|opens soon|WhatsApp you|still reviewing|approval is still pending|we'll (notify|message|email)/i;

  it("leads with sharing the newest approved ad and explains Facebook access", () => {
    const { container } = render(<ReadyAdsNextStep approved={[ad("new"), ad("old")]} businessId={BUSINESS} />);
    expect(screen.getByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(screen.getByText(pending)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(obsolete);
    expect(screen.getByRole("button", { name: "Share new" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Your ad: Headline new" })).toHaveAttribute("src", "https://example.test/new.png");
    expect(screen.getByRole("link", { name: "See all approved ads" })).toHaveAttribute("href", "/studio?status=approved");
    expect(screen.queryByText(/top up|add money/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Connect Facebook" })).toHaveAttribute("href", "/settings");
  });

  it("#1317: a prospect's sample ads have no Share; Download all stays (the export marks each picture)", () => {
    render(<ReadyAdsNextStep approved={[ad("new")]} businessId={BUSINESS} sample />);
    expect(screen.queryByRole("button", { name: "Share new" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download your ad" })).toBeInTheDocument();
  });

  it("downloads every approved ad as one pack", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["zip"])));
    render(<ReadyAdsNextStep approved={[ad("a"), ad("b")]} businessId={BUSINESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Download all 2 ads" }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), "adbrain-ad-pack.zip"));
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ creativeIds: ["a", "b"] });
  });

  it("explains a failed download", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 503 }));
    render(<ReadyAdsNextStep approved={[ad("a")]} businessId={BUSINESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Download your ad" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("didn't finish");
  });

  it("records a Facebook access request on the server and explains what happens next", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
    const { container } = render(<ReadyAdsNextStep approved={[ad("a")]} businessId={BUSINESS} />);
    const ask = screen.getByRole("button", { name: "Ask for Facebook access" });
    expect(ask).toHaveAttribute("data-product-event", "meta.access_request");
    fireEvent.click(ask);
    expect(await screen.findByRole("status")).toHaveTextContent(requested);
    expect(screen.getByText(pending)).toBeInTheDocument();
    expect(send).toHaveBeenCalledWith("/api/meta/access-request", expect.objectContaining({ method: "POST", body: JSON.stringify({ businessId: BUSINESS }) }));
    expect(container.textContent).not.toMatch(obsolete);
    expect(screen.getByRole("link", { name: "Connect Facebook" })).toHaveAttribute("href", "/settings");
  });

  // #725: never say "Request sent" unless the server recorded it.
  it("keeps the button and explains when the request didn't reach the server", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    render(<ReadyAdsNextStep approved={[ad("a")]} businessId={BUSINESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for Facebook access" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your request did not send. Check your connection and try again.");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Ask for Facebook access" })).toBeEnabled();
  });

  it("after App Review (review-pending=false): Connect Facebook, no request and no review notice", () => {
    const send = vi.spyOn(globalThis, "fetch");
    const { container } = render(<ReadyAdsNextStep approved={[ad("a")]} businessId={BUSINESS} appReviewPending={false} />);
    expect(screen.getByText(/^Connect Facebook to run them on Facebook and Instagram/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Facebook" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("button", { name: "Ask for Facebook access" })).toBeNull();
    expect(container.textContent).not.toMatch(/still reviewing/);
    expect(send).not.toHaveBeenCalled();
  });

  it("Hindi: the same access status, request and failure, in the owner's language", async () => {
    const words = { locale: "hi" as const, messages: hi.setup };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json({ ok: true }));
    render(<ReadyAdsNextStep approved={[ad("a")]} businessId={BUSINESS} words={words} />);
    expect(screen.getByRole("heading", { name: hi.setup.readyAds.title })).toBeInTheDocument();
    expect(screen.getByText(pendingHi)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: hi.setup.readyAds.ask }));
    expect(await screen.findByRole("alert")).toHaveTextContent(hi.setup.access.requestFailed);
    fireEvent.click(screen.getByRole("button", { name: hi.setup.readyAds.ask }));
    expect(await screen.findByRole("status")).toHaveTextContent(requestedHi);
    expect(screen.getByText(pendingHi)).toBeInTheDocument();
  });
});
