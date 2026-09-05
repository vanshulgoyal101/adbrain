import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { generateVariants } from "@/lib/creative/generate";
import { persistCreativeImage, renderAndPersistDesign } from "@/lib/creative/persist";
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

  // Generation costs money (LLM + image). Cap per-user request rate.
  const limited = await rateLimitResponse(`generate:${user.id}`, {
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as {
    businessId?: string;
    brief?: string;
    count?: number;
    language?: string;
  } | null;

  const businessId = (body?.businessId ?? "").trim();
  const brief = (body?.brief ?? "").trim();
  const rawCount = Number(body?.count ?? 3);
  const count = Number.isFinite(rawCount)
    ? Math.min(Math.max(Math.floor(rawCount), 1), 5)
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
    // A missing ledger table returns null and is treated as a migration grace
    // period; once present, the quota is enforced before paid calls begin.
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

  const instructions = await getActiveInstructionsText(businessId);
  const { data: brandAssets } = await supabase
    .from("brand_assets")
    .select("url, type")
    .eq("business_id", businessId)
    .in("type", ["product_photo", "past_ad"])
    .order("created_at", { ascending: false })
    .limit(3);
  let variants;
  try {
    variants = await generateVariants({
      brand: business,
      brief,
      count,
      instructions,
      language,
      referenceImages: (brandAssets ?? []).map((asset) => asset.url),
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

  const requestId = crypto.randomUUID();
  await persistLLMUsage(
    variants.flatMap((variant) =>
      [
        ...variant.llmUsage.map((entry) => ({
          businessId,
          userId: user.id,
          route: "creatives.generate",
          provider: entry.provider,
          model: entry.model,
          usage: entry.usage,
          requestId,
          inputChars: entry.inputChars,
          outputChars: entry.outputChars,
          latencyMs: entry.latencyMs,
          cacheHit: entry.cacheHit,
          metadata: { angle: variant.angleId },
        })),
        {
          businessId,
          userId: user.id,
          route: "creatives.generate",
          provider: variant.imageUsage.provider,
          model: variant.imageUsage.model,
          usageKind: "image" as const,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          estimatedCostUsd: variant.imageUsage.estimatedCostUsd,
          latencyMs: variant.imageUsage.latencyMs,
          imageWidth: variant.imageUsage.width,
          imageHeight: variant.imageUsage.height,
          requestId,
          metadata: { angle: variant.angleId },
        },
      ],
    ),
  );

  const variantGroup = crypto.randomUUID();
  const persisted = await Promise.all(
    variants.map(async (v) => {
      const photoUrl = await persistCreativeImage(
        supabase,
        businessId,
        variantGroup,
        v.angleId,
        v.imageUrl,
      );
      const imageUrl = await renderAndPersistDesign(
        supabase,
        businessId,
        variantGroup,
        v.angleId,
        v.design,
        photoUrl,
      );
      return { ...v, imageUrl };
    }),
  );
  const rows = persisted.map((v) => ({
    business_id: businessId,
    brief,
    angle: v.angleName,
    image_url: v.imageUrl,
    headline: v.headline,
    primary_text: v.primaryText,
    cta: v.cta,
    variant_group: variantGroup,
    status: "draft" as const,
  }));

  const { data: inserted, error } = await supabase
    .from("creatives")
    .insert(rows)
    .select("*");
  if (error) {
    return serverError("creatives.generate", error, "Could not save creatives.");
  }

  await logEvent({
    businessId,
    action: "creatives.generate",
    entityType: "creative",
    // The brief can be an LLM-written paragraph, so it belongs in details —
    // `reason` is shown to the owner in the activity feed.
    reason: `Generated ${rows.length} creative${rows.length === 1 ? "" : "s"}`,
    details: {
      count: rows.length,
      variantGroup,
      brief,
      angles: variants.map((v) => v.angleName),
    },
  });

  return NextResponse.json({ variantGroup, creatives: inserted ?? [] });
}
