// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdAssistant } from "@/components/ad-assistant";
import type { Business } from "@/lib/types";

const business = { id: "biz-1", name: "Cedar Ridge Chiro" } as Business;

describe("<AdAssistant> draft persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("checks the same generation after a timeout instead of paying for another request", async () => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/creatives/assistant") {
        return Response.json({ ready: true, brief: "Use saved brand facts" });
      }
      if (init?.method === "POST") return new Response(null, { status: 504 });
      return Response.json({ status: "processing", creatives: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdAssistant business={business} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Campaign goal" }), { target: { value: "Invite enquiries" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start creating/i }));
    });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/creatives/generate")).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Generate 3 ads" }));
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByText(/generation result is not confirmed/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check saved results" }));
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const posts = fetchMock.mock.calls.filter(([url, init]) => url === "/api/creatives/generate" && init?.method === "POST");
    expect(posts).toHaveLength(1);
    const generationId = JSON.parse(posts[0][1]!.body as string).generationId;
    const reads = fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/creatives/generate?"));
    expect(reads).toHaveLength(30);
    expect(reads.every(([url]) => new URL(url, "http://localhost").searchParams.get("generationId") === generationId)).toBe(true);
  });

  it("frames creation as a brand-grounded campaign brief", async () => {
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);

    expect(screen.getByText("Grounded in Cedar Ridge Chiro")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Creation stages" })).toBeInTheDocument();
    expect(screen.queryByText("Brief preview")).toBeNull();

    const goal = screen.getByRole("textbox", { name: "Campaign goal" });
    expect(goal).toHaveClass("scrollbar-stable", "overflow-y-scroll", "resize-y");
    const start = screen.getByRole("button", { name: /start creating/i });
    expect(start).toBeDisabled();

    await user.type(goal, "Bring local families in for a spring checkup");
    expect(goal).toHaveValue("Bring local families in for a spring checkup");
    expect(start).toBeEnabled();
  });

  it("offers grounded starting goals without fabricating an offer", async () => {
    const user = userEvent.setup();
    render(<AdAssistant business={{ ...business, offers: ["$49 initial consultation"] }} />);
    await user.click(screen.getByRole("button", { name: "Feature: $49 initial consultation" }));
    expect(screen.getByRole("textbox", { name: "Campaign goal" })).toHaveValue("Feature this saved offer from Cedar Ridge Chiro: $49 initial consultation. Do not add new terms.");
    expect(screen.queryByText("Free consult")).toBeNull();
  });

  it("restores a typed goal after navigating away and back", async () => {
    const user = userEvent.setup();
    const first = render(<AdAssistant business={business} />);
    const box = screen.getByRole("textbox");
    await user.type(box, "Weekend offer for new patients");

    // Leaving the tab unmounts the component.
    first.unmount();
    render(<AdAssistant business={business} />);

    expect(
      await screen.findByDisplayValue("Weekend offer for new patients"),
    ).toBeInTheDocument();
  });

  it("keeps drafts separate per business", async () => {
    const user = userEvent.setup();
    const first = render(<AdAssistant business={business} />);
    await user.type(screen.getByRole("textbox"), "Cedar Ridge idea");
    first.unmount();

    render(
      <AdAssistant business={{ ...business, id: "biz-2" } as Business} />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("starts clean when there is no draft", () => {
    render(<AdAssistant business={business} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("ignores a corrupted draft rather than crashing", () => {
    sessionStorage.setItem(`adbrain:assistant:${business.id}`, "{not json");
    render(<AdAssistant business={business} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("preserves decision metadata and requires review before generation", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ready: false, question: { id: "scene", field: "visual", question: "Which scene?", options: ["Team at work", "Service space"] } })).mockResolvedValueOnce(Response.json({ ready: true, brief: "Show the team at work." }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const first = render(<AdAssistant business={business} />);
    await user.type(screen.getByRole("textbox", { name: "Campaign goal" }), "Introduce the team");
    await user.click(screen.getByRole("button", { name: /start creating/i }));
    await user.click(await screen.findByRole("button", { name: "Team at work" }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).answers[0]).toMatchObject({ field: "visual", questionId: "scene", options: ["Team at work", "Service space"] });
    const brief = await screen.findByRole("textbox", { name: "Creative brief" });
    const history = screen.getByRole("region", { name: "Conversation history" });
    expect(history).toHaveClass("scrollbar-stable", "overflow-y-scroll");
    expect(history).toHaveAttribute("tabindex", "0");
    await user.clear(brief);
    await user.type(brief, "Show only the service space, no people.");
    first.unmount();
    render(<AdAssistant business={business} />);
    expect(await screen.findByRole("textbox", { name: "Creative brief" })).toHaveValue("Show only the service space, no people.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends an AI decision with its field and shows the returned brief before generation", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ready: false, question: { id: "area", field: "location", question: "Which service area?", options: ["Jaipur", "Ajmer"], aiCanDecide: true } }))
      .mockResolvedValueOnce(Response.json({ ready: true, brief: "Target the saved Jaipur service area." }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdAssistant business={business} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Campaign goal" }), { target: { value: "Local enquiries" } });
    fireEvent.click(screen.getByRole("button", { name: /start creating/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Let AI decide" }));
    expect(await screen.findByRole("textbox", { name: "Creative brief" })).toHaveValue("Target the saved Jaipur service area.");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).answers[0]).toMatchObject({ field: "location", questionId: "area", answer: "Let the AI decide the best option based on the brand." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => url === "/api/creatives/assistant")).toBe(true);
  });

  it.each([{ scrollTop: 0, follows: false }, { scrollTop: 790, follows: true }])("respects the reader's position when a delayed response arrives: %j", async ({ scrollTop, follows }) => {
    let complete!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
    render(<AdAssistant business={business} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Campaign goal" }), { target: { value: "Local enquiries" } });
    fireEvent.click(screen.getByRole("button", { name: /start creating/i }));
    const history = screen.getByRole("region", { name: "Conversation history" });
    Object.defineProperties(history, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: scrollTop },
    });
    const scroll = vi.mocked(history.scrollTo);
    scroll.mockClear();
    fireEvent.scroll(history);
    await act(async () => complete(Response.json({ ready: false, question: { id: "area", field: "location", question: "Which service area?", options: ["Jaipur", "Ajmer"] } })));
    expect(screen.getByText("Which service area?")).toBeInTheDocument();
    if (follows) expect(scroll).toHaveBeenCalledWith({ top: 1000, behavior: "instant" });
    else expect(scroll).not.toHaveBeenCalled();
  });

  it("carries a specific recommended next query and full reviewed context into another request", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    const brief = "Keep the confirmed message. ".repeat(20);
    sessionStorage.setItem(`adbrain:assistant:${business.id}`, JSON.stringify({ goal: "Introduce our service", started: true, turns: [], answers: [], phase: "done", prepared: { brief, recommendations: [{ label: "Focus on the reception", prompt: "Show the reception setting, retaining all confirmed constraints." }] } }));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ready: true, brief }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    await user.click(await screen.findByRole("button", { name: "Focus on the reception" }));
    await user.click(screen.getByRole("button", { name: "Start creating" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ goal: "Show the reception setting, retaining all confirmed constraints.", referenceBrief: brief, recentGoals: ["Introduce our service"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("restores uncertain generation identity and checks saved results without posting", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    const identity = "12345678-1234-4234-8234-123456789012";
    sessionStorage.setItem(`adbrain:assistant:${business.id}`, JSON.stringify({ goal: "Introduce our service", started: true, turns: [], answers: [], phase: "chat", generationId: identity, prepared: { brief: "Use saved brand facts" } }));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: "complete", creatives: [{ id: "saved", headline: "Our service", primary_text: "Enquire today", status: "draft" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    await user.click(await screen.findByRole("button", { name: "Check saved results" }));
    await screen.findByRole("button", { name: "Make another" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(`generationId=${identity}`);
    expect(fetchMock.mock.calls[0][1]).toEqual({ cache: "no-store" });
  });
});
