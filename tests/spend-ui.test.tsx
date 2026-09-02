// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpendStatusBanner } from "@/components/spend-status";
import { SpendGuardrails } from "@/components/spend-guardrails";
import { evaluateSpend, type SpendLimits } from "@/lib/campaign/spend";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const limits = (over: Partial<SpendLimits> = {}): SpendLimits => ({
  weeklyCapRupees: 7000,
  alertPct: 80,
  autoPause: false,
  ...over,
});

/** Build a real evaluation so the UI is tested against the true domain logic. */
const evalWith = (dailyBudget: number, spend = 0, over: Partial<SpendLimits> = {}) =>
  evaluateSpend(
    [{ id: "c1", status: "active", dailyBudget, spend }],
    limits(over),
  );

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  }) as unknown as typeof fetch;
});

describe("<SpendStatusBanner>", () => {
  it("stays out of the way while spend is healthy", () => {
    const { container } = render(<SpendStatusBanner evaluation={evalWith(200)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no cap is configured", () => {
    const { container } = render(
      <SpendStatusBanner evaluation={evalWith(5000, 0, { weeklyCapRupees: null })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("warns as the cap approaches", () => {
    // 800/day → 5,600/week of a 7,000 cap = 80%.
    render(<SpendStatusBanner evaluation={evalWith(800)} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("80% of your weekly ad-spend cap");
    expect(alert).toHaveTextContent("left");
  });

  it("escalates once the cap is hit", () => {
    render(<SpendStatusBanner evaluation={evalWith(0, 7500)} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("hit your weekly ad-spend cap");
    expect(alert).toHaveTextContent(/pause a campaign or raise the cap/i);
  });

  it("always offers a way to manage the guardrails", () => {
    render(<SpendStatusBanner evaluation={evalWith(0, 7500)} />);
    expect(screen.getByRole("link", { name: /manage guardrails/i })).toHaveAttribute(
      "href",
      "/settings",
    );
  });
});

describe("<SpendGuardrails>", () => {
  const renderForm = (over: Partial<SpendLimits> = {}) =>
    render(
      <SpendGuardrails
        limits={limits(over)}
        evaluation={evaluateSpend([], limits(over))}
      />,
    );

  it("prefills the saved guardrails", () => {
    renderForm({ weeklyCapRupees: 5000, alertPct: 65, autoPause: true });
    expect(screen.getByLabelText("Weekly cap (₹)")).toHaveValue(5000);
    expect(screen.getByLabelText("Warn at (% of cap)")).toHaveValue(65);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("shows a blank cap field when there is no cap", () => {
    renderForm({ weeklyCapRupees: null });
    expect(screen.getByLabelText("Weekly cap (₹)")).toHaveValue(null);
  });

  it("saves the guardrails and refreshes the page data", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Weekly cap (₹)"), {
      target: { value: "9000" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /save guardrails/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("/api/spend-limits");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      weeklyCapRupees: 9000,
      autoPause: true,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("sends null when the cap is cleared, meaning no cap", async () => {
    renderForm({ weeklyCapRupees: 5000 });
    fireEvent.change(screen.getByLabelText("Weekly cap (₹)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save guardrails/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).weeklyCapRupees).toBeNull();
  });

  it("surfaces a server rejection instead of claiming success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Alert threshold must be between 1 and 100." }),
    }) as unknown as typeof fetch;

    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /save guardrails/i }));

    expect(
      await screen.findByText("Alert threshold must be between 1 and 100."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Saved.")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the usage meter only when a cap exists", () => {
    const { rerender } = renderForm({ weeklyCapRupees: null });
    expect(screen.queryByText(/% used/)).toBeNull();

    rerender(
      <SpendGuardrails
        limits={limits()}
        evaluation={evalWith(200)}
      />,
    );
    expect(screen.getByText(/% used/)).toBeInTheDocument();
  });
});
