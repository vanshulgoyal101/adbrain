// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import { setupAdCost, setupBatch, setupGoal, setupPicks } from "@/lib/creative/setup-picks";
import type { Business, Creative } from "@/lib/types";

// #1270 (#1251 WS1 slice 3): step 2 makes 3 ads with the existing Create calls and pre-picks the best 2.
const mocks = vi.hoisted(() => ({ push: vi.fn(), setCreativeStatus: vi.fn(), downloadBlob: vi.fn(), saveAdLanguage: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/download", () => ({ downloadBlob: mocks.downloadBlob }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: mocks.setCreativeStatus }));
vi.mock("@/app/(app)/brand/actions", () => ({ saveAdLanguage: mocks.saveAdLanguage }));
import { SetupAdsStep, storyFor } from "@/components/setup-ads-step";
import hi from "../../messages/hi.json";

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
    // #1681 (CPO #1669): a solar business with no Brand language gets Hinglish ads by default.
    expect(generate.mock.calls[0][0]).toMatchObject({ businessId: business.id, brief: "Rooftop solar brief", count: 3, language: "hinglish" });
    expect(screen.getByRole("button", { name: /Ad b/ })).toHaveAttribute("aria-pressed", "false");
    // The run's id is gone; only its result stays, for other tabs (#1534), and expires like the id.
    expect(localStorage.getItem(`setup-generation:${business.id}`)).toBeNull();
    expect(Object.keys(localStorage)).toEqual([`setup-generation-result:${business.id}`]);
  });

  it("#1475: with only earlier ads (Studio-made or older details), nothing paid starts until the owner taps Make 3 ads", async () => {
    const generate = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/creatives/assistant") return Response.json({ ready: true, brief: "b" });
      generate(JSON.parse(String(init?.body)));
      return Response.json({ creatives: [ad("a"), ad("b"), ad("c")] });
    }));
    render(<SetupAdsStep business={business} initialAds={[]} earlier />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Make ads from your details" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Use your earlier ads" })).toHaveAttribute("href", "/campaigns?all=1");
    await act(async () => fireEvent.click(bar().getByRole("button", { name: "Make 3 ads" })));
    expect(await screen.findByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("#1681: before Make 3 ads, 'Ads in' picks the batch's language and saves it; the row is gone once making starts", async () => {
    const generate = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/creatives/assistant") return Response.json({ ready: true, brief: "b" });
      generate(JSON.parse(String(init?.body)));
      return new Promise<Response>(() => {});
    }));
    render(<SetupAdsStep business={business} initialAds={[]} earlier />);
    expect(screen.getByRole("button", { name: "Hinglish" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "हिंदी" }));
    expect(mocks.saveAdLanguage).toHaveBeenCalledWith(business.id, "hi");
    await act(async () => fireEvent.click(bar().getByRole("button", { name: "Make 3 ads" })));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(generate.mock.calls[0][0]).toMatchObject({ language: "hi" });
    expect(screen.queryByRole("group", { name: "Your ads will be in" })).toBeNull();
  });

  it("#1475: earlier ads but a batch already running (another tab) resumes it, still never a new one", async () => {
    localStorage.setItem(`setup-generation:${business.id}`, `22222222-2222-4222-8222-222222222222:3:${Date.now()}`);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "complete", creatives: [ad("a"), ad("b"), ad("c")] })));
    render(<SetupAdsStep business={business} initialAds={[]} earlier />);
    expect(await screen.findByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(calls()).toEqual(["GET /api/creatives/generate"]);
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

  // #1407 (QA 2's prospect re-time): a sales visit leaves step 2 with all 3 ads as the marked pack, never via Review.
  it("#1407: a prospect's step 2 picks all 3 and downloads the marked sample pack, approving them on the way", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["zip"]))));
    render(<SetupAdsStep business={business} initialAds={[ad("a", 2), ad("b"), ad("c")]} sample />);
    for (const name of [/Ad a/, /Ad b/, /Ad c/]) expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/All of them go in the sample pack, each marked 'Sample ad: not live yet'/)).toBeInTheDocument();
    await act(async () => fireEvent.click(bar().getByRole("button", { name: "Download sample pack (3)" })));
    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "adbrain-sample-pack.zip"));
    expect(mocks.setCreativeStatus.mock.calls).toEqual([["a", "approved"], ["b", "approved"], ["c", "approved"]]);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect([url, JSON.parse(String(init.body))]).toEqual(["/api/creatives/export", { creativeIds: ["a", "b", "c"] }]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  // #1502: on the visit the ads are shown on a phone; full screen, each one still says it's a sample (no clean picture).
  it("#1502: a prospect's picked ads open full screen, one at a time, each marked as a sample", async () => {
    render(<SetupAdsStep business={business} initialAds={[ad("a"), ad("b"), ad("c")]} sample />);
    fireEvent.click(screen.getByRole("button", { name: /Ad b/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show full screen" }));
    const viewer = within(screen.getByRole("dialog", { name: "Sample ads" }));
    expect(viewer.getAllByRole("img").map((img) => img.getAttribute("src"))).toEqual(["/ads/a.png", "/ads/c.png"]);
    expect(viewer.getAllByText("Sample ad: not live yet")).toHaveLength(2);
    expect(viewer.getByText("1 of 2")).toBeInTheDocument();
    expect(viewer.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show full screen" })).toHaveFocus();
  });

  it("#1502: an owner's own step 2 has no sample viewer", () => {
    render(<SetupAdsStep business={business} initialAds={[ad("a"), ad("b")]} />);
    expect(screen.queryByRole("button", { name: "Show full screen" })).not.toBeInTheDocument();
  });

  const batch = "22222222-2222-4222-8222-222222222222";
  const inBatch = (id: string, minutesAgo: number) => ({ ...ad(id), variant_group: batch, created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() }) as unknown as Creative;

  it("#1407: coming back to a batch that ended short says how many couldn't be made, with Make another", async () => {
    const saved = [inBatch("a", 10), inBatch("b", 9)];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "partial", expectedCount: 3, creatives: saved })));
    render(<SetupAdsStep business={business} initialAds={saved} />);
    expect(await screen.findByText(/^1 ad couldn't be made\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make another" })).toBeInTheDocument();
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain(`generationId=${batch}`);
  });

  it("#1407: coming back while the batch is still running says more are coming and adds them", async () => {
    const first = [inBatch("a", 1)];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "processing", expectedCount: 3, creatives: [...first, inBatch("b", 0)] })));
    render(<SetupAdsStep business={business} initialAds={first} />);
    expect(await screen.findByText("1 more ad is still being made. It appears here when it's ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ad b/ })).toBeInTheDocument();
    expect(screen.queryByText(/couldn't be made/)).not.toBeInTheDocument();
    // #1564: not "ready" yet, and Continue waits for the rest of the batch.
    expect(screen.getByRole("heading", { name: "Making your ads…" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your ads are ready" })).toBeNull();
    expect(bar().getByRole("button", { name: "1 more on the way…" })).toBeDisabled();
  });

  it("#1564: once the rest of the batch lands, it's ready and Continue works", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = [inBatch("a", 1)];
    const replies = [Response.json({ status: "partial", expectedCount: 3, creatives: first })];
    vi.stubGlobal("fetch", vi.fn(async () => replies.shift() ?? Response.json({ status: "complete", expectedCount: 3, creatives: [...first, inBatch("b", 0), inBatch("c", 0)] })));
    render(<SetupAdsStep business={business} initialAds={first} />);
    expect(await screen.findByRole("heading", { name: "Making your ads…" })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(await screen.findByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(bar().getByRole("button", { name: /^Continue with/ })).toBeEnabled();
    vi.useRealTimers();
  });

  it("#1934: in returning mode Continue goes to Go live with again=1 and Back to the offer step", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<SetupAdsStep business={business} initialAds={[ad("a"), ad("b")]} again />);
    await act(async () => fireEvent.click(bar().getByRole("button", { name: /^Continue with/ })));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(expect.stringMatching(/^\/campaigns\?again=1&creatives=/)));
    mocks.push.mockClear();
    await act(async () => fireEvent.click(bar().getByRole("button", { name: "Back" })));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/brand?again=1"));
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

  it("#1534: a waiting tab rate-limited (429) takes the finished batch from the tab that got it, within moments", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const id = "22222222-2222-4222-8222-222222222222";
    localStorage.setItem(`setup-generation:${business.id}`, `${id}:3:${Date.now()}`);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "120" } })));
    render(<SetupAdsStep business={business} initialAds={[]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.queryByRole("heading", { name: "Your ads are ready" })).toBeNull();
    // Another tab finished the batch: it publishes the ads under the batch's id.
    const value = JSON.stringify({ id, at: Date.now(), creatives: [ad("a"), ad("b"), ad("c")] });
    localStorage.setItem(`setup-generation-result:${business.id}`, value);
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: `setup-generation-result:${business.id}`, newValue: value })); });
    expect(await screen.findByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Ad [abc]/ })).toHaveLength(3);
    expect(screen.queryByText(/still being made/)).toBeNull();
    // It waited out Retry-After instead of polling every 10 s into more 429s.
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("#1534: a finished batch is published for other tabs; a result for another batch is ignored", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    localStorage.setItem(`setup-generation:${business.id}`, `${id}:3:${Date.now()}`);
    localStorage.setItem(`setup-generation-result:${business.id}`, JSON.stringify({ id: "33333333-3333-4333-8333-333333333333", at: Date.now(), creatives: [ad("z")] }));
    vi.stubGlobal("fetch", vi.fn(async () => status({ status: "complete", creatives: [ad("a"), ad("b")] })));
    render(<SetupAdsStep business={business} initialAds={[]} />);
    expect(await screen.findByRole("heading", { name: "Your ads are ready" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ad z/ })).toBeNull();
    expect(JSON.parse(localStorage.getItem(`setup-generation-result:${business.id}`)!)).toMatchObject({ id, creatives: [{ id: "a" }, { id: "b" }] });
  });

  it("on arrival the newest batch (a 'Make another' top-up comes last) is checked and its new ads join (#1402/#1407)", async () => {
    const g1 = "22222222-2222-4222-8222-222222222222", g2 = "33333333-3333-4333-8333-333333333333";
    const withGroup = (creative: Creative, group: string) => ({ ...creative, variant_group: group, created_at: new Date().toISOString() }) as Creative;
    vi.stubGlobal("fetch", vi.fn(async () => status({ status: "complete", creatives: [withGroup(ad("c"), g2), withGroup(ad("d"), g2)], expectedCount: 2 })));
    render(<SetupAdsStep business={business} initialAds={[withGroup(ad("a"), g1), withGroup(ad("b"), g1), withGroup(ad("c"), g2)]} />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Ad [abcd]/ })).toHaveLength(4));
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain(`generationId=${g2}`);
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

