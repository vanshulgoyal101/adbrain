import JSZip from "jszip";
import { NextResponse } from "next/server";
import { apiError, MAX_BATCH_IDS, readJson } from "@/lib/api";
import { downloadImage } from "@/lib/imageGen";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("Unauthorized", 401);
  }

  const body = await readJson<{ creativeIds?: string[] }>(req);
  const ids = (Array.isArray(body?.creativeIds) ? body.creativeIds : []).slice(
    0,
    MAX_BATCH_IDS,
  );
  if (!ids.length) {
    return apiError("creativeIds is required", 400);
  }

  // RLS scopes this to the user's own creatives.
  const { data: creatives } = await supabase
    .from("creatives")
    .select("*")
    .in("id", ids);
  if (!creatives?.length) {
    return apiError("No creatives found", 404);
  }

  const zip = new JSZip();
  let withImage = 0;
  let skipped = 0;

  await Promise.all(
    creatives.map(async (c, i) => {
      if (!c.image_url) return;
      withImage++;
      const label = `ad-${i + 1}-${(c.angle ?? "ad")
        .replace(/\W+/g, "-")
        .toLowerCase()}`;
      try {
        const { bytes, contentType } = await downloadImage(c.image_url);
        const ext = contentType.includes("png") ? "png" : "jpg";
        zip.file(`${label}.${ext}`, bytes);
      } catch (err) {
        // Skip an image that failed to download; copy is still exported.
        skipped++;
        console.warn("[creatives.export] image download failed", c.id, err);
      }
    }),
  );

  const copy = creatives
    .map(
      (c, i) =>
        `Ad ${i + 1} — ${c.angle ?? ""}\n` +
        `Headline: ${c.headline ?? ""}\n` +
        `Primary text:\n${c.primary_text ?? ""}\n` +
        `CTA: ${c.cta ?? ""}\n`,
    )
    .join("\n----------------------------------------\n\n");
  const note =
    skipped > 0
      ? `Note: ${skipped} of ${withImage} image(s) could not be downloaded and are not included.\n\n`
      : "";
  zip.file("copy.txt", note + copy);

  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  return new NextResponse(new Blob([buffer], { type: "application/zip" }), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="adbrain-ad-pack.zip"',
      "X-Images-Skipped": String(skipped),
    },
  });
}
