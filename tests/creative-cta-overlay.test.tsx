import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { buildAdDesign } from "@/lib/creative/design";
import { pictureDesign, pictureWordsOf, pictureWordsSchema, storedPictureDesign, withPictureWords } from "@/lib/creative/picture-words";
import { AdComposite } from "@/lib/creative/render";

// #760: Meta shows a real, tappable button under every ad; a painted one that doesn't tap reads as bait.
const brand = { name: "Solaride", phone: "+91 98290 12345", primary_color: "#f59e0b" };
const copy = { headline: "Cut your bill", primary_text: "Rooftop solar for Jaipur homes.", cta: "Get Quote" };

function hasText(node: unknown, text: string): boolean {
  if (node === text) return true;
  if (Array.isArray(node)) return node.some((child) => hasText(child, text));
  const el = node as ReactElement<{ children?: unknown }> | null;
  if (!el || typeof el !== "object" || !("props" in el)) return false;
  return hasText(el.props.children, text);
}

describe("button painted on the picture (#760)", () => {
  it("is off for new ads, and the render has no button", () => {
    const design = buildAdDesign({ brand, copy });
    expect(design.showCta).toBe(false);
    expect(hasText(AdComposite({ spec: design }), "Get Quote")).toBe(false);
  });

  it("is drawn when the owner opts in", () => {
    const design = withPictureWords(buildAdDesign({ brand, copy }), { ...pictureWordsOf(buildAdDesign({ brand, copy })), showCta: true, ctaLabel: "Call Now" });
    expect(design).toMatchObject({ showCta: true, ctaLabel: "Call Now" });
    expect(hasText(AdComposite({ spec: design }), "Call Now")).toBe(true);
  });

  it("keeps the button on ads saved before #760, so approved ads stay as they are", () => {
    const legacy: Record<string, unknown> = { ...buildAdDesign({ brand, copy }), backgroundUrl: undefined };
    delete legacy.showCta;
    expect(storedPictureDesign(JSON.parse(JSON.stringify(legacy)))?.showCta).toBe(true);
    expect(pictureDesign({ ...copy, angle: null, generation: null }, brand).showCta).toBe(true);
    const saved = JSON.parse(JSON.stringify({ ...buildAdDesign({ brand, copy }), backgroundUrl: undefined }));
    expect(storedPictureDesign(saved)?.showCta).toBe(false);
  });

  it("an editor that doesn't send the switch leaves the picture's button as it is", () => {
    const words = pictureWordsSchema.parse({ headline: "New words", subhead: "", phone: "", ctaLabel: "Get Quote" });
    expect(withPictureWords({ ...buildAdDesign({ brand, copy }), showCta: true }, words).showCta).toBe(true);
    expect(withPictureWords({ ...buildAdDesign({ brand, copy }), showCta: true }, { ...words, showCta: false }).showCta).toBe(false);
  });
});
