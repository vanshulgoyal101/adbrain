import JSZip from "jszip";
import { NextResponse } from "next/server";
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    creativeIds?: string[];
  } | null;
  const ids = (Array.isArray(body?.creativeIds) ? body.creativeIds : []).slice(
    0,
    50,
  );
  if (!ids.length) {
    return NextResponse.json(
      { error: "creativeIds is required" },
      { status: 400 },
    );
  }

  // RLS scopes this to the user's own creatives.
  const { data: creatives } = await supabase
    .from("creatives")
    .select("*")
    .in("id", ids);
  if (!creatives?.length) {
    return NextResponse.json({ error: "No creatives found" }, { status: 404 });
  }

  const zip = new JSZip();

  await Promise.all(
    creatives.map(async (c, i) => {
      if (!c.image_url) return;
      const label = `ad-${i + 1}-${(c.angle ?? "ad")
        .replace(/\W+/g, "-")
        .toLowerCase()}`;
      try {
        const { bytes, contentType } = await downloadImage(c.image_url);
        const ext = contentType.includes("png") ? "png" : "jpg";
        zip.file(`${label}.${ext}`, bytes);
      } catch {
        // Skip an image that failed to download; copy still exported.
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
  zip.file("copy.txt", copy);

  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  return new NextResponse(new Blob([buffer], { type: "application/zip" }), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="adbrain-ad-pack.zip"',
    },
  });
}
