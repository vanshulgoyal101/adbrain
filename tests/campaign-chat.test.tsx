// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignChat } from "@/components/campaign-chat";

// The interview is now persisted per business, so drafts must not leak between tests.
beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function mockPlan(...responses: unknown[]) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({ ok: true, json: async () => r });
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("<CampaignChat>", () => {
  it("offers an editor handoff and preserves answered context after reload", async () => {
    const fetchMock = mockPlan({ ready: false, questions: [
      { id: "location", topic: "location", question: "Which city?", type: "text" },
    ] }, { ready: false, questions: [], handoff: { reason: "no_progress", message: "Your answers are saved. Continue in the editor." } });
    const onEditManually = vi.fn();
    const first = render(<CampaignChat businessId="biz-1" onEditManually={onEditManually} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Solar enquiries" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Which city?" }), { target: { value: "Hisar, 20 km" } });
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await screen.findByRole("button", { name: "Continue in editor" });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send answers" })).toBeNull();
    first.unmount();
    render(<CampaignChat businessId="biz-1" onEditManually={onEditManually} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue in editor" }));
    expect(onEditManually).toHaveBeenCalledWith("Solar enquiries\nWhich city?: Hisar, 20 km");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves question identity and explicitly records a skipped question", async () => {
    const fetchMock = mockPlan({ ready: false, questions: [
      { id: "location", topic: "location", question: "Which city?", type: "text" },
      { id: "exclusions", topic: "exclusions", question: "Any areas to exclude?", type: "text" },
    ] }, { ready: true, draft: { draftId: "saved-draft" } });
    render(<CampaignChat businessId="biz-1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Solar enquiries" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("Which city?");
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Hisar" } });
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await screen.findByRole("button", { name: "Plan another" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).answers).toEqual([
      { questionId: "location", topic: "location", question: "Which city?", answer: "Hisar", disposition: "answered" },
      { questionId: "exclusions", topic: "exclusions", question: "Any areas to exclude?", answer: "", disposition: "deferred" },
    ]);
  });

  it("aborts on unmount and does not deliver a late result", async () => {
    let complete!: (response: unknown) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    global.fetch = fetchMock;
    const onDraftReady = vi.fn();
    const { unmount } = render(<CampaignChat businessId="biz-1" onDraftReady={onDraftReady} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Solar enquiries" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    unmount();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { complete({ ok: true, json: async () => ({ ready: true, draft: { draftId: "obsolete" } }) }); });
    expect(onDraftReady).not.toHaveBeenCalled();
  });

  it.each([{}, { ready: true }, { ready: false, questions: [] }])("offers recovery for an incomplete planner response %j", async (response) => {
    mockPlan(response);
    const onDraftReady = vi.fn();
    render(<CampaignChat businessId="biz-1" onDraftReady={onDraftReady} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Solar enquiries" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Planning returned an incomplete response.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(onDraftReady).not.toHaveBeenCalled();
  });

  it("aborts a replaced destination and ignores its late draft response", async () => {
    let complete!: (response: unknown) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    global.fetch = fetchMock;
    const onDraftReady = vi.fn();
    const { rerender } = render(<CampaignChat businessId="biz-1" destination="instant_form" onDraftReady={onDraftReady} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Instant form goal" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const signal = fetchMock.mock.calls[0][1].signal;
    rerender(<CampaignChat businessId="biz-1" destination="whatsapp" onDraftReady={onDraftReady} />);
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("textbox")).toHaveValue("");
    await act(async () => { complete({ ok: true, json: async () => ({ ready: true, draft: { draftId: "old-draft" } }) }); });
    expect(onDraftReady).not.toHaveBeenCalled();
    expect(screen.queryByText(/Draft saved/)).toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    rerender(<CampaignChat businessId="biz-1" destination="instant_form" onDraftReady={onDraftReady} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
  });

  it("retries failed answers with the same payload", async () => {
    const fetchMock = mockPlan({ ready: false, questions: [{ id: "area", question: "Which city?", type: "single", options: ["Jaipur"] }] });
    fetchMock.mockRejectedValueOnce(new Error("Offline"));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, campaign: { id: "camp_1" } }) });
    const onCreated = vi.fn();
    render(<CampaignChat businessId="biz-1" onCreated={onCreated} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Solar enquiries" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(await screen.findByRole("button", { name: "Jaipur" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[2][1].body).toBe(fetchMock.mock.calls[1][1].body);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).answers).toEqual([{ questionId: "area", question: "Which city?", answer: "Jaipur", disposition: "answered" }]);
  });

  it("disables Start until a goal is typed", () => {
    render(<CampaignChat businessId="biz-1" onCreated={vi.fn()} />);
    const start = screen.getByRole("button", { name: /start/i });
    expect(start).toBeDisabled();

    const box = screen.getByPlaceholderText(/get more leads/i);
    fireEvent.change(box, { target: { value: "more solar leads" } });
    expect(start).toBeEnabled();
  });

  it("asks structured questions, then builds the campaign from answers", async () => {
    const onCreated = vi.fn();
    const fetchMock = mockPlan(
      {
        ready: false,
        questions: [
          {
            id: "area",
            question: "Which area do you want to target?",
            type: "single",
            options: ["Hisar", "Chandigarh"],
          },
        ],
      },
      {
        ready: true,
        summary: "Created a paused Leads campaign.",
        campaign: { id: "camp_1" },
      },
    );

    render(<CampaignChat businessId="biz-1" onCreated={onCreated} />);

    fireEvent.change(
      screen.getByPlaceholderText(/get more leads/i),
      { target: { value: "more solar leads" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    // The AI's question + its options render as clickable chips.
    expect(
      await screen.findByText("Which area do you want to target?"),
    ).toBeInTheDocument();
    const hisar = screen.getByRole("button", { name: "Hisar" });
    fireEvent.click(hisar);

    fireEvent.click(screen.getByRole("button", { name: /send answers/i }));

    // Second response is ready -> summary shows + onCreated fires with the campaign.
    expect(
      await screen.findByText(/Created a paused Leads campaign/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ id: "camp_1" }),
    );

    // The first call sends the goal; the second sends the collected answer.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(secondBody.answers[0]).toMatchObject({ answer: "Hisar" });
  });

  it("surfaces an error when planning fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Planning failed." }),
    }) as unknown as typeof fetch;

    render(<CampaignChat businessId="biz-1" onCreated={vi.fn()} />);
    fireEvent.change(
      screen.getByPlaceholderText(/get more leads/i),
      { target: { value: "x" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(await screen.findByText(/Planning failed/i)).toBeInTheDocument();
  });
});

