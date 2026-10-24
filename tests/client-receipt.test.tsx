// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenerationDetails } from "@/components/generation-details";
import { savedCreativeDescription } from "@/lib/creative/concept";
import { buildAdDesign } from "@/lib/creative/design";
import { pictureDesign } from "@/lib/creative/picture-words";
import { clientCreative, clientReceipt } from "@/lib/creative/client-receipt";
import type { Creative } from "@/lib/types";

// #360: Review sent every ad's full generation receipt to the phone (592 KB of HTML).
const brand = { name: "Solaride", phone: "+91 98290 12345" };
const concept = {
  headline: "Cut your bill", primary_text: "Rooftop solar.", description: "Free site visit", cta: "Get Quote",
  rationale: "Leads with savings.", supportingText: "Free site visit", visual: { medium: "Photo", direction: "x".repeat(2000), textPlacement: "top" },
  sourceQuotes: ["Free site visit"],
};
const full = {
  version: "creative-concept-v2", concept, imagePrompt: "p".repeat(4000), format: "square",
  design: { ...buildAdDesign({ brand, copy: concept, format: "square" }), backgroundUrl: undefined },
  photoUrl: "https://cdn/x.png", language: "English", referenceImages: ["https://cdn/r.png"], sourceFacts: ["f".repeat(2000)],
  composition: "overlay", textModels: [{ provider: "openrouter", model: "qwen" }],
  image: { provider: "openrouter-image", model: "gpt-image", estimatedCostUsd: 0.04, latencyMs: 9000, providerRequestId: "gen-1" },
  imageAttempts: [{ provider: "openrouter-image", status: "success" }], ownerPhoto: null,
};
const row = { id: "c1", headline: "Cut your bill", primary_text: "Rooftop solar.", cta: "Get Quote", angle: "Special offer / incentive", generation: JSON.parse(JSON.stringify(full)) } as unknown as Creative;

describe("clientReceipt (#360)", () => {
  it("drops what the browser never reads and is much smaller", () => {
    const trimmed = clientReceipt(row.generation);
    expect(JSON.stringify(trimmed).length).toBeLessThan(JSON.stringify(full).length / 4);
    for (const key of ["imagePrompt", "sourceFacts", "imageAttempts", "referenceImages", "photoUrl"]) expect(trimmed).not.toHaveProperty(key);
    expect(JSON.stringify(trimmed)).not.toContain("x".repeat(100));
  });

  it("keeps everything the Review screens show: details, description and the words-on-picture spec", () => {
    const slim = clientCreative(row);
    const html = (value: unknown) => render(<GenerationDetails value={value} />).container.innerHTML;
    expect(html(slim.generation)).toBe(html(row.generation));
    expect(html(slim.generation)).toContain("Leads with savings.");
    expect(savedCreativeDescription(slim.generation)).toBe("Free site visit");
    expect(pictureDesign(slim, brand)).toEqual(pictureDesign(row, brand));
    const older = { ...row, generation: { format: "story", concept } } as unknown as Creative;
    expect(pictureDesign(clientCreative(older), brand)).toEqual(pictureDesign(older, brand));
  });

  it("passes through empty and odd receipts", () => {
    expect(clientReceipt(null)).toBeNull();
    expect(clientReceipt("x")).toBeNull();
    expect(clientReceipt({})).toEqual({});
  });
});
