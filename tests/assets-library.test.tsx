// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "@/lib/download";
import { AssetsLibrary } from "@/components/assets-library";
import type { BrandAsset, Creative } from "@/lib/types";

vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const creative = (over: Partial<Creative>): Creative =>
  ({
    id: "c1",
    business_id: "b1",
    image_url: "https://example.com/a.jpg",
    headline: "Slash your power bill",
    angle: "savings",
    status: "approved",
    ...over,
  }) as unknown as Creative;

const asset = (over: Partial<BrandAsset>): BrandAsset =>
  ({
    id: "a1",
    business_id: "b1",
    url: "https://example.com/logo.png",
    type: "logo",
    notes: null,
    ...over,
  }) as unknown as BrandAsset;

describe("<AssetsLibrary>", () => {
  it("shows clipboard failures without claiming the link was copied", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<AssetsLibrary creatives={[creative({})]} brandAssets={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy the link");
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("reports a failed download and leaves the original link accessible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<AssetsLibrary creatives={[creative({})]} brandAssets={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Download failed");
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "https://example.com/a.jpg");
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("uses the actual image format rather than mislabelling PNG bytes as JPEG", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }));
    render(<AssetsLibrary creatives={[creative({})]} brandAssets={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, "adbrain-slash-your-power-bill.png"));
  });

  it("does not download an HTML error page as an image", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["error"], { type: "text/html" }) }));
    render(<AssetsLibrary creatives={[creative({})]} brandAssets={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await screen.findByRole("alert");
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("renders both sections with counts", () => {
    render(
      <AssetsLibrary
        creatives={[creative({}), creative({ id: "c2", status: "draft" })]}
        brandAssets={[asset({})]}
      />,
    );
    expect(screen.getByText("AI-generated creatives")).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
    expect(screen.getByText("Uploaded brand assets")).toBeInTheDocument();
    expect(screen.getByText("(1)")).toBeInTheDocument();
    expect(screen.getByText("Generated").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Ready to launch").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Brand uploads").nextSibling).toHaveTextContent("1");
  });

  it("shows a generated creative with its headline and reuse actions", () => {
    render(<AssetsLibrary creatives={[creative({})]} brandAssets={[]} />);
    expect(screen.getByText("Slash your power bill")).toBeInTheDocument();
    expect(screen.getByText("savings")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText("Copy link")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("skips creatives without an image", () => {
    render(
      <AssetsLibrary
        creatives={[creative({ image_url: null })]}
        brandAssets={[]}
      />,
    );
    expect(
      screen.getByText(/No generated images yet/i),
    ).toBeInTheDocument();
  });

  it("shows empty states when there's nothing", () => {
    render(<AssetsLibrary creatives={[]} brandAssets={[]} />);
    expect(screen.getByText(/No generated images yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No uploads yet/i)).toBeInTheDocument();
  });
});
