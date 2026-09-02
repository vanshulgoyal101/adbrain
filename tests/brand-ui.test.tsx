// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandForm } from "@/components/brand-form";
import { Instructions } from "@/components/instructions";
import type { AdInstruction, Business } from "@/lib/types";

// vi.mock factories are hoisted above module scope, so the spies must be too.
const h = vi.hoisted(() => ({
  saveBusiness: vi.fn(),
  saveInstruction: vi.fn(),
  deleteInstruction: vi.fn(),
  refresh: vi.fn(),
}));
const { saveBusiness, saveInstruction, deleteInstruction } = h;

vi.mock("@/app/(app)/brand/actions", () => ({ saveBusiness: h.saveBusiness }));
vi.mock("@/app/(app)/brand/instruction-actions", () => ({
  saveInstruction: h.saveInstruction,
  deleteInstruction: h.deleteInstruction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));

const business = (over: Partial<Business> = {}): Business =>
  ({
    id: "b1",
    name: "Solaride",
    vertical: "solar energy",
    website: "https://solaride.in",
    description: "Rooftop solar",
    brand_voice: "warm",
    primary_color: "#2563EB",
    secondary_color: null,
    font: null,
    target_audience: "homeowners",
    languages: ["English", "Hindi"],
    locations: ["Jaipur", "Ajmer"],
    usps: ["Affordable, transparent pricing", "25-year warranty"],
    offers: ["Free survey"],
    logo_url: null,
    ...over,
  }) as unknown as Business;

const instruction = (over: Partial<AdInstruction> = {}): AdInstruction =>
  ({
    id: "i1",
    business_id: "b1",
    title: "Tone rules",
    content: "Be warm and concrete.",
    is_active: true,
    ...over,
  }) as unknown as AdInstruction;

beforeEach(() => {
  vi.clearAllMocks();
  saveBusiness.mockResolvedValue({ ok: true });
  saveInstruction.mockResolvedValue({ ok: true });
  deleteInstruction.mockResolvedValue({ ok: true });
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ extraction: {} }),
  }) as unknown as typeof fetch;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("<BrandForm> prefill", () => {
  it("starts empty for a brand new business", () => {
    render(<BrandForm business={null} />);
    expect(screen.getByPlaceholderText("Solaride")).toHaveValue("");
  });

  it("joins list fields the way the server action expects", () => {
    const { container } = render(<BrandForm business={business()} />);
    const value = (name: string) =>
      (container.querySelector(`[name="${name}"]`) as HTMLTextAreaElement | HTMLInputElement)
        ?.value;
    // Comma-joined: languages/locations split on comma OR newline.
    expect(value("languages")).toBe("English, Hindi");
    expect(value("locations")).toBe("Jaipur, Ajmer");
    // Newline-joined: a USP may itself contain a comma.
    expect(value("usps")).toBe(
      "Affordable, transparent pricing\n25-year warranty",
    );
  });

  it("carries the business id so the action updates instead of inserting", () => {
    const { container } = render(<BrandForm business={business()} />);
    const hidden = container.querySelector('input[name="id"]');
    expect(hidden).toHaveValue("b1");
  });
});

describe("<BrandForm> autofill", () => {
  it("insists on a website first", async () => {
    render(<BrandForm business={business({ website: null })} />);
    fireEvent.click(screen.getByRole("button", { name: /autofill/i }));
    expect(await screen.findByText("Enter your website URL first.")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("warns before overwriting work the owner already did", async () => {
    render(<BrandForm business={business()} />);
    fireEvent.click(screen.getByRole("button", { name: /autofill/i }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
  });

  it("aborts when the owner declines the overwrite", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BrandForm business={business()} />);
    fireEvent.click(screen.getByRole("button", { name: /autofill/i }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fills the extracted fields and formats the lists", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        extraction: {
          description: "Rooftop solar for homes",
          vertical: "solar energy",
          usps: ["Fast install", "Local team"],
          languages: ["English", "Hindi"],
        },
      }),
    }) as unknown as typeof fetch;

    const { container } = render(
      <BrandForm business={business({ description: "", usps: [], languages: [] })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /autofill/i }));

    expect(
      await screen.findByDisplayValue("Rooftop solar for homes"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        (container.querySelector('[name="usps"]') as HTMLTextAreaElement).value,
      ).toBe("Fast install\nLocal team"),
    );
    expect(
      (container.querySelector('[name="languages"]') as HTMLInputElement).value,
    ).toBe("English, Hindi");
  });

  it("keeps existing values for fields the extractor didn't return", async () => {
    render(<BrandForm business={business()} />);
    fireEvent.click(screen.getByRole("button", { name: /autofill/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByDisplayValue("Rooftop solar")).toBeInTheDocument();
  });

  it("shows the server's reason when autofill fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "That site could not be reached." }),
    }) as unknown as typeof fetch;

    render(<BrandForm business={business()} />);
    fireEvent.click(screen.getByRole("button", { name: /autofill/i }));
    expect(
      await screen.findByText("That site could not be reached."),
    ).toBeInTheDocument();
  });

  it("handles the request throwing", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    render(<BrandForm business={business()} />);
    fireEvent.click(screen.getByRole("button", { name: /autofill/i }));
    expect(await screen.findByText(/could not reach the site/i)).toBeInTheDocument();
  });
});

describe("<Instructions>", () => {
  it("explains what instruction files do", () => {
    render(<Instructions businessId="b1" instructions={[]} />);
    expect(screen.getByText(/fed into every generation/i)).toBeInTheDocument();
  });

  it("says when there are none", () => {
    render(<Instructions businessId="b1" instructions={[]} />);
    expect(screen.getByText("No instruction files yet.")).toBeInTheDocument();
  });

  it("reveals an editor when adding", () => {
    render(<Instructions businessId="b1" instructions={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(screen.queryByText("No instruction files yet.")).toBeNull();
    expect(screen.getByPlaceholderText(/title/i)).toBeInTheDocument();
  });

  it("lists the saved instruction files", () => {
    render(
      <Instructions
        businessId="b1"
        instructions={[instruction(), instruction({ id: "i2", title: "Offer rules" })]}
      />,
    );
    expect(screen.getByDisplayValue("Tone rules")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Offer rules")).toBeInTheDocument();
  });

  it("saves an edited instruction through the server action", async () => {
    render(<Instructions businessId="b1" instructions={[instruction()]} />);
    fireEvent.change(screen.getByDisplayValue("Tone rules"), {
      target: { value: "Tone rules v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(saveInstruction).toHaveBeenCalledOnce());
    expect(saveInstruction.mock.calls[0][0]).toMatchObject({
      id: "i1",
      businessId: "b1",
      title: "Tone rules v2",
    });
  });

  it("deletes an instruction after confirming", async () => {
    render(<Instructions businessId="b1" instructions={[instruction()]} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(deleteInstruction).toHaveBeenCalledWith("i1", "b1"),
    );
  });

  it("leaves the instruction alone if the owner cancels", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Instructions businessId="b1" instructions={[instruction()]} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(deleteInstruction).not.toHaveBeenCalled();
  });
});
