import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { generateVariants } from "@/lib/creative/generate";
import {
  persistCreativeImage,
  renderAndPersistDesign,
} from "@/lib/creative/persist";
import { languagePromptName } from "@/lib/languages";
import { NoLLMKeysError } from "@/lib/llm";
import {
  configuredMonthlyTokenLimit,
  monthlyTokenUsage,
  persistLLMUsage,
} from "@/lib/llm/persist";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getActiveInstructionsText } from "@/lib/supabase/queries";
import { z } from "zod";
import {
  generationReceipt,
  variantUsageEvents,
  failedVariantUsage,
} from "@/lib/creative/receipt";
import type { Creative } from "@/lib/types";
import { creativeReferences } from "@/lib/creative/references";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Generation costs money (LLM + image). Cap per-user request rate.
  const limited = await rateLimitResponse(`generate:${user.id}`, {
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (limited) return limited;

  const parsed = z
    .object({
      businessId: z.string().trim().min(1),
      brief: z.string().trim().min(1).max(2000),
      count: z.number().int().min(1).max(6).default(3),
      language: z.string().optional(),
      format: z
        .enum(["portrait", "square", "story", "landscape"])
        .default("portrait"),
    })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          "A businessId, brief (up to 2000 characters), count (1-6), and valid format are required.",
      },
      { status: 400 },
    );
  const body = parsed.data;

  const businessId = (body?.businessId ?? "").trim();
  const brief = (body?.brief ?? "").trim();
  const rawCount = Number(body?.count ?? 3);
  const count = Number.isFinite(rawCount)
    ? Math.min(Math.max(Math.floor(rawCount), 1), 6)
    : 3;
  const language = languagePromptName(body?.language);

  if (!businessId || !brief) {
    return NextResponse.json(
      { error: "businessId and brief are required" },
      { status: 400 },
    );
  }

  // RLS ensures the user can only read their own business.
  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const monthlyLimit = configuredMonthlyTokenLimit();
  if (monthlyLimit > 0) {
    const used = await monthlyTokenUsage(businessId);
    if (used === null)
      return NextResponse.json(
        {
          error:
            "AI usage limits could not be verified. No generation was started.",
        },
        { status: 503 },
      );
    if (used != null && used >= monthlyLimit) {
      return NextResponse.json(
        {
          error: "This business has reached its monthly AI generation limit.",
          code: "LLM_MONTHLY_QUOTA_EXCEEDED",
        },
        { status: 429 },
      );
    }
  }

  const { error: schemaError } = await supabase
    .from("creatives")
    .select("generation")
    .limit(0);
  if (schemaError)
    return NextResponse.json(
      {
        error:
          "Creative generation needs its database migration. No generation was started.",
      },
      { status: 503 },
    );
  const requestId = crypto.randomUUID();
  const variantGroup = crypto.randomUUID();
  const inserted: Creative[] = [];
  const failures: { angle: string; error: string }[] = [];
  try {
    const instructions = await getActiveInstructionsText(businessId);
    const referenceImages = await creativeReferences(supabase, businessId);
    await generateVariants({
      brand: business,
      brief,
      count,
      instructions,
      language,
      format: body.format,
      referenceImages,
      onVariant: async (variant) => {
        await persistLLMUsage(
          variantUsageEvents(variant, {
            businessId,
            userId: user.id,
            route: "creatives.generate",
            requestId,
          }),
        );
        const photoUrl = await persistCreativeImage(
          supabase,
          businessId,
          variantGroup,
          variant.angleId,
          variant.imageUrl,
        );
        const imageUrl = await renderAndPersistDesign(
          supabase,
          businessId,
          variantGroup,
          variant.angleId,
          variant.design,
          photoUrl,
        );
        const { data, error } = await supabase
          .from("creatives")
          .insert({
            business_id: businessId,
            brief,
            angle: variant.angleName,
            image_url: imageUrl,
            headline: variant.headline,
            primary_text: variant.primaryText,
            cta: variant.cta,
            variant_group: variantGroup,
            status: "draft",
            generation: generationReceipt(variant, language, referenceImages),
          })
          .select("*")
          .single();
        if (error || !data)
          throw new Error(
            "Could not save the creative. Check the generation schema migration.",
          );
        inserted.push(data);
      },
      onFailure: async (angle, error) => {
        await persistLLMUsage(
          failedVariantUsage(error, {
            businessId,
            userId: user.id,
            route: "creatives.generate",
            requestId,
          }),
        );
        failures.push({
          angle: angle.name,
          error: error instanceof Error ? error.message : "Generation failed.",
        });
      },
    });
  } catch (err) {
    if (err instanceof NoLLMKeysError) {
      return NextResponse.json(
        { error: err.message, code: "NO_LLM_KEYS" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }

  if (!inserted.length)
    return NextResponse.json(
      { error: failures[0]?.error ?? "No creatives were generated.", failures },
      { status: 502 },
    );

  await logEvent({
    businessId,
    action: "creatives.generate",
    entityType: "creative",
    // The brief can be an LLM-written paragraph, so it belongs in details —
    // `reason` is shown to the owner in the activity feed.
    reason: `Generated ${inserted.length} creative${inserted.length === 1 ? "" : "s"}`,
    details: {
      count: inserted.length,
      variantGroup,
      brief,
      failures,
    },
  });

  return NextResponse.json({ variantGroup, creatives: inserted, failures });
}
