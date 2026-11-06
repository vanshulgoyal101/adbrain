// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignChat } from "@/components/campaign-chat";
import { draftDtoSchema } from "@/lib/campaign/connect-contracts";
import type { WebsiteGoal } from "@/lib/types/campaign";

const businessId = "11111111-1111-4111-8111-111111111111";
const mismatch = "The saved draft did not match your website goal. Check Saved drafts before retrying.";
const question = { id: "area", question: "Which city?", type: "text" };

function websiteDraft(goal: WebsiteGoal | null = "leads") {
  return {
    draftId: "33333333-3333-4333-8333-333333333333",
    version: 1,
    expiresAt: "2099-01-01T00:00:00.000Z",
    input: {
      businessId, name: "Website campaign", goal: "Website enquiries", mode: "guided" as const,
      creativeIds: [], dailyBudgetRupees: 300, leadFormId: null, destination: "website" as const,
      ...(goal ? { websiteGoal: goal } : {}), targeting: {}, abTest: false,
    },
  };
}

function mockPlan(...responses: unknown[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce({ ok: true, json: async () => response });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function start(text = "Website enquiries") {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("guided website campaign identity", () => {
  it("does not start a website interview without an explicit valid goal", () => {
    const fetchMock = mockPlan();
    const props = { businessId, destination: "website" as const, websiteDraftMismatch: mismatch };
    // @ts-expect-error A website interview requires an explicit goal.
    render(<CampaignChat {...props} />);
    expect(screen.getByText(mismatch)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("keeps the selected destination and goal through questions and reload", async () => {
    const draft = websiteDraft();
    expect(draftDtoSchema.safeParse(draft).success).toBe(true);
    const fetchMock = mockPlan({ ready: false, questions: [question] }, { ready: true, draft });
    const onDraftReady = vi.fn();
    const first = render(<CampaignChat businessId={businessId} destination="website" websiteGoal="leads" websiteDraftMismatch={mismatch} onDraftReady={onDraftReady} />);
    start();
    await screen.findByText("Which city?");
    first.unmount();
    render(<CampaignChat businessId={businessId} destination="website" websiteGoal="leads" websiteDraftMismatch={mismatch} onDraftReady={onDraftReady} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Which city?" }), { target: { value: "Jaipur" } });
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await waitFor(() => expect(onDraftReady).toHaveBeenCalledWith(draft));
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(call[1].body);
      expect(body).toMatchObject({ destination: "website", websiteGoal: "leads" });
      expect(body).not.toHaveProperty("whatsappNumber");
    }
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).answers).toMatchObject([{ question: "Which city?", answer: "Jaipur" }]);
  });

  it("retries the same destination and goal after a failed request and reload", async () => {
    const draft = websiteDraft("sales");
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, draft }) });
    vi.stubGlobal("fetch", fetchMock);
    const onDraftReady = vi.fn();
    const first = render(<CampaignChat businessId={businessId} destination="website" websiteGoal="sales" websiteDraftMismatch={mismatch} onDraftReady={onDraftReady} />);
    start("Website purchases");
    await screen.findByRole("button", { name: "Retry" });
    first.unmount();
    render(<CampaignChat businessId={businessId} destination="website" websiteGoal="sales" websiteDraftMismatch={mismatch} onDraftReady={onDraftReady} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onDraftReady).toHaveBeenCalledWith(draft));
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ destination: "website", websiteGoal: "sales" });
  });

  it("isolates unfinished interviews by website goal, destination and business", () => {
    const { rerender } = render(<CampaignChat businessId={businessId} destination="website" websiteGoal="leads" websiteDraftMismatch={mismatch} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Website leads plan" } });
    rerender(<CampaignChat businessId={businessId} destination="website" websiteGoal="sales" websiteDraftMismatch={mismatch} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Website sales plan" } });
    rerender(<CampaignChat businessId={businessId} destination="instant_form" />);
    expect(screen.getByRole("textbox")).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Form plan" } });
    rerender(<CampaignChat businessId={businessId} destination="whatsapp" />);
    expect(screen.getByRole("textbox")).toHaveValue("");
    rerender(<CampaignChat businessId={businessId} destination="website" websiteGoal="leads" websiteDraftMismatch={mismatch} />);
    expect(screen.getByRole("textbox")).toHaveValue("Website leads plan");
    rerender(<CampaignChat businessId={businessId} destination="website" websiteGoal="sales" websiteDraftMismatch={mismatch} />);
    expect(screen.getByRole("textbox")).toHaveValue("Website sales plan");
    rerender(<CampaignChat businessId="22222222-2222-4222-8222-222222222222" destination="website" websiteGoal="sales" websiteDraftMismatch={mismatch} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("aborts an in-flight interview when the website goal changes", async () => {
    let complete!: (response: unknown) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const onDraftReady = vi.fn();
    const { rerender } = render(<CampaignChat businessId={businessId} destination="website" websiteGoal="leads" websiteDraftMismatch={mismatch} onDraftReady={onDraftReady} />);
    start();
    const signal = fetchMock.mock.calls[0][1].signal;
    rerender(<CampaignChat businessId={businessId} destination="website" websiteGoal="sales" websiteDraftMismatch={mismatch} onDraftReady={onDraftReady} />);
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("textbox")).toHaveValue("");
    await act(async () => { complete({ ok: true, json: async () => ({ ready: true, draft: websiteDraft() }) }); });
    expect(onDraftReady).not.toHaveBeenCalled();
    rerender(<CampaignChat businessId={businessId} destination="website" websiteGoal="leads" websiteDraftMismatch={mismatch} onDraftReady={onDraftReady} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it.each([
    ["another business", { ready: true, draft: { ...websiteDraft(), input: { ...websiteDraft().input, businessId: "22222222-2222-4222-8222-222222222222" } } }],
    ["another destination", { ready: true, draft: { ...websiteDraft(), input: { ...websiteDraft().input, destination: "whatsapp", websiteGoal: undefined } } }],
    ["another goal", { ready: true, draft: websiteDraft("sales") }],
    ["an omitted conversion goal", { ready: true, draft: websiteDraft(null) }],
    ["an incomplete draft", { ready: true, draft: { draftId: "bad" } }],
    ["a legacy campaign", { ready: true, campaign: { id: "already-created" } }],
    ["a missing draft", { ready: true }],
  ])("stops instead of accepting %s", async (_case, response) => {
    mockPlan(response);
    const onDraftReady = vi.fn();
    const onCreated = vi.fn();
    render(<CampaignChat businessId={businessId} destination="website" websiteGoal="leads" websiteDraftMismatch={mismatch} onDraftReady={onDraftReady} onCreated={onCreated} />);
    start();
    expect(await screen.findByText(mismatch)).toBeVisible();
    expect(onDraftReady).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("accepts the contract's omitted-goal default only for an explicitly chosen visits goal", async () => {
    const draft = websiteDraft(null);
    const fetchMock = mockPlan({ ready: true, draft });
    const onDraftReady = vi.fn();
    render(<CampaignChat businessId={businessId} destination="website" websiteGoal="visits" websiteDraftMismatch={mismatch} onDraftReady={onDraftReady} />);
    start();
    await waitFor(() => expect(onDraftReady).toHaveBeenCalledWith(draft));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ destination: "website", websiteGoal: "visits" });
  });
});
