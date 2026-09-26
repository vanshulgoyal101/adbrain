// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "@/components/studio";
import type { Business, Creative } from "@/lib/types";

const h = vi.hoisted(() => ({
  setCreativeStatus: vi.fn(),
  deleteCreative: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock("@/app/(app)/studio/actions", () => ({
  setCreativeStatus: h.setCreativeStatus,
  deleteCreative: h.deleteCreative,
}));
vi.mock("@/lib/download", () => ({ downloadBlob: h.downloadBlob }));

const business = { id: "b1", name: "Solaride" } as unknown as Business;

const creative = (over: Partial<Creative> = {}): Creative =>
  ({
    id: "c1",
    business_id: "b1",
    brief: "monsoon offer",
    angle: "savings",
    image_url: "https://img.example/a.jpg",
    headline: "Cut your power bill",
    primary_text: "Two short lines.",
    cta: "Get Quote",
    status: "draft",
    ...over,
  }) as unknown as Creative;

const okJson = (body: unknown) => ({
  ok: true,
  json: async () => body,
  blob: async () => new Blob(["zip"]),
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  h.setCreativeStatus.mockResolvedValue({ ok: true });
  h.deleteCreative.mockResolvedValue({ ok: true });
  global.fetch = vi
    .fn()
    .mockResolvedValue(okJson({ creatives: [] })) as unknown as typeof fetch;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("<Studio> generation", () => {
  it("does not submit paid work when recovery identity cannot be persisted", async () => {
    const original = Storage.prototype.setItem;
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("adbrain:studio-generation:")) throw new Error("Storage blocked");
      original.call(this, key, value);
    });
    try {
      render(<Studio business={business} initialCreatives={[]} />);
      fireEvent.change(screen.getByLabelText(/what are we advertising/i), { target: { value: "Solar installation" } });
      fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));
      expect(await screen.findByRole("alert")).toHaveTextContent("No generation was started");
      expect(global.fetch).not.toHaveBeenCalled();
    } finally { storage.mockRestore(); }
  });

  it("holds a synchronous submit guard while the response is pending", async () => {
    let finish!: (value: unknown) => void;
    global.fetch = vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<Studio business={business} initialCreatives={[]} />);
    fireEvent.change(screen.getByLabelText(/what are we advertising/i), { target: { value: "Solar installation" } });
    const form = screen.getByRole("button", { name: /generate ads/i }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(global.fetch).toHaveBeenCalledOnce();
    finish(okJson({ creatives: [creative()] }));
    expect(await screen.findByRole("heading", { name: "Cut your power bill" })).toBeInTheDocument();
  });

  it("uses an existing business generation identity written by another tab", async () => {
    render(<Studio business={business} initialCreatives={[]} />);
    const intent = { generationId: "11111111-1111-4111-8111-111111111111", count: 3 };
    localStorage.setItem("adbrain:studio-generation:b1", JSON.stringify(intent));
    global.fetch = vi.fn().mockResolvedValue(okJson({ status: "complete", creatives: [creative(), creative({ id: "c2" }), creative({ id: "c3" })] }));
    fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain(`generationId=${intent.generationId}`);
    expect(vi.mocked(global.fetch).mock.calls[0][1]?.method).not.toBe("POST");
    await waitFor(() => expect(localStorage.getItem("adbrain:studio-generation:b1")).toBeNull());
  });

  it.each(["POST completion", "POST rejection", "GET recovery"])("preserves a newer pending identity after late %s", async (outcome) => {
    let finishFirst!: (value: unknown) => void;
    let finishSecond!: (value: unknown) => void;
    const saved = [creative(), creative({ id: "c2" }), creative({ id: "c3" })];
    const fetchMock = vi.fn();
    if (outcome === "GET recovery") fetchMock.mockRejectedValueOnce(new Error("Lost POST response"));
    fetchMock
      .mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }))
      .mockResolvedValueOnce(okJson({ status: "complete", creatives: saved }))
      .mockReturnValueOnce(new Promise(resolve => { finishSecond = resolve; }));
    global.fetch = fetchMock;
    const first = render(<Studio business={business} initialCreatives={[]} />);
    fireEvent.change(within(first.container).getByLabelText(/what are we advertising/i), { target: { value: "First offer" } });
    fireEvent.click(within(first.container).getByRole("button", { name: /generate ads/i }));
    const firstIntent = JSON.parse(localStorage.getItem("adbrain:studio-generation:b1")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(outcome === "GET recovery" ? 2 : 1));

    const second = render(<Studio business={business} initialCreatives={[]} />);
    const recoverButton = within(second.container).getByRole("button", { name: /check saved results/i });
    const secondForm = recoverButton.closest("form")!;
    fireEvent.click(recoverButton);
    await waitFor(() => expect(localStorage.getItem("adbrain:studio-generation:b1")).toBeNull());
    fireEvent.change(secondForm.querySelector("textarea")!, { target: { value: "Second offer" } });
    fireEvent.submit(secondForm);
    const secondIntent = JSON.parse(localStorage.getItem("adbrain:studio-generation:b1")!);
    expect(secondIntent.generationId).not.toBe(firstIntent.generationId);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(
      outcome === "GET recovery" ? ["POST", "GET", "GET", "POST"] : ["POST", "GET", "POST"],
    );

    try {
      await act(async () => {
        finishFirst(outcome === "POST rejection"
          ? { ok: false, status: 400, json: async () => ({ error: "Rejected first request" }) }
          : okJson({ status: "complete", creatives: saved }));
      });
      expect(JSON.parse(localStorage.getItem("adbrain:studio-generation:b1")!)).toEqual(secondIntent);
    } finally {
      await act(async () => { finishSecond(okJson({ creatives: saved })); });
    }
    expect(localStorage.getItem("adbrain:studio-generation:b1")).toBeNull();
  });

  it.each(["getItem", "removeItem"] as const)("retains recovery identity when cleanup %s fails", async (operation) => {
    let finish!: (value: unknown) => void;
    const saved = [creative(), creative({ id: "c2" }), creative({ id: "c3" })];
    const fetchMock = vi.fn()
      .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(okJson({ status: "complete", creatives: saved }));
    global.fetch = fetchMock;
    render(<Studio business={business} initialCreatives={[]} />);
    fireEvent.change(screen.getByLabelText(/what are we advertising/i), { target: { value: "Solar installation" } });
    const button = screen.getByRole("button", { name: /generate ads/i });
    const form = button.closest("form")!;
    fireEvent.click(button);
    const stored = localStorage.getItem("adbrain:studio-generation:b1");
    const failure = vi.spyOn(Storage.prototype, operation).mockImplementation(() => { throw new Error("Storage unavailable"); });
    try {
      await act(async () => { finish(okJson({ creatives: saved })); });
      expect(form).toHaveTextContent(/check saved results/i);
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    } finally { failure.mockRestore(); }
    expect(localStorage.getItem("adbrain:studio-generation:b1")).toBe(stored);
  });

  it("persists generation identity before POST and reconciles a lost response without another POST", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const payload = JSON.parse(init.body as string);
        expect(payload.generationId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(JSON.parse(localStorage.getItem("adbrain:studio-generation:b1")!)).toMatchObject({ generationId: payload.generationId, count: 3 });
        throw new Error("Lost response after save");
      }
      return okJson({ status: "partial", creatives: [creative()] });
    });
    global.fetch = fetchMock;
    const view = render(<Studio business={business} initialCreatives={[]} />);
    fireEvent.change(screen.getByLabelText(/what are we advertising/i), { target: { value: "Solar installation" } });
    fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));
    expect(await screen.findByRole("heading", { name: "Cut your power bill" })).toBeInTheDocument();
    view.unmount();
    render(<Studio business={business} initialCreatives={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: /check saved results/i }));
    expect(await screen.findByRole("heading", { name: "Cut your power bill" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("shows the saved description in the card and enlarged preview", async () => {
    render(<Studio business={business} initialCreatives={[creative({ generation: { concept: { description: "Discuss your rooftop plans." } } })]} />);
    expect(screen.getByText(/Discuss your rooftop plans/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview Cut your power bill" }));
    expect(within(await screen.findByRole("dialog")).getByText("Discuss your rooftop plans.")).toBeInTheDocument();
  });

  it("keeps successful creatives visible and reports a partial batch failure", async () => {
    global.fetch = vi.fn().mockResolvedValue(okJson({ creatives: [creative()], failures: [{ angle: "Trust", error: "Image unavailable" }] }));
    render(<Studio business={business} initialCreatives={[]} />);
    fireEvent.change(screen.getByLabelText(/what are we advertising/i), { target: { value: "Solar installation" } });
    fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("1 ads saved; 1 failed");
    expect(screen.getByRole("heading", { name: "Cut your power bill" })).toBeInTheDocument();
  });
  it("refuses to generate without a brief", async () => {
    render(<Studio business={business} initialCreatives={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));
    expect(
      await screen.findByText("Describe what you want to advertise."),
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends the brief, variant count and language", async () => {
    render(<Studio business={business} initialCreatives={[]} />);
    fireEvent.change(screen.getByLabelText(/what are we advertising/i), {
      target: { value: "Diwali offer in Jaipur" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(url).toBe("/api/creatives/generate");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      businessId: "b1",
      brief: "Diwali offer in Jaipur",
    });
  });

  it("prepends newly generated creatives", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        okJson({
          creatives: [creative({ id: "new", headline: "Fresh headline" })],
        }),
      ) as unknown as typeof fetch;

    render(<Studio business={business} initialCreatives={[creative()]} />);
    fireEvent.click(screen.getByText("New creative brief"));
    fireEvent.change(screen.getByLabelText(/what are we advertising/i), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));

    expect(
      await screen.findByRole("heading", { name: "Fresh headline" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cut your power bill")).toBeInTheDocument();
  });

  it("surfaces the server's reason for a failed generation", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "No LLM API keys configured." }),
    }) as unknown as typeof fetch;

    render(<Studio business={business} initialCreatives={[]} />);
    fireEvent.change(screen.getByLabelText(/what are we advertising/i), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));

    expect(
      await screen.findByText("No LLM API keys configured."),
    ).toBeInTheDocument();
  });

  it("handles a dropped connection", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    render(<Studio business={business} initialCreatives={[]} />);
    fireEvent.change(screen.getByLabelText(/what are we advertising/i), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate ads/i }));

    expect(
      await screen.findByText(/check your connection/i),
    ).toBeInTheDocument();
  });
});

