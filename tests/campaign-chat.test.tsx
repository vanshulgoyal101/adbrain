// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignChat } from "@/components/campaign-chat";

afterEach(() => {
  vi.restoreAllMocks();
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
  it("disables Start until a goal is typed", () => {
    render(<CampaignChat onCreated={vi.fn()} />);
    const start = screen.getByRole("button", { name: /start/i });
    expect(start).toBeDisabled();

    const box = screen.getByPlaceholderText(/get more rooftop solar leads/i);
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

    render(<CampaignChat onCreated={onCreated} />);

    fireEvent.change(
      screen.getByPlaceholderText(/get more rooftop solar leads/i),
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

    render(<CampaignChat onCreated={vi.fn()} />);
    fireEvent.change(
      screen.getByPlaceholderText(/get more rooftop solar leads/i),
      { target: { value: "x" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(await screen.findByText(/Planning failed/i)).toBeInTheDocument();
  });
});
