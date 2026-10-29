import { observeRoute } from "@/lib/observability/logger";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { apiError, MAX_BATCH_IDS } from "@/lib/api";
import { downloadImage } from "@/lib/imageGen";
import { downloadJpeg } from "@/lib/imageGen/encode";
import { createClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { z } from "zod";
import { savedCreativeDescription } from "@/lib/creative/concept";
import { sampleNoteCard, sampleWatermark, SAMPLE_LABEL, SAMPLE_NOTE } from "@/lib/creative/sample-watermark";
import { isProspectAccount } from "@/lib/internal-accounts";
import { leaveBehindBlock, segmentForCategory } from "@/lib/segments";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = observeRoute("/api/creatives/export", "POST", handlePOST);

async function handlePOST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("Unauthorized", 401);
  }

  const limited = await rateLimitResponse(`creative-export:${user.id}`, { limit: 10, windowMs: 5 * 60_000 });
  if (limited) return limited;
  const parsed = z.object({ creativeIds: z.array(z.string().uuid()).min(1).max(MAX_BATCH_IDS) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("Choose between 1 and 50 valid creative IDs.", 400);
  const ids = [...new Set(parsed.data.creativeIds)];

  // RLS scopes this to the user's own creatives.
  const { data: creatives, error } = await supabase
    .from("creatives")
    .select("*")
    .in("id", ids);
  if (error) return apiError("Could not load the selected creatives. Retry the export.", 503);
  if (!creatives?.length || creatives.length !== ids.length) {
    return apiError("One or more selected creatives are missing or no longer accessible. Refresh your selection.", 404);
  }

  // #1317: a prospect's ads are samples until the owner takes the account over; every picture says so.
  const sample = isProspectAccount(user);
  const zip = new JSZip();
  let withImage = 0;
  let skipped = 0;
  let totalBytes = 0;
  let exhausted = false;
  const maximumBytes = 40 * 1024 * 1024;
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(45_000)]);
  // #1582: a sales visit's pack names the business and ends with the segment's follow-up.
  const business = sample && creatives[0]?.business_id ? (await supabase.from("businesses").select("name, vertical")
    .eq("id", creatives[0].business_id).maybeSingle()).data : null;
  // #1471: the note card comes first, so whoever opens the pack reads what these ads are before the ads.
  if (sample) {
    const card = await sampleNoteCard(business?.name).catch(() => null);
    if (card) zip.file("00-sample-note.png", card);
  }

  for (const [index, creative] of creatives.entries()) {
      if (!creative.image_url) continue;
      withImage++;
      if (exhausted || signal.aborted) { skipped++; continue; }
      const label = `ad-${index + 1}-${(creative.angle ?? "ad")
        .replace(/\W+/g, "-")
        .toLowerCase()}`;
      try {
        const downloaded = await downloadImage(creative.image_url, signal);
        // A picture that can't be marked is left out, never shipped unmarked.
        const marked = sample ? await sampleWatermark(downloaded.bytes) : downloaded;
        // #1897: downloadImage hands back PNG whatever is stored; the pack ships JPEG.
        const bytes = await downloadJpeg(marked.bytes);
        if (totalBytes + bytes.byteLength > maximumBytes) {
          exhausted = true;
          skipped++;
          continue;
        }
        totalBytes += bytes.byteLength;
        zip.file(`${label}.jpg`, bytes);
      } catch {
        // Skip an image that failed to download; copy is still exported.
        skipped++;
      }
  }

  const copy = creatives
    .map(
      (c, i) =>
        `Ad ${i + 1} — ${c.angle ?? ""}\n` +
        `Headline: ${c.headline ?? ""}\n` +
        `Primary text:\n${c.primary_text ?? ""}\n` +
        `Description: ${savedCreativeDescription(c.generation) ?? ""}\n` +
        `CTA: ${c.cta ?? ""}\n`,
    )
    .join("\n----------------------------------------\n\n");
  const note =
    skipped > 0
      ? `Note: ${skipped} of ${withImage} image(s) were unavailable or exceeded export limits and are not included. Export a smaller selection to include more images.\n\n`
      : "";
  const sampleNote = sample ? `${SAMPLE_LABEL}. ${SAMPLE_NOTE}\n\n` : "";
  const segment = segmentForCategory(business?.vertical);
  zip.file("copy.txt", sampleNote + note + copy + (segment ? `\n${leaveBehindBlock(segment, { businessName: business?.name })}` : ""));

  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  return new NextResponse(new Blob([buffer], { type: "application/zip" }), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="adbrain-ad-pack.zip"',
      "X-Images-Skipped": String(skipped),
    },
  });
}