describe("<CampaignChat> draft persistence", () => {
  it("persists completion before handing the saved draft to a parent that closes the planner", async () => {
    const fetchMock = mockPlan({ ready: true, draft: { draftId: "saved-draft" } });
    function Handoff() {
      const [open, setOpen] = useState(true);
      return open ? <CampaignChat businessId="biz-1" onDraftReady={() => setOpen(false)} /> : <button onClick={() => setOpen(true)}>Reopen planner</button>;
    }
    render(<Handoff />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Solar enquiries" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reopen planner" }));
    expect(screen.getByRole("button", { name: "Plan another" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("restores completed interviews without allowing another send", async () => {
    const fetchMock = mockPlan({ ready: true, campaign: { id: "camp_1" } });
    const first = render(<CampaignChat businessId="biz-1" onCreated={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Solar enquiries" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByRole("button", { name: "Plan another" });
    first.unmount();
    render(<CampaignChat businessId="biz-1" onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Plan another" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps typed goals separate when the destination changes", () => {
    const { rerender } = render(<CampaignChat businessId="biz-1" destination="instant_form" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Form enquiries" } });
    rerender(<CampaignChat businessId="biz-1" destination="whatsapp" />);
    expect(screen.getByRole("textbox")).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "WhatsApp conversations" } });
    rerender(<CampaignChat businessId="biz-1" destination="instant_form" />);
    expect(screen.getByRole("textbox")).toHaveValue("Form enquiries");
    rerender(<CampaignChat businessId="biz-1" destination="whatsapp" />);
    expect(screen.getByRole("textbox")).toHaveValue("WhatsApp conversations");
  });

  it("keeps a typed goal when the tab changes and comes back", () => {
    const first = render(<CampaignChat businessId="biz-1" onCreated={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "More leads in Austin" },
    });
    first.unmount();

    render(<CampaignChat businessId="biz-1" onCreated={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveValue("More leads in Austin");
  });

  it("keeps drafts separate per business", () => {
    const first = render(<CampaignChat businessId="biz-1" onCreated={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Austin plan" },
    });
    first.unmount();

    render(<CampaignChat businessId="biz-2" onCreated={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("ignores a corrupted draft rather than crashing", () => {
    sessionStorage.setItem("adbrain:campaign-chat:biz-1", "{not json");
    render(<CampaignChat businessId="biz-1" onCreated={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
