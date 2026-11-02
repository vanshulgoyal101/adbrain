// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultsCardOffer } from "@/components/results-card-offer";
import en from "../messages/en.json";

const share = vi.hoisted(() => vi.fn());
vi.mock("@/lib/share-creative", () => ({ shareCreative: share }));

const businessId = "11111111-1111-4111-8111-111111111111";
const words = { ...en.resultsCard, body: en.resultsCard.body.replace("{n}", "6") };
const caption = "6 people in Sector 70 enquired with us this week\nWhatsApp us: +91 98765 43210";
const posted = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls
  .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
  .map(([, init]) => JSON.parse((init as RequestInit).body as string).event);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  share.mockReset();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:card", revokeObjectURL: () => {} }));
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => init?.method === "POST"
    ? Response.json({ ok: true })
    : new Response(new Blob([new Uint8Array([0xff, 0xd8])], { type: "image/jpeg" }), { headers: { "content-type": "image/jpeg" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Home: weekly results card (#2036)", () => {
  it("previews the card, shares it with the caption and hides after sharing", async () => {
    share.mockResolvedValue({ kind: "shared" });
    const { container } = render(<ResultsCardOffer businessId={businessId} caption={caption} words={words} />);
    expect(screen.getByText("Good week. Share it?")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Your results card" })).toHaveAttribute("src", "blob:card");
    fireEvent.click(screen.getByRole("button", { name: "Share card" }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(share).toHaveBeenCalledWith({ headline: null, primary_text: caption, image_url: null }, expect.any(File));
    expect(posted(fetchMock)).toEqual(["shown", "shared"]);
  });

  it("stays when the share sheet is closed", async () => {
    share.mockResolvedValue({ kind: "cancelled" });
    render(<ResultsCardOffer businessId={businessId} caption={caption} words={words} />);
    await screen.findByRole("img", { name: "Your results card" });
    fireEvent.click(screen.getByRole("button", { name: "Share card" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Share card" })).toBeEnabled());
    expect(posted(fetchMock)).toEqual(["shown"]);
  });

  it("'Not this week' records a dismissal and hides; shown is recorded once per session", async () => {
    render(<ResultsCardOffer businessId={businessId} caption={caption} words={words} />).unmount();
    const again = render(<ResultsCardOffer businessId={businessId} caption={caption} words={words} />);
    fireEvent.click(screen.getByRole("button", { name: "Not this week" }));
    await waitFor(() => expect(again.container).toBeEmptyDOMElement());
    expect(posted(fetchMock)).toEqual(["shown", "dismissed"]);
  });

  it("switching off the footer fetches the card without it", async () => {
    render(<ResultsCardOffer businessId={businessId} caption={caption} words={words} />);
    await screen.findByRole("img", { name: "Your results card" });
    fireEvent.click(screen.getByRole("checkbox", { name: 'Show "Made with AdBrain"' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/results-card?businessId=${businessId}&footer=0`));
  });

  it("says so when the card can't be made", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST" ? Response.json({ ok: true }) : new Response(null, { status: 503 }));
    render(<ResultsCardOffer businessId={businessId} caption={caption} words={words} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The card couldn't be made. Try again.");
    expect(screen.getByRole("button", { name: "Share card" })).toBeDisabled();
  });
});
