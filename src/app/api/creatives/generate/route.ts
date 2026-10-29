import { observeRoute, recordProductEvent, currentRequestId } from "@/lib/observability/logger";
import { creativeFailureMessage } from "@/lib/creative/failure-message";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import { CreativeImageError, CreativeValidationError, generateVariants, type CreateProgressEvent, type GeneratedVariant } from "@/lib/creative/generate";
import {
  persistCreativeImage,
  renderAndPersistDesign,
} from "@/lib/creative/persist";
import { languagePromptName } from "@/lib/languages";
import { NoLLMKeysError } from "@/lib/llm";
import {
  configuredMonthlyTokenLimit,
  persistLLMUsage,
  usageCostUsd,
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
import { creativeAssets, recentCreativeCopy } from "@/lib/creative/references";
import { CREATE_HEARTBEAT_MS, CREATE_TOP_UP_BUDGET_MS, CREATE_TOP_UP_START_MS, PROSPECT_PICTURE_RETRY_END_MS, PROSPECT_PICTURE_RETRY_MIN_MS } from "@/lib/creative/stream";
import { isProspectAccount } from "@/lib/internal-accounts";
import { AD_ANGLES, type AdAngle } from "@/lib/templates/ads";
import { freeImagesOnly } from "@/lib/llm/spend-policy";
import { cloudflareConfigured } from "@/lib/imageGen/providers/cloudflare";
import { preferenceContext } from "@/lib/preferences/store";

export const runtime = "nodejs";
export const maxDuration = 300;

const roundUsd = (usd: number) => Math.round(usd * 1e6) / 1e6;

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
  let status: string = intent.status === "complete" && saved.length < expectedCount ? "unresolved" :
    intent.status === "processing" && saved.length ? "partial" : intent.status;
  // #1407: a batch that ended short keeps the intent's 'partial' until it times out (5 min), so Studio said 'still being
  // made' while step 2 said 'couldn't be made'. The batch's closing audit row (written after any top-up) settles it.
  if ((status === "partial" || status === "processing") && saved.length < expectedCount) {
    const { data: closed } = await supabase.from("audit_log").select("id").eq("business_id", businessId)
      .eq("action", "creatives.generate").eq("details->>variantGroup", generationId).limit(1);
    if (closed?.length) status = "ended";
  }
  return NextResponse.json({
    status,
    creatives: saved,
    count: saved.length,
    expectedCount,
  });
}

export const POST = observeRoute("/api/creatives/generate", "POST", handlePOST);

/** Live Create (#141): one JSON line per event, then `{ type: "result", status, body }` with the normal response. */
export type CreateStreamLine =
  | ({ type: "progress" } & CreateProgressEvent)
  | { type: "creative"; angleId: string; creative: Creative }
  /** #1123: the first pass came up short; this many more are being made in the same request (#1547: `picture`: only their pictures). */
  | { type: "topUp"; missing: number; kind?: "picture" }
  | { type: "result"; status: number; body: unknown };

interface LiveCreate {
  onAdmitted: () => void;
  onProgress: (event: CreateProgressEvent) => void;
  onCreative: (angleId: string, creative: Creative) => void;
  onTopUp: (missing: number, kind?: "picture") => void;
}