describe("#1901: each ad says whose picture it is", () => {
  it("labels the owner's photo and the AI picture, in Hindi too", () => {
    const yours = { ...ad("a"), generation: { image: { provider: "owner-photo" } } } as unknown as Creative;
    const ai = { ...ad("b"), generation: { image: { provider: "cloudflare" } } } as unknown as Creative;
    const { unmount } = render(<SetupAdsStep business={business} initialAds={[yours, ai]} />);
    expect(screen.getByText("Your photo")).toBeInTheDocument();
    expect(screen.getByText("AI picture")).toBeInTheDocument();
    unmount();
    render(<SetupAdsStep business={business} initialAds={[yours, ai]} words={{ locale: "hi", messages: hi.setup }} />);
    expect(screen.getByText("आपकी फ़ोटो")).toBeInTheDocument();
    expect(screen.getByText("AI तस्वीर")).toBeInTheDocument();
  });
});

describe("#1438: step 2 in Hindi (CPO #1251, #1707)", () => {
  it("says ready, picked and Continue in the CPO's words", () => {
    render(<SetupAdsStep business={business} initialAds={[ad("a"), ad("b"), ad("c")]} words={{ locale: "hi", messages: hi.setup }} />);
    expect(screen.getByRole("heading", { name: "आपके विज्ञापन तैयार हैं" })).toBeInTheDocument();
    expect(screen.getByText(/^हमने सबसे अच्छे 2 चुने हैं।/)).toBeInTheDocument();
    expect(screen.getAllByText("चुना गया")).toHaveLength(2);
    expect(screen.getByText("चुनने के लिए टैप करें")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /के शब्द बदलें$/ })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "2 विज्ञापन के साथ आगे बढ़ें" })).toBeInTheDocument();
    expect(screen.queryByText(/Continue with|Picked|Tap to pick/)).toBeNull();
  });
});
});
