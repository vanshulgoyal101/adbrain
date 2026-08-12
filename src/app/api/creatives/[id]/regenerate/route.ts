import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { generateOneVariant } from "@/lib/creative/generate";
import { persistCreativeImage } from "@/lib/creative/persist";
import { NoLLMKeysError } from "@/lib/llm";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getActiveInstructionsText } from "@/lib/supabase/queries";
import { getAngleByName, AD_ANGLES } from "@/lib/templates/ads";

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

  const limited = rateLimitResponse(`regenerate:${user.id}`, {
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (limited) return limited;

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

  const angle = getAngleByName(creative.angle ?? "") ?? AD_ANGLES[0];
  const instructions = await getActiveInstructionsText(business.id);

  let variant;
  try {
    variant = await generateOneVariant(
      business,
      creative.brief,
      angle,
      instructions,
    );
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
    return serverError("creative.regenerate", error, "Could not update creative.");
  }

  await logEvent({
    businessId: business.id,
    action: "creative.regenerate",
    entityType: "creative",
    entityId: id,
    reason: creative.brief,
    details: { angle: variant.angleName },
  });

  return NextResponse.json({ creative: updated });
}
