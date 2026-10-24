// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdAssistant } from "@/components/ad-assistant";
import { CREATE_LANGUAGES, defaultAdLanguage } from "@/lib/languages";
import type { Business } from "@/lib/types";

const business = { id: "biz-1", name: "Cedar Ridge Chiro", languages: ["English", "Hindi"] } as Business;
const key = `adbrain:assistant:${business.id}`;

describe("defaultAdLanguage", () => {
  it("offers English, Hinglish, Hindi and Punjabi in that order", () => {
    expect(CREATE_LANGUAGES).toEqual([
      { id: "en", label: "English" },
      { id: "hinglish", label: "Hinglish" },
      { id: "hi", label: "हिंदी" },
      { id: "pa", label: "ਪੰਜਾਬੀ" },
    ]);
  });

  it("uses the first Brand language it recognises", () => {
    expect(defaultAdLanguage(["English", "Hindi"])).toBe("en");
    expect(defaultAdLanguage(["Hindi"])).toBe("hi");
    expect(defaultAdLanguage(["Tamil", "Hindi", "English"])).toBe("hi");
    expect(defaultAdLanguage(["Hinglish"])).toBe("hinglish");
    expect(defaultAdLanguage(["Punjabi"])).toBe("pa");
  });

  it("matches names, codes and native scripts case-insensitively", () => {
    expect(defaultAdLanguage(["ENGLISH"])).toBe("en");
    expect(defaultAdLanguage(["en"])).toBe("en");
    expect(defaultAdLanguage(["hinglish"])).toBe("hinglish");
    expect(defaultAdLanguage(["HI"])).toBe("hi");
    expect(defaultAdLanguage(["हिंदी"])).toBe("hi");
    expect(defaultAdLanguage(["हिन्दी"])).toBe("hi");
    expect(defaultAdLanguage(["  hindi  "])).toBe("hi");
    expect(defaultAdLanguage(["PA"])).toBe("pa");
    expect(defaultAdLanguage(["ਪੰਜਾਬੀ"])).toBe("pa");
  });

  it("falls back to English when no Brand language is recognised", () => {
    expect(defaultAdLanguage([])).toBe("en");
    expect(defaultAdLanguage(null)).toBe("en");
    expect(defaultAdLanguage(undefined)).toBe("en");
    expect(defaultAdLanguage(["Tamil", ""])).toBe("en");
  });
});

type Json = Record<string, unknown>;

function mockApi(interview: Json) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/creatives/assistant") return Response.json(interview);
    if (url === "/api/creatives/generate" && init?.method === "POST") return Response.json({ creatives: [{ id: "creative-1", headline: "Ad", status: "draft" }] });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function generatePayload(fetchMock: ReturnType<typeof mockApi>): Json {
  const call = fetchMock.mock.calls.find(([url, init]) => url === "/api/creatives/generate" && init?.method === "POST");
  return JSON.parse(call![1]!.body as string) as Json;
}

async function startBrief(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "Campaign goal" }), "Invite enquiries");
  await user.click(screen.getByRole("button", { name: /start creating/i }));
  return screen.findByRole("region", { name: "Review creative brief" });
}

