import { NextResponse } from "next/server";
import { generateOneVariant } from "@/lib/creative/generate";
import { persistCreativeImage } from "@/lib/creative/persist";
import { NoLLMKeysError } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";
import { getAngleByName, SOLAR_ANGLES } from "@/lib/templates/solar";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: creative } = await supabase
    .from("creatives")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!creative) {
    return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", creative.business_id)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const angle = getAngleByName(creative.angle ?? "") ?? SOLAR_ANGLES[0];

  let variant;
  try {
    variant = await generateOneVariant(business, creative.brief, angle);
  } catch (err) {
    if (err instanceof NoLLMKeysError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  const imageUrl = await persistCreativeImage(
    supabase,
    business.id,
    creative.variant_group ?? id,
    angle.id,
    variant.imageUrl,
  );

  const { data: updated, error } = await supabase
    .from("creatives")
    .update({
      angle: variant.angleName,
      image_url: imageUrl,
      headline: variant.headline,
      primary_text: variant.primaryText,
      cta: variant.cta,
      status: "draft",
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ creative: updated });
}
