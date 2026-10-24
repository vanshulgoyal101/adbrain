import { createHash } from "node:crypto";
import { ImageResponse } from "next/og";
import { describe, expect, it } from "vitest";
import type { CreativeConcept } from "@/lib/creative/concept";
import { buildAdDesign } from "@/lib/creative/design";
import { AdComposite, rasterize, renderCompositeAd } from "@/lib/creative/render";
import recorded from "./fixtures/create/cedar-ridge-concept.json";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// #300: the renderer used next/og's single bundled weight, so every "bold" headline came out regular.
describe("ad renderer fonts", () => {
  it("draws weight 800 differently from weight 400", async () => {
    const draw = (fontWeight: number) => rasterize(<div style={{ display: "flex", fontSize: 76, fontWeight }}>Wondering Whether Your Roof Is Ready?</div>, { width: 1080, height: 200 });
    expect(sha(await draw(800))).not.toBe(sha(await draw(400)));
  });

  it("renders a recorded real ad with the shipped fonts, not the engine default", async () => {
    const concept = recorded.concept as CreativeConcept;
    const design = buildAdDesign({
      brand: { name: recorded.brand.name, phone: "+1 512 555 0142", primary_color: "#1f4e79" },
      copy: concept,
      concept,
      format: "portrait",
    });
    const ours = await renderCompositeAd(design);
    expect(ours.byteLength).toBeGreaterThan(10_000);
    const engineDefault = new Uint8Array(await new ImageResponse(<AdComposite spec={design} />, { width: design.width, height: design.height }).arrayBuffer());
    expect(sha(ours)).not.toBe(sha(engineDefault));
  });
});
