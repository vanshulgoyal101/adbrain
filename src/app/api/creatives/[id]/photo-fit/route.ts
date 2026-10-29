import { NextResponse } from "next/server";
import { z } from "zod";
import { formatDimensions } from "@/lib/creative/design";
import { fitPhoto } from "@/lib/creative/fit-photo";
import { savedGenerationSettings } from "@/lib/creative/receipt";
import { downloadImage } from "@/lib/imageGen";
import { observeRoute } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export const GET = observeRoute("/api/creatives/[id]/photo-fit", "GET", handleGET);

const querySchema = z.object({
  photo: z.string().url().max(2000),
  fit: z.enum(["attention", "blur"]).default("attention"),
  shape: z.enum(["ad", "square"]).default("ad"),
});

/** Preview width in pixels: the sheet shows the ad's frame 260 px wide and the square at 48 px, at 2× for sharp screens. */
const PREVIEW_WIDTH = { ad: 520, square: 96 } as const;

/**
 * #1904: how one of the owner's Brand photos fits this ad's frame (or the 1:1 version), before anything is
 * rendered or saved. Same `fitPhoto` as the real render, at preview size; free, no AI call.
 */
async function handleGET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const query = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return NextResponse.json({ error: "Pick one of your Brand photos." }, { status: 400 });
  const { photo, fit, shape } = query.data;

  const limited = await rateLimitResponse(`photo-fit:${user.id}`, { limit: 120, windowMs: 5 * 60_000 });
  if (limited) return limited;

  const { data: creative } = await supabase.from("creatives").select("business_id, generation").eq("id", id).maybeSingle();
  if (!creative) return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  // Only the business's own product photos; never an arbitrary URL.
  const { data: asset } = await supabase
    .from("brand_assets")
    .select("url")
    .eq("business_id", creative.business_id)
    .eq("type", "product_photo")
    .eq("url", photo)
    .limit(1)
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: "That photo isn't in your Brand assets." }, { status: 400 });

  const frame = shape === "square" ? { width: 1, height: 1 } : formatDimensions(savedGenerationSettings(creative.generation).format);
  const width = PREVIEW_WIDTH[shape];
  const height = Math.round((width * frame.height) / frame.width);
  try {
    const image = await downloadImage(asset.url);
    const png = await fitPhoto(image.bytes, width, height, fit);
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't open that photo. Try another photo." }, { status: 502 });
  }
}