describe("<Studio> approval", () => {
  it("approves a draft and reflects it immediately", async () => {
    render(<Studio business={business} initialCreatives={[creative()]} />);
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    await waitFor(() =>
      expect(h.setCreativeStatus).toHaveBeenCalledWith("c1", "approved"),
    );
    expect(
      await screen.findByRole("button", { name: /unapprove/i }),
    ).toBeInTheDocument();
  });

  it("unapproves an approved creative", async () => {
    render(
      <Studio
        business={business}
        initialCreatives={[creative({ status: "approved" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /unapprove/i }));
    await waitFor(() =>
      expect(h.setCreativeStatus).toHaveBeenCalledWith("c1", "draft"),
    );
  });
});

describe("<Studio> creative preview", () => {
  it("shows placement context and closes with Escape", () => {
    render(<Studio business={business} initialCreatives={[creative()]} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Preview Cut your power bill" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Review before approval" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Meta feed preview")).toBeInTheDocument();
    expect(screen.getByText("Solaride")).toBeInTheDocument();
    expect(screen.getByText("Facebook and Instagram feed")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("<Studio> deletion", () => {
  it("confirms before deleting and then removes the card", async () => {
    render(<Studio business={business} initialCreatives={[creative()]} />);
    fireEvent.click(screen.getByRole("button", { name: /delete creative/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(h.deleteCreative).toHaveBeenCalledWith("c1"));
    await waitFor(() =>
      expect(screen.queryByText("Cut your power bill")).toBeNull(),
    );
  });

  it("keeps the creative when the owner cancels", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Studio business={business} initialCreatives={[creative()]} />);
    fireEvent.click(screen.getByRole("button", { name: /delete creative/i }));
    expect(h.deleteCreative).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Cut your power bill" }),
    ).toBeInTheDocument();
  });
});

describe("<Studio> regenerate", () => {
  it("replaces a single variant in place", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        okJson({
          creative: creative({ id: "c1", headline: "Regenerated line" }),
        }),
      ) as unknown as typeof fetch;

    render(<Studio business={business} initialCreatives={[creative()]} />);
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate creative/i }),
    );

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/creatives/c1/regenerate",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("reports a regeneration failure on the card", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Rate limited." }),
    }) as unknown as typeof fetch;

    render(<Studio business={business} initialCreatives={[creative()]} />);
    fireEvent.click(
      screen.getByRole("button", { name: /regenerate creative/i }),
    );
    expect(await screen.findByText("Rate limited.")).toBeInTheDocument();
  });
});

