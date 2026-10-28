// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import { setupAdCost, setupBatch, setupGoal, setupPicks } from "@/lib/creative/setup-picks";
import type { Business, Creative } from "@/lib/types";

// #1270 (#1251 WS1 slice 3): step 2 makes 3 ads with the existing Create calls and pre-picks the best 2.
const mocks = vi.hoisted(() => ({ push: vi.fn(), setCreativeStatus: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: mocks.setCreativeStatus }));
import { SetupAdsStep, storyFor } from "@/components/setup-ads-step";

const business = { id: "11111111-1111-4111-8111-111111111111", name: "SunPeak Solar", vertical: "Rooftop solar", locations: ["Jaipur"],
  offers: ["Free site survey"], phone: "9876543210", languages: [] } as unknown as Business;
const ad = (id: string, textModels = 1, fallback = false) => ({ id, business_id: business.id, headline: `Ad ${id}`, image_url: `/ads/${id}.png`, status: "draft",
  generation: { textModels: Array.from({ length: textModels }, () => ({ provider: "openrouter", model: "m" })), image: fallback ? { fallbackFrom: "gpt-image" } : {} } }) as unknown as Creative;

describe("core: the pick rule (#1270)", () => {
  it("on the recorded Cedar Ridge run 4 batch, the ad that needed a repair isn't pre-picked", () => {
    const batch = run4.angles.map((angle) => ad(angle.angleId, angle.textAttempts.length));
    expect(run4.angles.map((angle) => angle.textAttempts.length)).toEqual([2, 1, 1]);
    expect(setupPicks(batch)).toEqual(["problem", "offer"]);
  });

  it("a fallback picture counts against an ad, less than a repair; ties keep the order made", () => {
    expect(setupAdCost(ad("a"))).toBe(0);
    expect(setupAdCost(ad("b", 1, true))).toBe(1);
    expect(setupAdCost(ad("c", 2))).toBe(2);
    expect(setupPicks([ad("c", 2), ad("b", 1, true), ad("a"), ad("d")])).toEqual(["a", "d"]);
    expect(setupPicks([ad("c", 2), ad("b", 1, true)])).toEqual(["b", "c"]);
    expect(setupPicks([ad("x")])).toEqual(["x"]);
  });

  it("an ad with no receipt counts as clean, never throws", () => {
    expect(setupAdCost({ generation: null })).toBe(0);
  });

  it("the goal comes from the five step-1 facts", () => {
    expect(setupGoal(business)).toBe("Get WhatsApp enquiries for Rooftop solar in Jaipur, leading with: Free site survey");
  });
});

describe("core: the making story (#1270)", () => {
  it("follows the furthest ad and never goes backwards", () => {
    expect(storyFor(null)).toBe("reading");
    expect(storyFor([{ stage: "starting" }, { stage: "writing" }])).toBe("writing");
    expect(storyFor([{ stage: "fixing" }, { stage: "writing" }])).toBe("checking");
    expect(storyFor([{ stage: "image" }, { stage: "checking" }])).toBe("pictures");
    expect(storyFor([{ stage: "image", creative: ad("a") }, { stage: "writing" }])).toBe("almost");
  });
});