describe("<AdAssistant> ad language", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("shows the picker on the goal step with the Brand's first language checked", async () => {
    render(<AdAssistant business={business} />);
    const picker = await screen.findByRole("radiogroup", { name: "Ad language" });
    expect(within(picker).getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)).toEqual(["English", "Hinglish", "हिंदी", "ਪੰਜਾਬੀ"]);
    expect(within(picker).getByRole("radio", { name: "English" })).toBeChecked();
    expect(within(picker).getByRole("radio", { name: "हिंदी" })).not.toBeChecked();
    expect(within(picker).getByText("हिंदी")).toHaveAttribute("lang", "hi");
    expect(within(picker).getByText("ਪੰਜਾਬੀ")).toHaveAttribute("lang", "pa");
  });

  it("keeps the owner's pick when the interview suggests another language and sends it to generation", async () => {
    const fetchMock = mockApi({ ready: true, brief: "Show a calm clinic visit.", language: "en" });
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    await user.click(await screen.findByRole("radio", { name: "हिंदी" }));
    const review = await startBrief(user);
    expect(within(review).getByRole("radio", { name: "हिंदी" })).toBeChecked();
    await act(async () => { await user.click(within(review).getByRole("button", { name: "Generate 3 ads" })); });
    expect(generatePayload(fetchMock)).toMatchObject({ brief: "Show a calm clinic visit.", language: "hi" });
  });

  it("adopts the interview's language when the owner did not pick one", async () => {
    const fetchMock = mockApi({ ready: true, brief: "Show a calm clinic visit.", language: "hinglish" });
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    const review = await startBrief(user);
    expect(within(review).getByRole("radio", { name: "Hinglish" })).toBeChecked();
    await act(async () => { await user.click(within(review).getByRole("button", { name: "Generate 3 ads" })); });
    expect(generatePayload(fetchMock)).toMatchObject({ language: "hinglish" });
  });

  it("ignores an interview language outside the four Create languages", async () => {
    mockApi({ ready: true, brief: "Show a calm clinic visit.", language: "pa_roman" });
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    const review = await startBrief(user);
    expect(within(review).getByRole("radio", { name: "English" })).toBeChecked();
  });

  it("lets the owner change the language on the review step before generating", async () => {
    const fetchMock = mockApi({ ready: true, brief: "Show a calm clinic visit.", language: "hinglish" });
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    const review = await startBrief(user);
    await user.click(within(review).getByRole("radio", { name: "ਪੰਜਾਬੀ" }));
    await act(async () => { await user.click(within(review).getByRole("button", { name: "Generate 3 ads" })); });
    expect(generatePayload(fetchMock)).toMatchObject({ language: "pa" });
  });

  it("restores the picked language from the saved draft", async () => {
    sessionStorage.setItem(key, JSON.stringify({ goal: "Invite enquiries", started: false, turns: [], answers: [], phase: "chat", language: "hi" }));
    render(<AdAssistant business={business} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "हिंदी" })).toBeChecked());
    expect(screen.getByRole("textbox", { name: "Campaign goal" })).toHaveValue("Invite enquiries");
  });

  it("keeps an explicit pick across a reload even if the interview then suggests another language", async () => {
    sessionStorage.setItem(key, JSON.stringify({ goal: "Invite enquiries", started: false, turns: [], answers: [], phase: "chat", language: "pa", languagePicked: true }));
    const fetchMock = mockApi({ ready: true, brief: "Show a calm clinic visit.", language: "hinglish" });
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "ਪੰਜਾਬੀ" })).toBeChecked());
    await user.click(screen.getByRole("button", { name: /start creating/i }));
    const review = await screen.findByRole("region", { name: "Review creative brief" });
    expect(within(review).getByRole("radio", { name: "ਪੰਜਾਬੀ" })).toBeChecked();
    await act(async () => { await user.click(within(review).getByRole("button", { name: "Generate 3 ads" })); });
    expect(generatePayload(fetchMock)).toMatchObject({ language: "pa" });
  });

  it("saves the picked language in the draft", async () => {
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    await user.click(await screen.findByRole("radio", { name: "Hinglish" }));
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(key)!)).toMatchObject({ language: "hinglish", languagePicked: true }));
  });

  it("falls back to the Brand default for an older draft without a language", async () => {
    sessionStorage.setItem(key, JSON.stringify({ goal: "Invite enquiries", started: false, turns: [], answers: [], phase: "chat" }));
    render(<AdAssistant business={{ ...business, languages: ["Hindi"] }} />);
    expect(await screen.findByRole("textbox", { name: "Campaign goal" })).toHaveValue("Invite enquiries");
    expect(screen.getByRole("radio", { name: "हिंदी" })).toBeChecked();
  });

  it("keeps the picked language after Start over", async () => {
    mockApi({ question: { id: "q1", question: "Who is it for?", options: ["Families"] } });
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    await user.click(await screen.findByRole("radio", { name: "ਪੰਜਾਬੀ" }));
    await user.type(screen.getByRole("textbox", { name: "Campaign goal" }), "Invite enquiries");
    await user.click(screen.getByRole("button", { name: /start creating/i }));
    await user.click(await screen.findByRole("button", { name: /start over/i }));
    expect(await screen.findByRole("radio", { name: "ਪੰਜਾਬੀ" })).toBeChecked();
  });
});
