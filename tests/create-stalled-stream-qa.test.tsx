// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateStreamLine } from "@/app/api/creatives/generate/route";
import { AdAssistant } from "@/components/ad-assistant";
import type { Business, Creative } from "@/lib/types";

// QA red test (#616 390 px re-walk, Oct 26 01:57Z, production): Create's stream went silent after
// the first ad (the device's network changed) and never errored or closed. The server saved all 3 ads
// at 01:58:37Z, but the phone still showed "Creating 3 ads · 16:26 elapsed · usually about a minute"
// with no error and no recovery, because nothing times out a silent stream. The route can't answer
// after its 300 s maxDuration, so after 6 silent minutes the page must stop waiting and read the
// saved results, the same recovery it already runs when the stream ends without a result line.
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: vi.fn(), updateCreativeCopy: vi.fn() }));

const business = { id: "biz-1", name: "Cedar Ridge Chiro" } as Business;
const savedAd = { id: "creative-saved", headline: "Desk tension, checked the same day", primary_text: "Book a visit.", status: "draft", angle: "Pain point" } as Creative;

function stalledCreate() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/creatives/generate" && init?.method === "POST") {
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
    }
    if (url.startsWith("/api/creatives/generate?")) return Response.json({ status: "complete", creatives: [savedAd] });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const send = async (line: CreateStreamLine) => {
    await act(async () => { controller.enqueue(new TextEncoder().encode(`${JSON.stringify(line)}\n`)); });
  };
  return { fetchMock, send };
}

describe("QA #616: a Create stream that goes silent", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    sessionStorage.setItem(`adbrain:assistant:${business.id}`, JSON.stringify({
      goal: "Invite enquiries", started: true, turns: [], answers: [], phase: "review", prepared: { brief: "Use saved brand facts." },
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("stops waiting after the route's deadline and shows the ads the server saved", async () => {
    const { fetchMock, send } = stalledCreate();
    render(<AdAssistant business={business} />);
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Generate 3 ads" })); });
    await send({ type: "progress", angleId: "pain", angleName: "Pain point", stage: "writing", at: Date.now() });
    await screen.findByLabelText("Pain point: in progress");

    // No more bytes and no close: the connection died silently.
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60_000); });

    expect(await screen.findByText("Desk tension, checked the same day")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ads being created" })).toBeNull();
    const post = fetchMock.mock.calls.find(([url, init]) => url === "/api/creatives/generate" && init?.method === "POST")!;
    const generationId = JSON.parse(post[1]!.body as string).generationId;
    const reads = fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/creatives/generate?"));
    expect(reads.length).toBeGreaterThanOrEqual(1);
    expect(new URL(reads[0][0], "http://localhost").searchParams.get("generationId")).toBe(generationId);
    // Reading saved results must never start a second generation.
    expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/creatives/generate" && init?.method === "POST")).toHaveLength(1);
  });
});
