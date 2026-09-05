import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { generateOneVariant } from "@/lib/creative/generate";
import {
  persistCreativeImage,
  renderAndPersistDesign,
} from "@/lib/creative/persist";
import { NoLLMKeysError } from "@/lib/llm";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getActiveInstructionsText } from "@/lib/supabase/queries";
import { getAngleByName, AD_ANGLES } from "@/lib/templates/ads";
import {
  configuredMonthlyTokenLimit,
  monthlyTokenUsage,
  persistLLMUsage,
} from "@/lib/llm/persist";
import {
  generationReceipt,
  savedGenerationSettings,
  variantUsageEvents,
  failedVariantUsage,
} from "@/lib/creative/receipt";
import { creativeReferences } from "@/lib/creative/references";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  const limited = await rateLimitResponse(`regenerate:${user.id}`, {
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
  const limit = configuredMonthlyTokenLimit();
  if (limit > 0) {
    const used = await monthlyTokenUsage(business.id);
    if (used === null)
      return NextResponse.json(
        { error: "AI usage limits could not be verified." },
        { status: 503 },
      );
    if (used >= limit)
      return NextResponse.json(
        { error: "This business has reached its monthly AI generation limit." },
        { status: 429 },
      );
  }
  const { error: schemaError } = await supabase
    .from("creatives")
    .select("generation")
    .limit(0);
  if (schemaError)
    return NextResponse.json(
      { error: "Creative generation needs its database migration." },
      { status: 503 },
    );

  try {
    const instructions = await getActiveInstructionsText(business.id);
    const referenceImages = await creativeReferences(supabase, business.id);
    const settings = savedGenerationSettings(creative.generation);
    const variant = await generateOneVariant(
      business,
      creative.brief,
      angle,
      instructions,
      settings.language ?? undefined,
      settings.format,
      referenceImages,
    );
    await persistLLMUsage(
      variantUsageEvents(variant, {
        businessId: business.id,
        userId: user.id,
        route: "creatives.regenerate",
        requestId: crypto.randomUUID(),
      }),
    );

    const photoUrl = await persistCreativeImage(
      supabase,
      business.id,
      creative.variant_group ?? id,
      angle.id,
      variant.imageUrl,
    );
    const imageUrl = await renderAndPersistDesign(
      supabase,
      business.id,
      creative.variant_group ?? id,
      angle.id,
      variant.design,
      photoUrl,
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
        generation: generationReceipt(
          variant,
          settings.language ?? undefined,
          referenceImages,
        ),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      return serverError(
        "creative.regenerate",
        error,
        "Could not update creative.",
      );
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
  } catch (err) {
    await persistLLMUsage(
      failedVariantUsage(err, {
        businessId: business.id,
        userId: user.id,
        route: "creatives.regenerate",
        requestId: crypto.randomUUID(),
      }),
    );
    if (err instanceof NoLLMKeysError)
      return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Regeneration failed. The previous creative is unchanged.",
      },
      { status: 502 },
    );
  }
}