describe("<Studio> export", () => {
  it("is disabled until something is approved", () => {
    render(<Studio business={business} initialCreatives={[creative()]} />);
    expect(
      screen.getByRole("button", { name: /export approved/i }),
    ).toBeDisabled();
  });

  it("counts the approved creatives", () => {
    render(
      <Studio
        business={business}
        initialCreatives={[
          creative({ status: "approved" }),
          creative({ id: "c2" }),
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /export approved \(1\)/i }),
    ).toBeEnabled();
  });

  it("downloads a zip of only the approved creatives", async () => {
    render(
      <Studio
        business={business}
        initialCreatives={[creative({ status: "approved" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /export approved/i }));

    await waitFor(() => expect(h.downloadBlob).toHaveBeenCalledOnce());
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      creativeIds: ["c1"],
    });
    expect(h.downloadBlob.mock.calls[0][1]).toBe("adbrain-ad-pack.zip");
    expect(await screen.findByText("Ad pack downloaded.")).toBeInTheDocument();
  });

  it("reports an export failure", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }) as unknown as typeof fetch;
    render(
      <Studio
        business={business}
        initialCreatives={[creative({ status: "approved" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /export approved/i }));

    expect(await screen.findByText("Export failed.")).toBeInTheDocument();
    expect(h.downloadBlob).not.toHaveBeenCalled();
  });
});

