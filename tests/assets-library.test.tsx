// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssetsLibrary } from "@/components/assets-library";
import type { BrandAsset, Creative } from "@/lib/types";

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
