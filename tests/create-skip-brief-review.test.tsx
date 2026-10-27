// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdAssistant } from "@/components/ad-assistant";
import type { Business, Creative } from "@/lib/types";

// #858 (CPO step cut 1 on #681), widened by #1004: any goal, chip or typed, on a Brand that already has
// offer, area and phone goes straight to Generate, with one line saying what the ads will use. Anything
// missing, a question from the assistant, or the owner tapping 'Edit brief' keeps the brief review.
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: vi.fn(), updateCreativeCopy: vi.fn() }));

const complete = {
  id: "biz-1",
  name: "Solaride",
  offers: ["Free site survey"],
  locations: ["Mohali"],
  phone: "+91 98290 12345",
} as Business;
const BRIEF = "Feature Solaride's free site survey for Mohali homes.";
const ads = ["a", "b", "c"].map((id) => ({ id: `creative-${id}`, headline: `Ad ${id}`, primary_text: "Book a survey.", status: "draft", angle: "Clear value" }) as Creative);

function mockApi(assistant: () => object) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/creatives/assistant") return Response.json(assistant());
    if (url === "/api/creatives/generate" && init?.method === "POST") return Response.json({ creatives: ads });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const generatePosts = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(([url, init]) => url === "/api/creatives/generate" && init?.method === "POST");

async function startFromChip(business: Business, edit?: string) {
  render(<AdAssistant business={business} />);
  fireEvent.click(await screen.findByRole("button", { name: /Feature: Free site survey/ }));
  if (edit) {
    const goal = screen.getByLabelText("Campaign goal") as HTMLTextAreaElement;
    fireEvent.change(goal, { target: { value: `${goal.value} ${edit}` } });
  }
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Make 3 ads|Start creating/ })); });
}