describe("<Studio> empty state", () => {
  it("nudges the owner to generate their first batch", () => {
    render(<Studio business={business} initialCreatives={[]} />);
    expect(screen.getByText(/generate your first batch/i)).toBeInTheDocument();
  });
});

describe("<Studio> review board", () => {
  it("opens a requested creative in the inspector", () => {
    render(
      <Studio
        business={business}
        initialCreatives={[
          creative(),
          creative({ id: "second", headline: "Second concept" }),
        ]}
        initialCreativeId="second"
      />,
    );
    expect(
      within(
        screen.getByRole("region", { name: "Creative inspector" }),
      ).getByRole("heading", { name: "Second concept" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Inspect Second concept" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("filters, searches, and clears an empty result", async () => {
    const user = userEvent.setup();
    render(
      <Studio
        business={business}
        initialCreatives={[
          creative(),
          creative({
            id: "second",
            headline: "Second concept",
            status: "approved",
          }),
        ]}
        initialFilter="approved"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Inspect Cut your power bill" }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("searchbox", { name: "Search creatives" }),
      "no match",
    );
    expect(screen.getByText("No matching creatives")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(
      screen.getByRole("button", { name: "Inspect Cut your power bill" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Inspect Second concept" }),
    ).toBeInTheDocument();
  });

  it("advances to the next draft when approval removes the selected item from the filter", async () => {
    render(
      <Studio
        business={business}
        initialCreatives={[
          creative(),
          creative({ id: "second", headline: "Second concept" }),
        ]}
        initialFilter="draft"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Inspect Cut your power bill" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: "Second concept" }),
    ).toBeInTheDocument();
  });

  it("keeps a failed approval visible and retryable", async () => {
    const user = userEvent.setup();
    h.setCreativeStatus.mockResolvedValueOnce({
      ok: false,
      error: "Save failed",
    });
    render(<Studio business={business} initialCreatives={[creative()]} />);
    await user.click(screen.getByRole("button", { name: /^approve$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(
      screen.getByRole("button", { name: /export approved/i }),
    ).toBeDisabled();
    const retry = screen.getByRole("button", { name: /^approve$/i });
    await waitFor(() => expect(retry).toBeEnabled());
    await user.click(retry);
    await waitFor(() => expect(h.setCreativeStatus).toHaveBeenCalledTimes(2));
    expect(h.setCreativeStatus).toHaveBeenNthCalledWith(2, "c1", "approved");
    expect(
      await screen.findByRole("button", { name: /unapprove/i }),
    ).toBeInTheDocument();
  });

  it("keeps a creative after a thrown delete error", async () => {
    h.deleteCreative.mockRejectedValueOnce(new Error("offline"));
    render(<Studio business={business} initialCreatives={[creative()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete creative" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't delete the creative",
    );
    expect(
      screen.getByRole("heading", { name: "Cut your power bill" }),
    ).toBeInTheDocument();
  });

  it("keeps keyboard focus in the preview and restores it on Escape", async () => {
    const user = userEvent.setup();
    render(<Studio business={business} initialCreatives={[creative()]} />);
    const trigger = screen.getByRole("button", {
      name: "Preview Cut your power bill",
    });
    await user.click(trigger);
    const close = screen.getByRole("button", { name: "Close preview" });
    expect(close).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("marks Review as the current workflow step for unapproved ads", () => {
    render(
      <Studio
        business={business}
        initialCreatives={[creative({ image_url: null })]}
      />,
    );
    expect(
      screen.getByText("Review", { selector: "p" }).closest("li"),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Image unavailable")).toBeInTheDocument();
  });
});
