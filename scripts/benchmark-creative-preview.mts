import sharp from "sharp";
import { buildAdDesign } from "../src/lib/creative/design";
import { renderCompositeAd } from "../src/lib/creative/render";
import type { CreativeConcept } from "../src/lib/creative/concept";

type Mode = "full-render-then-resize" | "bounded-preview-render";
type Sample = { cpuMs: number; bytes: Uint8Array; outputBytes: number; channel0Stdev: number; width?: number; height?: number };

const previewWidth = 720;
const trials = 5;
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
const boundedDesign = {
  ...design,
  width: Math.min(previewWidth, design.width),
  height: Math.round(design.height * Math.min(1, previewWidth / design.width)),
};

async function render(mode: Mode): Promise<Sample> {
  const before = process.resourceUsage();
  const raster = await renderCompositeAd(mode === "bounded-preview-render" ? boundedDesign : design);
  const output = mode === "bounded-preview-render"
    ? await sharp(Buffer.from(raster)).webp({ quality: 72 }).toBuffer()
    : await sharp(Buffer.from(raster)).resize({ width: previewWidth, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
  const after = process.resourceUsage();
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
  const modes: Mode[] = ["full-render-then-resize", "bounded-preview-render"];
  for (const mode of modes) await render(mode);
  const collected: Record<Mode, Sample[]> = {
    "full-render-then-resize": [],
    "bounded-preview-render": [],
  };
  for (let trial = 0; trial < trials; trial++) {
    const order = trial % 2 === 0 ? modes : [...modes].reverse();
    for (const mode of order) collected[mode].push(await render(mode));
  }
  const baseline = collected["full-render-then-resize"].at(-1)!;
  const bounded = collected["bounded-preview-render"].at(-1)!;
  const baselineMedianCpuMs = median(collected["full-render-then-resize"].map(({ cpuMs }) => cpuMs));
  const boundedMedianCpuMs = median(collected["bounded-preview-render"].map(({ cpuMs }) => cpuMs));
  console.log(JSON.stringify({
    workload: "synthetic Hindi ad + generated gradient background; local only, no customer/provider data",
    metric: "process user+system CPU from process.resourceUsage; excludes post-render metadata and pixel-difference analysis",
    warmupsPerMode: 1,
    measuredTrialsPerMode: trials,
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
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
