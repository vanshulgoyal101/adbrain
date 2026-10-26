// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateStreamLine } from "@/app/api/creatives/generate/route";
import { AdAssistant } from "@/components/ad-assistant";
import type { Business, Creative } from "@/lib/types";

// #760 CPO walk: 2 of 3 ads were ready at 57 s, but the owner waited until 2:16 for the third
// (which then failed). Once 2 ads are saved, the owner can move on with them while the third keeps
// going on the server; nothing is cancelled and no second generation starts.
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: vi.fn(), updateCreativeCopy: vi.fn() }));

const business = { id: "biz-1", name: "Cedar Ridge Chiro" } as Business;
const ad = (id: string, headline: string, angle: string) =>
  ({ id, headline, primary_text: "Book a visit.", status: "draft", angle }) as Creative & { headline: string };
const pain = ad("creative-pain", "Desk tension, checked the same day", "Pain point");
const proof = ad("creative-proof", "Trusted by 400 local families", "Social proof");
const offer = ad("creative-offer", "First visit, clear plan", "Offer");

function liveCreate() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/creatives/generate" && init?.method === "POST") {
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const send = async (line: CreateStreamLine) => {
    await act(async () => { controller.enqueue(new TextEncoder().encode(`${JSON.stringify(line)}\n`)); });
  };
  const posts = () => fetchMock.mock.calls.filter(([url, init]) => url === "/api/creatives/generate" && init?.method === "POST");
  return { send, posts };
}

async function startCreate() {
  const create = liveCreate();
  render(<AdAssistant business={business} />);
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Generate 3 ads" })); });
  await create.send({ type: "progress", angleId: "pain", angleName: "Pain point", stage: "ready", at: Date.now() });
  await create.send({ type: "creative", angleId: "pain", creative: pain });
  return create;
}

describe("#760: use the ready ads while the last one finishes", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    sessionStorage.setItem(`adbrain:assistant:${business.id}`, JSON.stringify({
      goal: "Invite enquiries", started: true, turns: [], answers: [], phase: "review", prepared: { brief: "Use saved brand facts." },
    }));
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("offers the 2 saved ads, shows them, then quietly adds the third from the same request", async () => {
    const { send, posts } = await startCreate();
    await send({ type: "progress", angleId: "proof", angleName: "Social proof", stage: "ready", at: Date.now() });
    await send({ type: "creative", angleId: "proof", creative: proof });
    await send({ type: "progress", angleId: "offer", angleName: "Offer", stage: "image", at: Date.now() });

    const use = await screen.findByRole("button", { name: "Use these 2 now" });
    await act(async () => { fireEvent.click(use); });

    expect(screen.queryByRole("region", { name: "Ads being created" })).toBeNull();
    expect(screen.getByText(pain.headline)).toBeInTheDocument();
    expect(screen.getByText(proof.headline)).toBeInTheDocument();
    expect(screen.queryByText(offer.headline)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/1 more ad is still being made/);
    expect(posts()).toHaveLength(1);
    // Starting over mid-request would be ignored, so it waits until the last ad lands.
    expect(screen.getByRole("button", { name: /Make another/ })).toBeDisabled();

    await send({ type: "progress", angleId: "offer", angleName: "Offer", stage: "ready", at: Date.now() });
    await send({ type: "creative", angleId: "offer", creative: offer });
    await send({ type: "result", status: 200, body: { creatives: [proof, offer, pain] } });

    expect(await screen.findByText(offer.headline)).toBeInTheDocument();
    expect(screen.getAllByText(pain.headline)).toHaveLength(1);
    expect(screen.getAllByText(proof.headline)).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Ads being created" })).toBeNull();
    expect(screen.queryByText(/still being made/)).toBeNull();
    expect(screen.getByRole("button", { name: /Make another/ })).toBeEnabled();
    expect(posts()).toHaveLength(1);
  });

  it("keeps the 2 shown ads when the third fails, and offers to make it", async () => {
    const { send, posts } = await startCreate();
    await send({ type: "creative", angleId: "proof", creative: proof });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use these 2 now" })); });

    await send({ type: "progress", angleId: "offer", angleName: "Offer", stage: "failed", at: Date.now() });
    await send({ type: "result", status: 200, body: { creatives: [pain, proof] } });

    expect(await screen.findByText(/1 of 3 ads couldn.t be made this time/)).toBeInTheDocument();
    expect(screen.getAllByText(pain.headline)).toHaveLength(1);
    expect(screen.getAllByText(proof.headline)).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it("does not offer to move on with only one saved ad", async () => {
    const { send } = await startCreate();
    await send({ type: "progress", angleId: "proof", angleName: "Social proof", stage: "image", at: Date.now() });
    expect(screen.getByRole("region", { name: "Ads being created" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use these/ })).toBeNull();
  });
});
