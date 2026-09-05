// @vitest-environment jsdom
import {
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
  h.setCreativeStatus.mockResolvedValue({ ok: true });
  h.deleteCreative.mockResolvedValue({ ok: true });
  global.fetch = vi
    .fn()
    .mockResolvedValue(okJson({ creatives: [] })) as unknown as typeof fetch;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("<Studio> generation", () => {
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
