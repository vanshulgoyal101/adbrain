import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { buildAdDesign, contactChannel, WHATSAPP_CONTACT_LABEL } from "@/lib/creative/design";
import { pictureWordsOf, storedPictureDesign, withPictureWords } from "@/lib/creative/picture-words";
import { AdComposite } from "@/lib/creative/render";
import type { CreativeConcept } from "@/lib/creative/concept";
import type { BrandContext } from "@/lib/templates/ads";
import regenerate from "./fixtures/create/solaride-regenerate.json";
import run4 from "./fixtures/create/cedar-ridge-run4.json";

// #1147 (CPO, #1131 walk): the campaign opens WhatsApp, but the poster showed a phone icon and a number
// to call. A WhatsApp business's poster now asks for a WhatsApp message; others keep their number.
const texts = (node: unknown): string[] => {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  const el = node as ReactElement<{ children?: unknown }> | null;
  return el && typeof el === "object" && "props" in el ? texts(el.props.children) : [];
};
const concept = JSON.parse(regenerate.replies[0].content.replace(/^```json\s*|\s*```\s*$/g, "")) as CreativeConcept;
const solaride = { ...(regenerate.brand as BrandContext), phone: "+91 73802 80874" };
const design = (brand: BrandContext & { whatsapp_template?: unknown }) =>
  buildAdDesign({ brand, copy: { headline: concept.headline, primary_text: concept.primary_text, cta: concept.cta }, concept });

describe("core: a WhatsApp business's poster asks for a WhatsApp message, not a call (#1147)", () => {
  it("draws the chat ask, never the number, for Solaride's recorded concept", () => {
    const spec = design(solaride);
    expect(spec.contact).toBe("whatsapp");
    const words = texts(AdComposite({ spec })).join(" ");
    expect(words).toContain(WHATSAPP_CONTACT_LABEL);
    expect(words).not.toContain("73802 80874");
    expect(words).not.toMatch(/\bcall\b/i);
  });

  it("keeps the number for a business outside India without a saved WhatsApp message", () => {
    const cedar = { ...(run4.brand as BrandContext), phone: "+1 512 555 0142" };
    expect(contactChannel(cedar)).toBe("phone");
    expect(texts(AdComposite({ spec: design(cedar) })).join(" ")).toContain("+1 512 555 0142");
    // A saved WhatsApp message makes it a WhatsApp business anywhere.
    expect(contactChannel({ ...cedar, whatsapp_template: { greeting: "Hi" } })).toBe("whatsapp");
    expect(contactChannel({ phone: null })).toBe("phone");
    expect(contactChannel({ phone: "98140 00000" })).toBe("whatsapp");
  });

  it("keeps the channel through a saved design and a picture-words edit; designs saved before #1147 keep their number", () => {
    const saved = storedPictureDesign(JSON.parse(JSON.stringify({ ...design(solaride), backgroundUrl: undefined })))!;
    expect(saved.contact).toBe("whatsapp");
    expect(withPictureWords(saved, { ...pictureWordsOf(saved), headline: "Solar before 31 Dec" }).contact).toBe("whatsapp");
    const legacy: Record<string, unknown> = { ...design(solaride), backgroundUrl: undefined };
    delete legacy.contact;
    const old = storedPictureDesign(JSON.parse(JSON.stringify(legacy)))!;
    expect(old.contact).toBe("phone");
    expect(texts(AdComposite({ spec: old })).join(" ")).toContain("+91 73802 80874");
  });
});
