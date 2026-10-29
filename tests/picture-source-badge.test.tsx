// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PictureSourceBadge } from "@/components/picture-source-badge";
import { pictureSource } from "@/lib/creative/picture-source";
import { clientReceipt } from "@/lib/creative/client-receipt";

// #1901 item 2 (CPO words): every ad tile says whose picture it is: Your photo / AI picture.
const ownerPhoto = { image: { provider: "owner-photo", model: "brand_assets", estimatedCostUsd: 0 }, ownerPhoto: "https://x/p.jpg" };
const aiPicture = { image: { provider: "cloudflare", model: "flux-1-schnell", estimatedCostUsd: 0 } };

describe("picture source (#1901)", () => {
  it("reads the browser's receipt: the owner's photo, an AI picture, or unknown", () => {
    expect(pictureSource(clientReceipt(ownerPhoto))).toBe("yours");
    expect(pictureSource(clientReceipt(aiPicture))).toBe("ai");
    expect(pictureSource(null)).toBeNull();
    expect(pictureSource({ version: 1 })).toBeNull();
  });

  it("labels the tile in English and Hindi", () => {
    const { rerender } = render(<PictureSourceBadge generation={clientReceipt(ownerPhoto)} />);
    expect(screen.getByText("Your photo")).toBeInTheDocument();
    rerender(<PictureSourceBadge generation={clientReceipt(aiPicture)} />);
    expect(screen.getByText("AI picture")).toBeInTheDocument();
    rerender(<PictureSourceBadge generation={clientReceipt(ownerPhoto)} locale="hi" />);
    expect(screen.getByText("आपकी फ़ोटो")).toBeInTheDocument();
    rerender(<PictureSourceBadge generation={clientReceipt(aiPicture)} locale="hi" />);
    expect(screen.getByText("AI तस्वीर")).toBeInTheDocument();
  });

  it("shows nothing when the source is unknown", () => {
    const { container } = render(<PictureSourceBadge generation={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