describe("<AdAssistant> skips the brief review when the Brand has the facts (#858)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("an unedited chip on a complete Brand generates at once, shows the brief collapsed, and Edit makes a new batch", async () => {
    const fetchMock = mockApi(() => ({ ready: true, brief: BRIEF }));
    render(<AdAssistant business={complete} />);
    fireEvent.click(await screen.findByRole("button", { name: /Feature: Free site survey/ }));
    // The tap that starts the paid run says so (QA + CPO on #681).
    expect(screen.getByRole("button", { name: /Make 3 ads/ })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Make 3 ads/ })); });

    await waitFor(() => expect(generatePosts(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(generatePosts(fetchMock)[0][1]?.body))).toMatchObject({ brief: BRIEF, count: 3 });
    expect(screen.queryByRole("region", { name: "Review creative brief" })).not.toBeInTheDocument();
    expect(screen.getByText("What I'll write about · Edit")).toBeInTheDocument();
    expect(screen.getByText(BRIEF)).toBeInTheDocument();

    const edit = await screen.findByRole("button", { name: /Edit brief/ });
    await waitFor(() => expect(edit).toBeEnabled());
    await act(async () => { fireEvent.click(edit); });
    expect(screen.getByRole("region", { name: "Review creative brief" })).toBeInTheDocument();
    expect(screen.getByLabelText("Creative brief")).toHaveValue(BRIEF);
    expect(screen.queryByText("What I'll write about · Edit")).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Generate 3 ads/ })); });
    await waitFor(() => expect(generatePosts(fetchMock)).toHaveLength(2));
    const [first, second] = generatePosts(fetchMock).map(([, init]) => JSON.parse(String(init?.body)).generationId);
    expect(second).not.toBe(first);
  });

  it("#1004: a typed goal on a complete Brand says what it will use, and 'Make 3 ads' generates at once", async () => {
    const fetchMock = mockApi(() => ({ ready: true, brief: BRIEF }));
    render(<AdAssistant business={complete} />);
    fireEvent.change(await screen.findByLabelText("Campaign goal"), { target: { value: "Rooftop solar for homes, weekend visits" } });
    expect(screen.getByText("Your 3 ads will use: Mohali · offer: Free site survey")).toBeInTheDocument();
    expect(screen.getByText("About 2 minutes. Nothing is published.")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Make 3 ads" })); });
    await waitFor(() => expect(generatePosts(fetchMock)).toHaveLength(1));
    expect(screen.queryByRole("region", { name: "Review creative brief" })).not.toBeInTheDocument();
    expect(screen.getByText("What I'll write about · Edit")).toBeInTheDocument();
  });

  // #1034 (CTO): Solaride's Brand lists Chandigarh, Panchkula and Mohali and Create uses all three; the line showed two.
  it("#1034: names every Brand area Create will use, the first 3 and then how many more", () => {
    const { unmount } = render(<AdAssistant business={{ ...complete, locations: ["Chandigarh", "Panchkula", "Mohali"] } as Business} />);
    fireEvent.change(screen.getByLabelText("Campaign goal"), { target: { value: "Rooftop solar in the tricity" } });
    expect(screen.getByText("Your 3 ads will use: Chandigarh, Panchkula, Mohali · offer: Free site survey")).toBeInTheDocument();
    unmount();
    render(<AdAssistant business={{ ...complete, locations: ["Chandigarh", "Panchkula", "Mohali", "Zirakpur", "Kharar"] } as Business} />);
    fireEvent.change(screen.getByLabelText("Campaign goal"), { target: { value: "Rooftop solar in the tricity" } });
    expect(screen.getByText("Your 3 ads will use: Chandigarh, Panchkula, Mohali +2 more · offer: Free site survey")).toBeInTheDocument();
  });

  it("#1004 (CPO): a proof point is labelled as proof, never as an offer, and long facts are cut at 40 characters", () => {
    render(<AdAssistant business={{ ...complete, offers: [], usps: ["Over 1,200 rooftops installed across Punjab since 2015"], locations: ["Mohali", "Kharar", "Zirakpur"] } as Business} />);
    fireEvent.change(screen.getByLabelText("Campaign goal"), { target: { value: "Rooftop solar" } });
    expect(screen.getByText("Your 3 ads will use: Mohali, Kharar, Zirakpur · proof: Over 1,200 rooftops installed across Pu…")).toBeInTheDocument();
    expect(screen.queryByText(/offer:/)).not.toBeInTheDocument();
  });

  it("#1004: an edited chip skips the review too, and 'Edit brief' keeps it", async () => {
    const fetchMock = mockApi(() => ({ ready: true, brief: BRIEF }));
    await startFromChip(complete, "Mention weekend slots.");
    await waitFor(() => expect(generatePosts(fetchMock)).toHaveLength(1));
    cleanup();
    sessionStorage.clear();
    const second = mockApi(() => ({ ready: true, brief: BRIEF }));
    render(<AdAssistant business={complete} />);
    fireEvent.change(await screen.findByLabelText("Campaign goal"), { target: { value: "Rooftop solar for homes" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Edit brief" })); });
    expect(await screen.findByRole("region", { name: "Review creative brief" })).toBeInTheDocument();
    expect(generatePosts(second)).toHaveLength(0);
  });

  it("keeps the review when the Brand is missing a phone", async () => {
    const fetchMock = mockApi(() => ({ ready: true, brief: BRIEF }));
    render(<AdAssistant business={{ ...complete, phone: null } as Business} />);
    fireEvent.click(await screen.findByRole("button", { name: /Feature: Free site survey/ }));
    expect(screen.getByRole("button", { name: /Start creating/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit brief" })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Start creating/ })); });
    expect(await screen.findByRole("region", { name: "Review creative brief" })).toBeInTheDocument();
    expect(generatePosts(fetchMock)).toHaveLength(0);
  });

  it("keeps the review when the interview had to ask something", async () => {
    let calls = 0;
    const fetchMock = mockApi(() => (calls++ === 0
      ? { ready: false, question: { id: "q1", field: "audience", question: "Who should see this?", help: "", options: ["Homeowners"], allowText: true, allowRandom: false, aiCanDecide: false } }
      : { ready: true, brief: BRIEF }));
    await startFromChip(complete);
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Homeowners" })); });
    expect(await screen.findByRole("region", { name: "Review creative brief" })).toBeInTheDocument();
    expect(generatePosts(fetchMock)).toHaveLength(0);
  });
});
