import { observeRoute, recordProductEvent, currentRequestId } from "@/lib/observability/logger";
import { createHash } from "node:crypto";
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
  persistLLMUsage,
} from "@/lib/llm/persist";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getActiveInstructionsText } from "@/lib/supabase/queries";
import { getEnv } from "@/lib/env";
import { z } from "zod";
import {
  generationReceipt,
  variantUsageEvents,
  failedVariantUsage,
} from "@/lib/creative/receipt";
import type { Creative, Database } from "@/lib/types";
import { creativeReferences, recentCreativeCopy } from "@/lib/creative/references";
import { preferenceContext } from "@/lib/preferences/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Reconcile a client whose long-running generation request outlived its HTTP
 * connection. Successful variants are persisted independently, so the client
 * can recover them without issuing a second paid generation request.
 */
export const GET = observeRoute("/api/creatives/generate", "GET", handleGET);

async function handleGET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const businessId = params.get("businessId")?.trim() ?? "";
  const generationId = params.get("generationId")?.trim() ?? "";
  const requestedCount = params.has("expectedCount") ? Number(params.get("expectedCount")) : null;
  if (!businessId || !z.string().uuid().safeParse(generationId).success ||
    (requestedCount !== null && (!Number.isSafeInteger(requestedCount) || requestedCount < 1 || requestedCount > 6))) {
    return NextResponse.json({ error: "A valid businessId, generationId, and expectedCount are required." }, { status: 400 });
  }
  const limited = await rateLimitResponse(`generate-status:${user.id}`, {
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (limited) return limited;
  let intent: Database["public"]["Functions"]["creative_generation_status"]["Returns"];
  try {
    const lookup = await createAdminClient().rpc("creative_generation_status", {
      p_business_id: businessId, p_user_id: user.id, p_generation_id: generationId,
    });
    if (lookup.error || !lookup.data) return NextResponse.json({ error: "Generation status is unavailable." }, { status: 503 });
    intent = lookup.data;
  } catch {
    return NextResponse.json({ error: "Generation status is unavailable." }, { status: 503 });
  }
  if (intent.status === "unknown") return NextResponse.json({ error: "Generation not found." }, { status: 404 });
  const expectedCount = Number(intent.expectedCount);
  if (requestedCount !== null && requestedCount !== expectedCount)
    return NextResponse.json({ error: "Generation count does not match the saved request." }, { status: 409 });

  const { data: creatives, error } = await supabase
    .from("creatives")
    .select("*")
    .eq("business_id", businessId)
    .eq("variant_group", generationId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Generation status is unavailable." }, { status: 503 });

  const saved = (creatives ?? []) as Creative[];
  return NextResponse.json({
    status: intent.status === "complete" && saved.length < expectedCount ? "unresolved" :
      intent.status === "processing" && saved.length ? "partial" : intent.status,
    creatives: saved,
    count: saved.length,
    expectedCount,
  });
}

export const POST = observeRoute("/api/creatives/generate", "POST", handlePOST);

async function handlePOST(req: Request) {
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
      generationId: z.string().uuid().optional(),
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
  const requestId = currentRequestId();
  const userId = user.id;
  const variantGroup = body.generationId ?? crypto.randomUUID();
  const inserted: Creative[] = [];
  const failures: { angle: string; error: string }[] = [];
  let noProviderFailures = 0;
  let admitted = false;
  let admin: ReturnType<typeof createAdminClient> | null = null;
  async function progress(tokens = 0, complete = false, uncertain = false, failed = false) {
    const { data, error } = await admin!.rpc("creative_generation_progress", {
      p_business_id: businessId, p_user_id: userId, p_generation_id: variantGroup,
      p_accounted_tokens: tokens, p_complete: complete, p_uncertain: uncertain, p_failed: failed,
    });
    if (error || !data || data.status === "unknown") throw new Error("Generation progress is unavailable");
  }
  try {
    const [instructions, referenceImages, recentCopy] = await Promise.all([
      getActiveInstructionsText(businessId),
      creativeReferences(supabase, businessId),
      recentCreativeCopy(supabase, businessId),
    ]);
    const requestHash = createHash("sha256").update(JSON.stringify([businessId, brief, count, language, body.format])).digest("hex");
    admin = createAdminClient();
    const { data: admission, error: admissionError } = await admin.rpc("creative_generation_admit", {
      p_business_id: businessId,
      p_user_id: user.id,
      p_generation_id: variantGroup,
      p_request_hash: requestHash,
      p_expected_count: count,
      p_reserved_tokens: count * (50_000 + 2 * getEnv().CREATIVE_MAX_TOKENS),
      p_image_floor_tokens: count * 10_000,
      p_monthly_limit: monthlyLimit,
    });
    if (admissionError || !admission) return NextResponse.json({ error: "Generation admission is unavailable. No generation was started." }, { status: 503 });
    if (admission.action !== "start") {
      if (admission.action === "missing") return NextResponse.json({ error: "Generation not found." }, { status: 404 });
      if (admission.action === "conflict") return NextResponse.json({ error: "Generation ID was already used for different inputs." }, { status: 409 });
      if (admission.action === "quota") return NextResponse.json({ error: "This business has reached its monthly AI generation limit.", code: "LLM_MONTHLY_QUOTA_EXCEEDED" }, { status: 429 });
      return NextResponse.json({ variantGroup, status: admission.status, creatives: [], count: 0, expectedCount: count }, { status: 202 });
    }
    admitted = true;
    const advisoryPreferences = await preferenceContext(businessId, "creative", [brief, instructions].filter(Boolean).join("\n")).catch(() => "");
    await generateVariants({
      brand: business,
      brief,
      count,
      instructions,
      language,
      format: body.format,
      referenceImages,
      recentCopy,
      advisoryPreferences,
      onVariant: async (variant) => {
        const events = variantUsageEvents(variant, {
            businessId,
            userId: user.id,
            route: "creatives.generate",
            requestId,
          });
        const recorded = await persistLLMUsage(events);
        await progress(recorded ? events.reduce((total, event) => total + event.usage.totalTokens, 0) : 0, false, !recorded);
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
          variant.imageUrl,
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
        await progress();
      },
      onFailure: async (angle, error) => {
        const events = failedVariantUsage(error, {
            businessId,
            userId: user.id,
            route: "creatives.generate",
            requestId,
          });
        const recorded = await persistLLMUsage(events);
        if (recorded && error instanceof NoLLMKeysError) noProviderFailures++;
        await progress(recorded ? events.reduce((total, event) => total + event.usage.totalTokens, 0) : 0, false, !recorded || !(error instanceof NoLLMKeysError));
        failures.push({
          angle: angle.name,
          error: "This creative could not be generated or saved. Check saved results before trying again.",
        });
      },
    });
    const noProvider = !inserted.length && failures.length === count && noProviderFailures === count;
    await progress(0, (inserted.length === count && !failures.length) || noProvider,
      !noProvider && (inserted.length < count || failures.length > 0), noProvider);
    if (noProvider) return NextResponse.json({ error: new NoLLMKeysError().message, code: "NO_LLM_KEYS" }, { status: 400 });
  } catch (err) {
    const noProvider = err instanceof NoLLMKeysError;
    if (admitted) await progress(0, noProvider, !noProvider, noProvider).catch(() => {});
    if (err instanceof NoLLMKeysError) {
      return NextResponse.json(
        { error: err.message, code: "NO_LLM_KEYS" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Creative generation could not be completed. Check saved results before trying again." },
      { status: 502 },
    );
  }

  recordProductEvent({ kind: "workflow", name: "creative.batch", businessId,
    outcome: !inserted.length ? "failed" : failures.length ? "partial" : "success",
    attributes: { count: inserted.length, failedCount: failures.length } });
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