describe("core: <SetupAdsStep> (#1270)", () => {
  const calls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url).split("?")[0]}`);
  const bar = () => within(screen.getByRole("navigation", { name: "Setup steps" }));

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    mocks.setCreativeStatus.mockResolvedValue({ ok: true });
  });

  it("an existing batch shows with the best 2 picked; tap changes the pick; Continue approves them and goes to Go live", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<SetupAdsStep business={business} initialAds={[ad("a", 2), ad("b"), ad("c")]} />);
    expect(screen.getByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ad b/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Ad a/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /Ad a/ }));
    await act(async () => fireEvent.click(bar().getByRole("button", { name: "Continue with 3 ads" })));
    expect(mocks.setCreativeStatus.mock.calls).toEqual([["a", "approved"], ["b", "approved"], ["c", "approved"]]);
    expect(mocks.push).toHaveBeenCalledWith("/campaigns?new=1&creatives=a,b,c");
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Edit the words of Ad b" })).toHaveAttribute("href", "/studio?creative=b");
  });

  it("#1393: the first picture loads first (preloaded, high priority); the others wait until scrolled to", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { renderToString } = await import("react-dom/server");
    const html = renderToString(<SetupAdsStep business={business} initialAds={[ad("a"), ad("b"), ad("c")]} />);
    expect(html).toMatch(/<link rel="preload" href="\/ads\/a\.png" as="image" fetchPriority="high"\/>/);
    const { container } = render(<SetupAdsStep business={business} initialAds={[ad("a"), ad("b"), ad("c")]} />);
    const pictures = [...container.querySelectorAll("img")].map((img) => [img.getAttribute("src"), img.getAttribute("fetchpriority"), img.getAttribute("loading")]);
    expect(pictures).toEqual([["/ads/a.png", "high", "eager"], ["/ads/b.png", "auto", "lazy"], ["/ads/c.png", "auto", "lazy"]]);
  });

  it("nothing picked: the primary says so and can't be tapped", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<SetupAdsStep business={business} initialAds={[ad("a")]} />);
    fireEvent.click(screen.getByRole("button", { name: /Ad a/ }));
    expect(bar().getByRole("button", { name: "Pick at least 1 ad" })).toBeDisabled();
  });

  it("a first visit makes 3 ads: the interview isn't asked (AdBrain decides), then one Create run", async () => {
    const generate = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/creatives/assistant") {
        const body = JSON.parse(String(init?.body));
        return Response.json(body.answers.length ? { ready: true, brief: "Rooftop solar brief" } : { question: { id: "q1", question: "Which offer?", options: ["A"] } });
      }
      generate(JSON.parse(String(init?.body)));
      return Response.json({ creatives: [ad("a"), ad("b", 2), ad("c")] });
    }));
    render(<SetupAdsStep business={business} initialAds={[]} />);
    expect(screen.getByText("Usually about a minute")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    const assistantBodies = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => url === "/api/creatives/assistant").map(([, init]) => JSON.parse(String(init.body)));
    expect(assistantBodies[1].answers[0]).toMatchObject({ question: "Which offer?", answer: "Let the AI decide the best option based on the brand." });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toMatchObject({ businessId: business.id, brief: "Rooftop solar brief", count: 3, language: "en" });
    expect(screen.getByRole("button", { name: /Ad b/ })).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.length).toBe(0);
  });

  it("coming back mid-way (or a second tab, #1402) reads the saved batch and never starts another (#1261)", async () => {
    localStorage.setItem(`setup-generation:${business.id}`, `22222222-2222-4222-8222-222222222222:3:${Date.now()}`);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "complete", creatives: [ad("a"), ad("b")] })));
    render(<SetupAdsStep business={business} initialAds={[]} />);
    expect(await screen.findByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(calls()).toEqual(["GET /api/creatives/generate"]);
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("generationId=22222222-2222-4222-8222-222222222222");
    expect(screen.getByText(/1 ad couldn't be made\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make another" })).toBeInTheDocument();
  });

  it("when no ad could be made it says so and offers Try again", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/creatives/assistant"
      ? Response.json({ ready: true, brief: "b" })
      : Response.json({ error: "Every ad failed its checks." }, { status: 422 })));
    render(<SetupAdsStep business={business} initialAds={[]} />);
    expect(await screen.findByText("We couldn't make your ads this time.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });

  it("a failed approve keeps the owner on the step and says so", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mocks.setCreativeStatus.mockResolvedValue({ ok: false, error: "offline" });
    render(<SetupAdsStep business={business} initialAds={[ad("a"), ad("b")]} />);
    await act(async () => fireEvent.click(bar().getByRole("button", { name: "Continue with 2 ads" })));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Not saved. Check your connection."));
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("core: step 2 batches (#1402)", () => {
  const bar = () => within(screen.getByRole("navigation", { name: "Setup steps" }));
  const status = (body: object) => Response.json(body);
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => vi.useRealTimers());

  it("an id kept over 15 minutes ago is a leftover: a new batch is made", async () => {
    localStorage.setItem(`setup-generation:${business.id}`, `22222222-2222-4222-8222-222222222222:3:${Date.now() - 16 * 60_000}`);
    const generate = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/creatives/assistant") return Response.json({ ready: true, brief: "b" });
      generate(init?.method);
      return Response.json({ creatives: [ad("a"), ad("b"), ad("c")] });
    }));
    render(<SetupAdsStep business={business} initialAds={[]} />);
    expect(await screen.findByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(generate).toHaveBeenCalledWith("POST");
  });

  it("a batch that finished short ('unresolved') is shown with what was saved, not 'still being made'", async () => {
    localStorage.setItem(`setup-generation:${business.id}`, `22222222-2222-4222-8222-222222222222:3:${Date.now()}`);
    vi.stubGlobal("fetch", vi.fn(async () => status({ status: "unresolved", creatives: [ad("a"), ad("b")], expectedCount: 3 })));
    render(<SetupAdsStep business={business} initialAds={[]} />);
    expect(await screen.findByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(screen.getByText(/1 ad couldn't be made\./)).toBeInTheDocument();
    expect(screen.queryByText(/still being made/)).toBeNull();
  });

  it("a half-done batch ('partial') keeps waiting until it completes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem(`setup-generation:${business.id}`, `22222222-2222-4222-8222-222222222222:3:${Date.now()}`);
    const replies = [status({ status: "partial", creatives: [ad("a")], expectedCount: 3 }), status({ status: "complete", creatives: [ad("a"), ad("b"), ad("c")], expectedCount: 3 })];
    vi.stubGlobal("fetch", vi.fn(async () => replies.shift() ?? status({ status: "complete", creatives: [ad("a"), ad("b"), ad("c")], expectedCount: 3 })));
    render(<SetupAdsStep business={business} initialAds={[]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.queryByRole("heading", { name: "Your ads are ready" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(await screen.findByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Ad [abc]/ })).toHaveLength(3);
  });

  it("a recent short batch from another device is checked on arrival and joins the ads already shown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => status({ status: "complete", creatives: [ad("c")], expectedCount: 1 })));
    render(<SetupAdsStep business={business} initialAds={[ad("a"), ad("b")]} pendingBatch={{ generationId: "33333333-3333-4333-8333-333333333333" }} />);
    expect(screen.getByText("Usually about a minute")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Ad [abc]/ })).toHaveLength(3);
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("generationId=33333333-3333-4333-8333-333333333333");
    expect(bar().getByRole("button", { name: "Continue with 2 ads" })).toBeEnabled();
  });

  it("a 'Make another' top-up shows beside its batch; a full newer batch shows alone", () => {
    const row = (id: string, group: string, minutesAgo: number) => ({ ...ad(id), variant_group: group, created_at: new Date(Date.parse("2026-10-28T12:00:00Z") - minutesAgo * 60_000).toISOString() });
    const topUp = setupBatch([row("c", "g2", 0), row("b", "g1", 5), row("a", "g1", 6)]);
    expect(topUp.ads.map((creative) => creative.id)).toEqual(["a", "b", "c"]);
    expect(topUp.newest).toMatchObject({ generationId: "g2", count: 1 });
    const fresh = setupBatch([row("f", "g3", 0), row("e", "g3", 0), row("d", "g3", 1), row("c", "g2", 30)]);
    expect(fresh.ads.map((creative) => creative.id)).toEqual(["d", "e", "f"]);
    const old = setupBatch([row("c", "g2", 0), row("b", "g1", 3 * 60)]);
    expect(old.ads.map((creative) => creative.id)).toEqual(["c"]);
    expect(setupBatch([])).toEqual({ ads: [], newest: null });
  });
});
