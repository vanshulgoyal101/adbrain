// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateStreamLine } from "@/app/api/creatives/generate/route";
import { AdAssistant } from "@/components/ad-assistant";
import type { Business, Creative } from "@/lib/types";

const actions = vi.hoisted(() => ({ setCreativeStatus: vi.fn(), updateCreativeCopy: vi.fn() }));
vi.mock("@/app/(app)/studio/actions", () => actions);

const business = { id: "biz-1", name: "Cedar Ridge Chiro" } as Business;

const proofAd = { id: "creative-proof", headline: "Trusted by 400 local families", primary_text: "Book a visit.", status: "draft", angle: "Customer proof" } as Creative;

function reviewDraft() {
  sessionStorage.setItem(`adbrain:assistant:${business.id}`, JSON.stringify({
    goal: "Invite enquiries", started: true, turns: [], answers: [], phase: "review",
    prepared: { brief: "Use saved brand facts." },
  }));
}

function streamedCreate() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const encoder = new TextEncoder();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/creatives/generate" && init?.method === "POST") {
      return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
    }
    if (url.startsWith("/api/creatives/generate?")) {
      return Response.json({ status: "complete", creatives: [proofAd] });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const send = async (...lines: CreateStreamLine[]) => {
    await act(async () => {
      for (const line of lines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
    });
  };
  // Enqueue and close in one tick: the client cancels the reader once it sees the result line.
  const close = async (...lines: CreateStreamLine[]) => {
    await act(async () => {
      for (const line of lines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      controller.close();
    });
  };
  return { fetchMock, send, close };
}

const progress = (angleId: string, angleName: string, stage: Extract<CreateStreamLine, { type: "progress" }>["stage"]): CreateStreamLine =>
  ({ type: "progress", angleId, angleName, stage, at: Date.now() });

function activeStep(card: HTMLElement) {
  return card.querySelector('[aria-current="step"]')?.textContent;
}

async function startGenerating() {
  render(<AdAssistant business={business} />);
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Generate 3 ads" })); });
}

describe("<AdAssistant> live Create progress", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    reviewDraft();
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  // jsdom has no layout: the phone rule is the sticky offset below the 60–65 px workspace header (#344).
  it("keeps 'Creating 3 ads · elapsed' below the sticky top bar while generating (#344)", async () => {
    streamedCreate();
    await startGenerating();
    const section = await screen.findByRole("region", { name: "Ads being created" });
    const line = within(section).getByText("Creating 3 ads").closest(".sticky");
    expect(line).toHaveClass("top-[68px]", "lg:top-0");
    expect(line).not.toHaveClass("top-0");
  });

  // #1123: the route remakes a failed ad in the same request; its slot goes back to work.
  it("says 'Making 1 more…' and puts the failed slot back in progress during a top-up", async () => {
    const { send } = streamedCreate();
    await startGenerating();
    await send(
      progress("proof", "Customer proof", "queued"),
      progress("value", "Clear value", "queued"),
      progress("story", "Founder story", "queued"),
      progress("value", "Clear value", "failed"),
    );
    expect(await screen.findByLabelText("Clear value: could not be finished")).toBeInTheDocument();
    expect(screen.queryByText(/Making .* more/)).not.toBeInTheDocument();

    await send({ type: "topUp", missing: 1 }, progress("value", "Clear value", "queued"), progress("value", "Clear value", "writing"));
    expect(await screen.findByRole("status")).toHaveTextContent("1 didn't pass our checks. Making 1 more…");
    expect(screen.getByLabelText("Clear value: in progress")).toBeInTheDocument();
    // The remade ad reuses its slot: still three ads, no fourth.
    expect(screen.getAllByLabelText(/^(Customer proof|Clear value|Founder story): /)).toHaveLength(3);
  });

  it("shows each ad's stage as the stream arrives and ends on the final result", async () => {
    const { send, close } = streamedCreate();
    await startGenerating();

    const section = await screen.findByRole("region", { name: "Ads being created" });
    for (const name of ["Ad 1", "Ad 2", "Ad 3"]) expect(within(section).getByText(name)).toBeInTheDocument();
    expect(within(section).getByText("Creating 3 ads")).toBeInTheDocument();
    expect(within(section).getByText(/usually under 1½ minutes/)).toBeInTheDocument();
    expect(within(section).getByRole("progressbar")).toBeInTheDocument();

    await send(
      progress("proof", "Customer proof", "queued"),
      progress("value", "Clear value", "queued"),
      progress("story", "Founder story", "queued"),
      progress("proof", "Customer proof", "writing"),
      progress("value", "Clear value", "writing"),
      progress("value", "Clear value", "checking"),
    );
    const proof = await screen.findByLabelText("Customer proof: in progress");
    const value = screen.getByLabelText("Clear value: in progress");
    const story = screen.getByLabelText("Founder story: waiting to start");
    expect(within(proof).getByText("Customer proof")).toBeInTheDocument();
    expect(within(value).getByText("Clear value")).toBeInTheDocument();
    expect(within(story).getByText("Founder story")).toBeInTheDocument();
    expect(activeStep(proof)).toBe("Writing the copy");
    expect(activeStep(value)).toBe("Checking facts and claims against your Brand");

    await send(progress("value", "Clear value", "fixing"));
    await waitFor(() => expect(activeStep(screen.getByLabelText("Clear value: in progress"))).toBe("Fixing a detail"));

    await send(
      progress("proof", "Customer proof", "checking"),
      progress("proof", "Customer proof", "image"),
      { type: "creative", angleId: "proof", creative: proofAd },
      progress("proof", "Customer proof", "ready"),
    );
    expect(await within(section).findByText("Trusted by 400 local families")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Customer proof: /)).toBeNull();
    expect(screen.getByLabelText("Clear value: in progress")).toBeInTheDocument();
    expect(screen.getByLabelText("Founder story: waiting to start")).toBeInTheDocument();
    expect(section.querySelector('[aria-live="polite"]')).toHaveTextContent("1 of 3 ads ready.");

    await send(progress("story", "Founder story", "failed"));
    const failed = await screen.findByLabelText("Founder story: could not be finished");
    expect(within(failed).getByText("This ad could not be finished. The other ads carry on.")).toBeInTheDocument();

    await close({ type: "result", status: 200, body: { variantGroup: "group-1", creatives: [proofAd], failures: [{ angleId: "story" }] } });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Ads being created" })).toBeNull());
    expect(screen.getByText("Trusted by 400 local families")).toBeInTheDocument();
    expect(screen.getByText(/Your ad is ready/)).toBeInTheDocument();
  });

  it("keeps an edit made on a finished ad while the others were still generating (#280)", async () => {
    actions.updateCreativeCopy.mockResolvedValue({ ok: true, warnings: [], creative: { headline: "Edited while waiting", primary_text: "Book a visit.", cta: "Book Now", generation: null } });
    const { send, close } = streamedCreate();
    await startGenerating();
    await send(
      progress("proof", "Customer proof", "queued"),
      progress("value", "Clear value", "queued"),
      { type: "creative", angleId: "proof", creative: proofAd },
      progress("proof", "Customer proof", "ready"),
    );
    const section = await screen.findByRole("region", { name: "Ads being created" });
    const edit = await within(section).findByRole("button", { name: "Edit" });
    await act(async () => { fireEvent.click(edit); });
    await act(async () => { fireEvent.click(within(section).getByRole("button", { name: "Save" })); });
    expect(await within(section).findByText("Edited while waiting")).toBeInTheDocument();

    await close({ type: "result", status: 200, body: { variantGroup: "group-1", creatives: [proofAd], failures: [] } });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Ads being created" })).toBeNull());
    expect(screen.getByRole("heading", { name: "Edited while waiting" })).toBeInTheDocument();
    expect(screen.queryByText("Trusted by 400 local families")).toBeNull();
  });

  it("keeps finished ads in the slots they were watched in, not save order (#177)", async () => {
    const valueAd = { ...proofAd, id: "creative-value", headline: "Fair prices, no surprises", angle: "Clear value" } as Creative;
    const { send, close } = streamedCreate();
    await startGenerating();
    await send(
      progress("proof", "Customer proof", "queued"),
      progress("value", "Clear value", "queued"),
      { type: "creative", angleId: "value", creative: valueAd },
      { type: "creative", angleId: "proof", creative: proofAd },
    );
    await close({ type: "result", status: 200, body: { variantGroup: "group-1", creatives: [valueAd, proofAd], failures: [] } });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Ads being created" })).toBeNull());

    const headlines = screen.getAllByText(/Trusted by 400 local families|Fair prices, no surprises/).map((el) => el.textContent);
    expect(headlines).toEqual(["Trusted by 400 local families", "Fair prices, no surprises"]);
  });

  it("recovers saved results when the stream ends without a result line", async () => {
    const { fetchMock, send, close } = streamedCreate();
    await startGenerating();
    await send(progress("proof", "Customer proof", "writing"));
    await screen.findByLabelText("Customer proof: in progress");
    await close();

    expect(await screen.findByText("Trusted by 400 local families")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ads being created" })).toBeNull();
    const post = fetchMock.mock.calls.find(([url, init]) => url === "/api/creatives/generate" && init?.method === "POST")!;
    const generationId = JSON.parse(post[1]!.body as string).generationId;
    const reads = fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/creatives/generate?"));
    expect(reads).toHaveLength(1);
    expect(new URL(reads[0][0], "http://localhost").searchParams.get("generationId")).toBe(generationId);
  });
});