async function handlePOST(req: Request): Promise<Response> {
  if (!req.headers.get("accept")?.includes("application/x-ndjson")) return generate(req);
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const write = (line: CreateStreamLine) => {
    writer.write(encoder.encode(`${JSON.stringify(line)}\n`)).catch(() => {});
  };
  let admitted!: () => void;
  const started = new Promise<null>((resolve) => { admitted = () => resolve(null); });
  const result = generate(req, {
    onAdmitted: admitted,
    onProgress: (event) => write({ type: "progress", ...event }),
    onCreative: (angleId, creative) => write({ type: "creative", angleId, creative }),
    onTopUp: (missing, kind) => write({ type: "topUp", missing, ...(kind ? { kind } : {}) }),
  });
  // Rejections before admission (auth, limits, quota) keep their normal status and JSON body.
  const early = await Promise.race([started, result]);
  if (early) {
    writer.close().catch(() => {});
    return early;
  }
  // #666: a blank line every 15 s lets the page tell a silently dead connection from a slow ad.
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  const beat = () => {
    heartbeat = setTimeout(() => {
      writer.write(encoder.encode("\n")).catch(() => {});
      beat();
    }, CREATE_HEARTBEAT_MS);
  };
  beat();
  void result
    .then(async (response) => write({ type: "result", status: response.status, body: await response.json() }))
    .catch(() => write({ type: "result", status: 502, body: { error: "Creative generation could not be completed. Check saved results before trying again." } }))
    .finally(() => {
      clearTimeout(heartbeat);
      writer.close().catch(() => {});
    });
  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

async function generate(req: Request, live?: LiveCreate) {
  const startedAt = Date.now();
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
      sourceFacts: z.array(z.string().trim().min(1).max(2000)).max(12)
        .refine((facts) => facts.join("").length <= 6000).default([]),
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
  const sourceFacts = body.sourceFacts;

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

  const monthlyLimit = configuredMonthlyTokenLimit(user);
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
  // Keyed by angle: a top-up that saves the angle clears its failure; one that fails replaces it.
  const failed = new Map<string, { angle: AdAngle; error: unknown; message: string }>();
  let failures: { angle: string; error: string }[] = [];
  let topUp = 0;
  let pictureRetry = 0;
  const cost = { text: 0, image: 0 };
  let noProviderFailures = 0;
  // Usage is unknown only when recording it failed or an unexpected error hid provider calls (#138).
  let usageUnknown = false;
  const recordedAngles = new Set<string>();
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
    const [instructions, { references: referenceImages, photos: ownerPhotos }, recentCopy] = await Promise.all([
      getActiveInstructionsText(businessId),
      creativeAssets(supabase, businessId),
      recentCreativeCopy(supabase, businessId),
    ]);
    const requestHash = createHash("sha256").update(JSON.stringify([businessId, brief, count, language, body.format, ...(sourceFacts.length ? [sourceFacts] : [])])).digest("hex");
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
    live?.onAdmitted();
    const advisoryPreferences = await preferenceContext(businessId, "creative", [brief, instructions].filter(Boolean).join("\n")).catch(() => "");
    const addCost = (events: Parameters<typeof usageCostUsd>[0]) => {
      const add = usageCostUsd(events);
      cost.text += add.text;
      cost.image += add.image;
    };
    const run = {
      brand: business,
      brief,
      instructions,
      language,
      format: body.format,
      referenceImages,
      advisoryPreferences,
      sourceFacts,
      onProgress: live?.onProgress,
      onVariant: async (variant: GeneratedVariant) => {
        const events = variantUsageEvents(variant, {
            businessId,
            userId: user.id,
            route: "creatives.generate",
            requestId,
            generationId: variantGroup,
          });
        addCost(events);
        const recorded = await persistLLMUsage(events);
        if (recorded) recordedAngles.add(variant.angleId);
        else usageUnknown = true;
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
            generation: generationReceipt(variant, language, referenceImages, sourceFacts, photoUrl, requestId),
          })
          .select("*")
          .single();
        if (error || !data)
          throw new Error(
            "Could not save the creative. Check the generation schema migration.",
          );
        inserted.push(data);
        failed.delete(variant.angleId);
        live?.onCreative(variant.angleId, data);
        await progress();
      },
      onFailure: async (angle: AdAngle, error: unknown) => {
        const events = failedVariantUsage(error, {
            businessId,
            userId: user.id,
            route: "creatives.generate",
            requestId,
            generationId: variantGroup,
          });
        addCost(events);
        const recorded = await persistLLMUsage(events);
        if (recorded && error instanceof NoLLMKeysError) noProviderFailures++;
        const unknown = !recorded || !(error instanceof CreativeValidationError || error instanceof CreativeImageError
          || error instanceof NoLLMKeysError || recordedAngles.has(angle.id));
        if (unknown) usageUnknown = true;
        await progress(recorded ? events.reduce((total, event) => total + event.usage.totalTokens, 0) : 0, false, unknown);
        failed.set(angle.id, { angle, error, message: creativeFailureMessage(error) });
      },
    };
    await generateVariants({ ...run, count, ownerPhotos, recentCopy });
    // #1123: one top-up round, in parallel, for the ads the first pass missed. Only failures a fresh
    // concept can fix are retried (not "no provider" or every provider down), never beyond `count`.
    const firstPass = AD_ANGLES.slice(0, count);
    // #1547: a sales visit's lost pictures get the ₹0 picture retry below instead of new words.
    const prospectPictures = isProspectAccount(user) && freeImagesOnly();
    const pictureOnly = (error: unknown): error is CreativeImageError => prospectPictures && error instanceof CreativeImageError && Boolean(error.concept);
    const retry = [...failed.values()]
      .filter(({ error }) => !pictureOnly(error) && (error instanceof CreativeImageError || (error instanceof CreativeValidationError && error.stage !== "provider")))
      .map(({ angle }) => angle)
      .sort((a, b) => firstPass.indexOf(a) - firstPass.indexOf(b))
      .slice(0, count - inserted.length);
    if (retry.length && Date.now() - startedAt <= CREATE_TOP_UP_START_MS) {
      topUp = retry.length;
      live?.onTopUp(topUp);
      await generateVariants({
        ...run,
        angleIds: retry.map((angle) => angle.id),
        count: retry.length,
        // #1901: each owner photo belongs to one of ads 1-3 by place, so a retried ad gets its own photo back.
        ownerPhotos,
        recentCopy: [...inserted.map((creative) => ({ headline: creative.headline ?? "", primary_text: creative.primary_text ?? "" })), ...recentCopy].slice(0, 12),
        signal: AbortSignal.timeout(CREATE_TOP_UP_BUDGET_MS),
      });
    }
    // #1547: a sales visit (+prospect account, free pictures) gets one more free try at each missing ad's picture,
    // with the words it already passed (₹0, no text call); pictures still queue one at a time. Never customers.
    const concepts = Object.fromEntries([...failed.values()]
      .flatMap(({ angle, error }) => pictureOnly(error) ? [[angle.id, error.concept!] as const] : [])
      .slice(0, count - inserted.length));
    const retryBudget = PROSPECT_PICTURE_RETRY_END_MS - (Date.now() - startedAt);
    if (Object.keys(concepts).length && retryBudget >= PROSPECT_PICTURE_RETRY_MIN_MS) {
      pictureRetry = Object.keys(concepts).length;
      live?.onTopUp(pictureRetry, "picture");
      await generateVariants({ ...run, angleIds: Object.keys(concepts), count: pictureRetry, concepts, ownerPhotos: undefined, recentCopy, signal: AbortSignal.timeout(retryBudget) });
    }
    failures = [...failed.values()].map(({ angle, message }) => ({ angle: angle.name, error: message }));
    const noProvider = !inserted.length && failures.length === count && noProviderFailures === count;
    await progress(0, true, usageUnknown || inserted.length + failures.length < count, !inserted.length);
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

  // #681: the whole batch's wall time; usage rows are written at the end, so they can't time it.
  // Internal accounts make free images (Cloudflare when configured, else Pollinations, #1476); customers wait on the paid path.
  recordProductEvent({ kind: "workflow", name: "creative.batch", businessId, durationMs: Date.now() - startedAt,
    outcome: !inserted.length ? "failed" : failures.length ? "partial" : "success",
    // #1468: the estimated AI cost of this Create (USD), for the top-up and image-provider decisions.
    attributes: { count: inserted.length, failedCount: failures.length, topUp, ...(pictureRetry ? { pictureRetry } : {}), provider: freeImagesOnly() ? (cloudflareConfigured() ? "cloudflare" : "pollinations") : "paid",
      costUsd: roundUsd(cost.text + cost.image), textCostUsd: roundUsd(cost.text), imageCostUsd: roundUsd(cost.image) } });
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
