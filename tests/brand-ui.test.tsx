// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandForm } from "@/components/brand-form";
import { BrandAssets } from "@/components/brand-assets";
import { Instructions } from "@/components/instructions";
import type { AdInstruction, BrandAsset, Business } from "@/lib/types";

// vi.mock factories are hoisted above module scope, so the spies must be too.
const h = vi.hoisted(() => ({
  saveBusiness: vi.fn(),
  saveInstruction: vi.fn(),
  deleteInstruction: vi.fn(),
  refresh: vi.fn(),
  storageFrom: vi.fn(),
  databaseFrom: vi.fn(),
}));
const { saveBusiness, saveInstruction, deleteInstruction } = h;

vi.mock("@/app/(app)/brand/actions", () => ({ saveBusiness: h.saveBusiness }));
vi.mock("@/app/(app)/brand/instruction-actions", () => ({
  saveInstruction: h.saveInstruction,
  deleteInstruction: h.deleteInstruction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: h.storageFrom }, from: h.databaseFrom }),
}));

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
  it("updates an untouched logo field after an asset upload or deletion refresh", () => {
    const { container, rerender } = render(<BrandForm business={business({ logo_url: "https://example.com/old.png" })} />);
    rerender(<BrandForm business={business({ logo_url: "https://example.com/new.png" })} />);
    expect(container.querySelector('[name="logo_url"]')).toHaveValue("https://example.com/new.png");
    rerender(<BrandForm business={business({ logo_url: null })} />);
    expect(container.querySelector('[name="logo_url"]')).toHaveValue("");
  });

  it("does not overwrite an explicit unsaved logo edit on refresh", () => {
    const { container, rerender } = render(<BrandForm business={business()} />);
    fireEvent.change(container.querySelector('[name="logo_url"]')!, { target: { value: "https://example.com/manual.png" } });
    rerender(<BrandForm business={business({ logo_url: "https://example.com/upload.png" })} />);
    expect(container.querySelector('[name="logo_url"]')).toHaveValue("https://example.com/manual.png");
  });

  it.each(["image/svg+xml", "image/gif", "text/html", ""])("rejects unsupported asset type %s before uploading", (type) => {
    render(<BrandAssets businessId="b1" initialAssets={[]} />);
    fireEvent.change(screen.getByLabelText("Image file"), {
      target: { files: [new File(["asset"], "asset", { type })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(screen.getByText("Choose a PNG, JPEG or WebP image.")).toBeInTheDocument();
    expect(h.storageFrom).not.toHaveBeenCalled();
  });

  it("starts empty for a brand new business", () => {
    render(<BrandForm business={null} />);
    expect(screen.getByPlaceholderText("Your business name")).toHaveValue("");
    expect(screen.getByPlaceholderText("example.com")).toHaveValue("");
  });

  it("joins list fields the way the server action expects", () => {
    const { container } = render(<BrandForm business={business()} />);
    const value = (name: string) =>
      (container.querySelector(`[name="${name}"]`) as HTMLTextAreaElement | HTMLInputElement)
        ?.value;
    // Every list field is newline-joined: an entry may itself contain a comma
    // ("Austin, Texas"), so a comma can never act as the separator.
    expect(value("languages")).toBe("English\nHindi");
    expect(value("locations")).toBe("Jaipur\nAjmer");
    expect(value("usps")).toBe(
      "Affordable, transparent pricing\n25-year warranty",
    );
  });

  it("carries the business id so the action updates instead of inserting", () => {
    const { container } = render(<BrandForm business={business()} />);
    const hidden = container.querySelector('input[name="id"]');
    expect(hidden).toHaveValue("b1");
  });

  it("previews the context AdBrain will use and updates as fields change", () => {
    render(<BrandForm business={business()} />);
    const preview = screen.getByRole("region", { name: "Live brand context" });
    expect(preview).toHaveTextContent("Free survey");
    expect(preview).toHaveTextContent("For homeowners in Jaipur");
    expect(preview).toHaveTextContent("warm voice");

    fireEvent.change(screen.getByLabelText("Target audience"), {
      target: { value: "apartment owners" },
    });
    expect(preview).toHaveTextContent("For apartment owners in Jaipur");
  });

  it("updates brand readiness as missing context is supplied", () => {
    render(<BrandForm business={business({ target_audience: "" })} />);
    const preview = screen.getByRole("region", { name: "Live brand context" });
    expect(preview).toHaveTextContent("3 of 4 ready");

    fireEvent.change(screen.getByLabelText("Target audience"), {
      target: { value: "apartment owners" },
    });

    expect(preview).toHaveTextContent("4 of 4 ready");
  });
});

describe("<BrandAssets> persistence", () => {
  const asset = { id: "asset-1", business_id: "b1", type: "logo", url: "https://storage.example/storage/v1/object/public/brand-assets/b1/logo/file.png", notes: "Main logo" } as BrandAsset;
  function setup({ recordError = false, logoError = false, storageError = false } = {}) {
    const remove = vi.fn().mockResolvedValue({ error: storageError ? { message: "storage failed" } : null });
    const upload = vi.fn().mockResolvedValue({ error: null });
    h.storageFrom.mockReturnValue({ remove, upload, getPublicUrl: () => ({ data: { publicUrl: asset.url } }) });
    const filters = vi.fn();
    h.databaseFrom.mockImplementation((table: string) => {
      const failed = table === "businesses" ? logoError : recordError;
      const result = { data: failed ? null : asset, error: failed ? { message: "write failed" } : null };
      const query = {
        update: () => query, insert: () => query, delete: () => query, select: () => query,
        eq: (key: string, value: string) => { filters(key, value); return query; },
        single: async () => result, maybeSingle: async () => result,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    });
    return { remove, upload, filters };
  }
  function uploadFile() {
    fireEvent.change(screen.getByLabelText("Image file"), { target: { files: [new File(["image"], "logo.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  }

  it("cleans up an uploaded file when its asset record cannot be saved", async () => {
    const { remove } = setup({ recordError: true });
    render(<BrandAssets businessId="b1" initialAssets={[]} />);
    uploadFile();
    expect(await screen.findByRole("alert")).toHaveTextContent("write failed");
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^b1\/logo\//)]);
    expect(screen.queryByRole("button", { name: "Delete asset" })).toBeNull();
  });

  it("keeps a saved asset visible and reports a failed brand logo assignment", async () => {
    setup({ logoError: true });
    render(<BrandAssets businessId="b1" initialAssets={[]} />);
    uploadFile();
    expect(await screen.findByRole("alert")).toHaveTextContent("Asset saved, but the brand logo could not be updated");
    expect(screen.getByRole("button", { name: "Delete asset" })).toBeInTheDocument();
  });

  it("never deletes a file when record deletion fails", async () => {
    const { remove } = setup({ recordError: true });
    render(<BrandAssets businessId="b1" initialAssets={[asset]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete asset" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("write failed");
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "Main logo" })).toBeInTheDocument();
  });

  it("clears only the matching brand logo and then removes the confirmed asset file", async () => {
    const { remove, filters } = setup();
    render(<BrandAssets businessId="b1" initialAssets={[asset]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete asset" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(["b1/logo/file.png"]));
    expect(filters).toHaveBeenCalledWith("logo_url", asset.url);
    expect(filters).toHaveBeenCalledWith("business_id", "b1");
    expect(screen.queryByRole("img", { name: "Main logo" })).toBeNull();
  });

  it("reports storage cleanup failure without pretending the asset record still exists", async () => {
    setup({ storageError: true });
    render(<BrandAssets businessId="b1" initialAssets={[asset]} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete asset" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("its stored file could not be deleted");
    expect(screen.queryByRole("img", { name: "Main logo" })).toBeNull();
  });
});

describe("<BrandForm> autofill", () => {
  it("preserves edits made while website extraction is in flight", async () => {
    let finish!: (response: unknown) => void;
    global.fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; })) as typeof fetch;
    render(<BrandForm business={business()} />);
    fireEvent.click(screen.getByRole("button", { name: /autofill/i }));
    expect(screen.getByRole("button", { name: /Save Brand Brain/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Target audience"), { target: { value: "Owner's new audience" } });
    finish({ ok: true, json: async () => ({ extraction: { description: "Extracted description", target_audience: "Website audience" } }) });
    await screen.findByDisplayValue("Extracted description");
    expect(screen.getByLabelText("Target audience")).toHaveValue("Owner's new audience");
  });

  it("discards an extraction from a website the owner has since changed", async () => {
    let finish!: (response: unknown) => void;
    global.fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; })) as typeof fetch;
    render(<BrandForm business={business()} />);
    fireEvent.click(screen.getByRole("button", { name: /autofill/i }));
    fireEvent.change(screen.getByPlaceholderText("example.com"), { target: { value: "https://different.example" } });
    finish({ ok: true, json: async () => ({ extraction: { description: "Wrong website description" } }) });
    expect(await screen.findByText(/Website changed during autofill/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Rooftop solar")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Wrong website description")).toBeNull();
  });

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
    ).toBe("English\nHindi");
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
  it("retains edited content when saving loses the connection", async () => {
    saveInstruction.mockRejectedValueOnce(new Error("offline"));
    render(<Instructions businessId="b1" instructions={[instruction()]} />);
    fireEvent.change(screen.getByDisplayValue("Tone rules"), { target: { value: "Unsaved rules" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/Your edits are still here/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Unsaved rules")).toBeInTheDocument();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("shows a retryable error when deleting loses the connection", async () => {
    deleteInstruction.mockRejectedValueOnce(new Error("offline"));
    render(<Instructions businessId="b1" instructions={[instruction()]} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(await screen.findByText("Could not delete. Check your connection and retry.")).toBeInTheDocument();
    expect(h.refresh).not.toHaveBeenCalled();
  });

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
