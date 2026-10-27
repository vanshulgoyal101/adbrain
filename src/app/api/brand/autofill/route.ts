import { currentRequestId, observeRoute, recordProductEvent } from "@/lib/observability/logger";
import { observeIdentity } from "@/lib/observability/context";
import { NextResponse } from "next/server";
import { z } from "zod";
import { BRAND_EXTRACTION, extractPhone, extractWebsiteText } from "@/lib/brand/autofill";
import { completeJSON, NoLLMKeysError } from "@/lib/llm";
import { persistLLMUsage } from "@/lib/llm/persist";
import type { CompletionResult, ProviderAttempt } from "@/lib/llm/types";
import { fetchPublicUrlText, parsePublicUrl, SafeFetchError } from "@/lib/security/ssrf";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  buildBrandExtractionMessages,
  type BrandExtraction,
} from "@/lib/templates/ads";

export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = observeRoute("/api/brand/autofill", "POST", async (req: Request) => {
  const started = Date.now();
  const response = await handlePOST(req);
  // #1025: one event per autofill the owner waited for (not refused input), with how long it took,
  // for the scoreboard's Brand row. First setup has no business yet, so usage rows can't count it.
  if (![400, 401, 429].includes(response.status)) {
    recordProductEvent({
      kind: "workflow", name: "brand.autofill", outcome: response.ok ? "success" : "failed", durationMs: Date.now() - started,
      ...(response.ok ? {} : { attributes: { errorCode: `http.${response.status}` } }),
    });
  }
  return response;
});

async function handlePOST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  observeIdentity(user.id);

  const limited = await rateLimitResponse(`autofill:${user.id}`, {
    limit: 15,
    windowMs: 5 * 60_000,
  });
  if (limited) return limited;

  const body = z.object({ url: z.string().trim().min(1).max(2048), businessId: z.string().uuid().optional() })
    .safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "A website URL of at most 2048 characters is required." }, { status: 400 });
  }

  const parsed = parsePublicUrl(body.data.url);
  if (!parsed) {
    return NextResponse.json({ error: "That URL is not allowed" }, { status: 400 });
  }

  let html: string;
  try {
    html = await fetchPublicUrlText(parsed.toString(), {
      headers: { "User-Agent": "AdBrainBot/1.0 (+https://adbrain.vanshul.com)" },
      timeoutMs: 10_000,
    });
  } catch (err) {
    if (err instanceof SafeFetchError) {
      if (err.code === "blocked") {
        return NextResponse.json({ error: "That URL is not allowed" }, { status: 400 });
      }
      if (err.code === "status") {
        return NextResponse.json(
          { error: `Site returned ${err.status}` },
          { status: 502 },
        );
      }
    }
    return NextResponse.json(
      { error: "Could not fetch the site" },
      { status: 502 },
    );
  }

  const text = extractWebsiteText(html);
  if (!text) {
    return NextResponse.json(
      { error: "No readable text found on that page" },
      { status: 422 },
    );
  }

  // #650: every provider attempt is a usage row, on the owner's business when it already exists
  // (RLS); on first Brand setup there is none yet, so only the ai.completion event is kept.
  const owned = body.data.businessId
    ? await supabase.from("businesses").select("id").eq("id", body.data.businessId).maybeSingle().then(({ data }) => data?.id ?? null, () => null)
    : null;
  const attempts: ProviderAttempt[] = [];
  const requestId = currentRequestId();
  const logUsage = (completion?: CompletionResult) => {
    // A response-cache hit makes no provider call: one zero-token row says it was served.
    const calls: (ProviderAttempt & { cacheHit: boolean })[] = completion?.cached && !attempts.length
      ? [{ provider: completion.provider, model: completion.model, status: "success", providerFinalStatus: "completed", cacheHit: true }]
      : attempts.map((attempt) => ({ ...attempt, cacheHit: false }));
    return persistLLMUsage(calls.map((call) => ({
      businessId: owned, userId: user.id, requestId, route: "brand.autofill",
      provider: call.provider, model: call.model, usage: call.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latencyMs: call.latencyMs, attempt: 1, cacheHit: call.cacheHit,
      maxTokens: BRAND_EXTRACTION.maxTokens, temperature: BRAND_EXTRACTION.temperature,
      status: call.status, failure: call.failure,
      providerRequestId: call.providerRequestId, providerFinalStatus: call.providerFinalStatus,
    })));
  };

  try {
    const extraction = await completeJSON<BrandExtraction>(
      buildBrandExtractionMessages(text, parsed.toString()),
      { ...BRAND_EXTRACTION, cache: true, onAttempt: (attempt) => attempts.push(attempt) },
    );
    await logUsage((extraction as { __completion?: CompletionResult }).__completion);
    return NextResponse.json({ extraction: { ...extraction, phone: extractPhone(html) } });
  } catch (err) {
    await logUsage();
    if (err instanceof NoLLMKeysError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Could not extract business details. Try again later or enter them manually." },
      { status: 502 },
    );
  }
}
