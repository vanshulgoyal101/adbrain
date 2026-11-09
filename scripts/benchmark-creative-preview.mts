import sharp from "sharp";
import { buildAdDesign } from "../src/lib/creative/design";
import { renderCompositeAd } from "../src/lib/creative/render";
import { renderPicturePreview } from "../src/lib/creative/picture-preview";
import { fitPhoto } from "../src/lib/creative/fit-photo";
import type { CreativeConcept } from "../src/lib/creative/concept";

type Mode = "independent-preview-renders" | "single-flight-previews";
type Sample = { cpuMs: number; bytes: Uint8Array; outputBytes: number; channel0Stdev: number; width?: number; height?: number };

const previewWidth = 720;
const trials = 5;
const callers = 4;
const sourceWidth = 1080;
const sourceHeight = 1350;
const photo = Buffer.alloc(sourceWidth * sourceHeight * 3);
for (let y = 0; y < sourceHeight; y++) {
  for (let x = 0; x < sourceWidth; x++) {
    const offset = (y * sourceWidth + x) * 3;
    photo[offset] = Math.round(32 + 70 * x / sourceWidth);
    photo[offset + 1] = Math.round(68 + 88 * y / sourceHeight);
    photo[offset + 2] = Math.round(54 + 45 * (x + y) / (sourceWidth + sourceHeight));
  }
}
const concept = {
  headline: "मुफ़्त सोलर सर्वे",
  primary_text: "घर की छत के लिए सोलर विकल्प जानें।",
  description: "",
  cta: "Contact Us",
  rationale: "",
  sourceQuotes: [],
  visual: { medium: "Photography", direction: "Rooftop solar at dusk.", textPlacement: "top" },
  supportingText: "बिजली बिल घटाने में मदद",
} as CreativeConcept;
const photoPng = await sharp(photo, { raw: { width: sourceWidth, height: sourceHeight, channels: 3 } }).png().toBuffer();
const design = buildAdDesign({
  brand: {
    name: "Sample Solar",
    website: "sample.invalid",
    phone: "+1 555 0100",
    primary_color: "#1d3a2e",
  },
  copy: concept,
  concept,
  format: "portrait",
  backgroundUrl: `data:image/png;base64,${photoPng.toString("base64")}`,
});
async function render(mode: Mode): Promise<Sample> {
  const before = process.resourceUsage();
  const outputs = await Promise.all(Array.from({ length: callers }, async () => {
    if (mode === "single-flight-previews") {
      const url = await renderPicturePreview("synthetic-owner", "synthetic-creative", design);
      return Buffer.from(url.split(",")[1], "base64");
    }
    const raster = await renderCompositeAd(design);
    return sharp(Buffer.from(raster)).resize({ width: previewWidth, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
  }));
  const after = process.resourceUsage();
  const output = outputs[0];
  if (!outputs.every((bytes) => bytes.equals(output))) throw new Error("Callers received different previews");
  const metadata = await sharp(output).metadata();
  const stats = await sharp(output).stats();
  return {
    cpuMs: (after.userCPUTime - before.userCPUTime + after.systemCPUTime - before.systemCPUTime) / 1000,
    bytes: output,
    outputBytes: output.byteLength,
    channel0Stdev: stats.channels[0].stdev,
    width: metadata.width,
    height: metadata.height,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function meanAbsolutePixelDifference(left: Uint8Array, right: Uint8Array) {
  const a = await sharp(Buffer.from(left)).raw().toBuffer();
  const b = await sharp(Buffer.from(right)).raw().toBuffer();
  if (a.length !== b.length) return null;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

async function main() {
  const modes: Mode[] = ["independent-preview-renders", "single-flight-previews"];
  for (const mode of modes) await render(mode);
  const collected: Record<Mode, Sample[]> = {
    "independent-preview-renders": [],
    "single-flight-previews": [],
  };
  for (let trial = 0; trial < trials; trial++) {
    const order = trial % 2 === 0 ? modes : [...modes].reverse();
    for (const mode of order) collected[mode].push(await render(mode));
  }
  const baseline = collected["independent-preview-renders"].at(-1)!;
  const bounded = collected["single-flight-previews"].at(-1)!;
  const baselineMedianCpuMs = median(collected["independent-preview-renders"].map(({ cpuMs }) => cpuMs));
  const boundedMedianCpuMs = median(collected["single-flight-previews"].map(({ cpuMs }) => cpuMs));
  console.log(JSON.stringify({
    workload: "synthetic Hindi ad + generated gradient background; local only, no customer/provider data",
    metric: "process user+system CPU from process.resourceUsage; excludes post-render metadata and pixel-difference analysis",
    warmupsPerMode: 1,
    measuredTrialsPerMode: trials,
    simultaneousIdenticalCallers: callers,
    modes: Object.fromEntries(modes.map((mode) => [mode, {
      cpuMs: collected[mode].map(({ cpuMs }) => Number(cpuMs.toFixed(3))),
      medianCpuMs: Number(median(collected[mode].map(({ cpuMs }) => cpuMs)).toFixed(3)),
      output: {
        width: collected[mode].at(-1)!.width,
        height: collected[mode].at(-1)!.height,
        bytes: collected[mode].at(-1)!.outputBytes,
        channel0Stdev: Number(collected[mode].at(-1)!.channel0Stdev.toFixed(3)),
      },
    }])),
    medianCpuReductionPercent: Number(((1 - boundedMedianCpuMs / baselineMedianCpuMs) * 100).toFixed(1)),
    meanAbsolutePixelDifference: await meanAbsolutePixelDifference(baseline.bytes, bounded.bytes),
    codec: await codecComparison(),
  }, null, 2));
}

async function codecComparison() {
  const legacy = async () => {
    const upright = await sharp(photoPng).rotate().toBuffer();
    return sharp(upright).resize(720, 900, { fit: "cover", position: sharp.strategy.attention }).png().toBuffer();
  };
  const reused = () => fitPhoto(photoPng, 720, 900);
  const modes = { "legacy-png-roundtrip": legacy, "reuse-upright-png": reused };
  const samples: Record<string, number[]> = {};
  const outputs: Record<string, Buffer> = {};
  for (const [mode, run] of Object.entries(modes)) { await run(); samples[mode] = []; }
  for (let trial = 0; trial < trials; trial++) {
    const entries = Object.entries(modes);
    for (const [mode, run] of trial % 2 === 0 ? entries : entries.reverse()) {
      const before = process.resourceUsage();
      outputs[mode] = await run();
      const after = process.resourceUsage();
      samples[mode].push((after.userCPUTime - before.userCPUTime + after.systemCPUTime - before.systemCPUTime) / 1000);
    }
  }
  return {
    workload: "same validated upright synthetic PNG, attention fit to 720x900; no download/validation bypass",
    trialsPerMode: trials,
    modes: Object.fromEntries(Object.entries(samples).map(([mode, cpuMs]) => [mode, { cpuMs, medianCpuMs: median(cpuMs) }])),
    medianCpuReductionPercent: (1 - median(samples["reuse-upright-png"]) / median(samples["legacy-png-roundtrip"])) * 100,
    byteIdentical: outputs["legacy-png-roundtrip"].equals(outputs["reuse-upright-png"]),
    meanAbsolutePixelDifference: await meanAbsolutePixelDifference(outputs["legacy-png-roundtrip"], outputs["reuse-upright-png"]),
  };
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
