import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import type { LLMFailureCode, RateLimitInfo, TokenUsage } from "./types";
import type { Json } from "@/lib/types";
import { recordProductEvent } from "@/lib/observability/logger";
import { isInternalUser, type AccountIdentity } from "@/lib/internal-accounts";
import { FREE_TEXT_PROVIDERS, freeTextOnly } from "./spend-policy";

export interface LLMUsageEvent {
  /** Null before a business exists (Brand autofill on first setup): the ai.completion event only. */
  businessId: string | null;
  userId: string;
  route: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  requestId: string;
  generationId?: string;
  /** The saved ad a later change (regenerate, background) spent on (#451). */
  creativeId?: string;
  usageKind?: "text" | "image";
  promptVersion?: string;
  inputChars?: number;
  outputChars?: number;
  temperature?: number;
  maxTokens?: number;
  cacheHit?: boolean;
  latencyMs?: number;
  attempt?: number;
  status?: "success" | "error" | "fallback";
  errorCode?: string;
  failure?: LLMFailureCode;
  /** #1200: which provider limit a 429 hit. */
  rateLimit?: RateLimitInfo;
  imageWidth?: number;
  imageHeight?: number;
  estimatedCostUsd?: number;
  metadata?: { [key: string]: Json };
  providerRequestId?: string;
  providerFinalStatus?: "completed" | "failed" | "unknown";
}

export interface LLMUsageSummary {
  calls: number;
  totalTokens: number;
  estimatedCostUsd: number;
  provider: string | null;
  model: string | null;
}

const RATES_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  // OpenRouter list price (openrouter.ai/api/v1/models, Oct 24): Create's concept model (#451).
  "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5 },
};

function estimatedCost(model: string, usage: TokenUsage): number {
  const rate = RATES_USD_PER_MILLION[model] ?? { input: 1, output: 4 };
  return (
    (usage.promptTokens * rate.input + usage.completionTokens * rate.output) /
    1_000_000
  );
}

/** #2230: the smoke login's text runs only on free tiers (`freeTextOnly`), so its text rows cost $0. */
function eventCost(event: LLMUsageEvent): number {
  if (event.estimatedCostUsd !== undefined) return event.estimatedCostUsd;
  const freeText = (event.usageKind ?? "text") === "text" && FREE_TEXT_PROVIDERS.includes(event.provider) && freeTextOnly();
  return freeText ? 0 : estimatedCost(event.model, event.usage);
}

function monthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Returns null when the ledger table has not been migrated yet. */
export async function monthlyTokenUsage(businessId: string): Promise<number | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("monthly_token_usage", {
      p_business_id: businessId,
      p_since: monthStart(),
    });
    if (error || typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) return null;
    return data;
  } catch {
    return null;
  }
}

/** Small aggregate for the private demo account; raw prompts are never returned. */
export async function businessLLMUsageSummary(
  businessId: string,
): Promise<LLMUsageSummary> {
  const empty: LLMUsageSummary = {
    calls: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    provider: null,
    model: null,
  };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("llm_usage_events")
      .select("provider, model, total_tokens, estimated_cost_usd, created_at")
      .eq("business_id", businessId)
      .eq("route", "creatives.generate")
      .eq("usage_kind", "text")
      .order("created_at", { ascending: false });
    if (error || !data?.length) return empty;
    return {
      calls: data.length,
      totalTokens: data.reduce((sum, row) => sum + (row.total_tokens ?? 0), 0),
      estimatedCostUsd: data.reduce(
        (sum, row) => sum + (row.estimated_cost_usd ?? 0),
        0,
      ),
      provider: data[0].provider,
      model: data[0].model,
    };
  } catch {
    return empty;
  }
}

/** Tokens a business may use per month; 0 means no limit. Internal accounts have none (#398). */
export function configuredMonthlyTokenLimit(user?: AccountIdentity): number {
  return isInternalUser(user) ? 0 : getEnv().LLM_MONTHLY_TOKEN_LIMIT;
}

/** The rule names a rejected reply broke (#378), bounded to what the product event accepts. */
function validationRules(metadata: LLMUsageEvent["metadata"]): { validationRules?: string[] } {
  const rules = metadata?.validationRules;
  if (!Array.isArray(rules)) return {};
  const names = rules.filter((rule): rule is string => typeof rule === "string" && /^[a-zA-Z0-9_.:*/[\]-]{1,80}$/.test(rule)).slice(0, 12);
  return names.length ? { validationRules: names } : {};
}

/** The recorded error code: the provider's own failure first (`LLM_HTTP_429`), else the caller's (#614). */
export function usageErrorCode(event: Pick<LLMUsageEvent, "failure" | "errorCode">): string | null {
  return event.failure ? `LLM_${event.failure}` : event.errorCode ?? null;
}

/** #1468: what usage events cost (USD, the same estimate the rows store), text and images apart. */
export function usageCostUsd(events: LLMUsageEvent[]): { text: number; image: number } {
  const cost = { text: 0, image: 0 };
  for (const event of events) cost[event.usageKind ?? "text"] += eventCost(event);
  return cost;
}

/** Best-effort persistence; callers admitting paid work can retain a hold on failure. */
export async function persistLLMUsage(events: LLMUsageEvent[]): Promise<boolean> {
  if (!events.length) return true;
  for (const event of events) recordProductEvent({
    kind: "workflow", name: "ai.completion", businessId: event.businessId,
    outcome: event.status === "error" ? "failed" : event.status === "fallback" ? "partial" : "success",
    durationMs: event.latencyMs,
    attributes: { provider: event.provider, model: event.model, inputTokens: event.usage.promptTokens,
      outputTokens: event.usage.completionTokens, totalTokens: event.usage.totalTokens,
      estimatedCostUsd: eventCost(event),
      usageKind: event.usageKind ?? "text", attempt: event.attempt ?? 1, cacheHit: event.cacheHit ?? false,
      ...(usageErrorCode(event) ? { errorCode: usageErrorCode(event)! } : {}),
      ...(event.rateLimit ? { rateLimitType: event.rateLimit.type, rateLimitLimit: event.rateLimit.limit,
        rateLimitUsed: event.rateLimit.used, rateLimitRequested: event.rateLimit.requested } : {}),
      ...validationRules(event.metadata) },
  });
  const rows = events.filter((event): event is LLMUsageEvent & { businessId: string } => event.businessId !== null);
  if (!rows.length) return true;
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("llm_usage_events").insert(
      rows.map((event) => ({
        business_id: event.businessId,
        user_id: event.userId,
        route: event.route,
        usage_kind: event.usageKind ?? "text",
        provider: event.provider,
        model: event.model,
        prompt_tokens: event.usage.promptTokens,
        completion_tokens: event.usage.completionTokens,
        total_tokens: event.usage.totalTokens,
        estimated_cost_usd: eventCost(event),
        prompt_version: event.promptVersion ?? null,
        input_chars: event.inputChars ?? 0,
        output_chars: event.outputChars ?? 0,
        temperature: event.temperature ?? null,
        max_tokens: event.maxTokens ?? null,
        cache_hit: event.cacheHit ?? false,
        latency_ms: event.latencyMs ?? null,
        attempt: event.attempt ?? 1,
        status: event.status ?? "success",
        // #614: a provider failure (HTTP 429/403, timeout…) keeps its own code even inside a creative
        // error, so a rate limit is never read as a validation failure (same rule as the product event).
        error_code: usageErrorCode(event),
        image_width: event.imageWidth ?? null,
        image_height: event.imageHeight ?? null,
        metadata: {
          ...event.metadata,
          ...(event.generationId ? { generationId: event.generationId } : {}),
          ...(event.creativeId ? { creativeId: event.creativeId } : {}),
          ...(event.providerRequestId ? { providerRequestId: event.providerRequestId } : {}),
          ...(event.failure ? { failure: event.failure } : {}),
          providerFinalStatus: event.providerFinalStatus ?? "unknown",
        },
        request_id: event.requestId,
      })),
    ).abortSignal(AbortSignal.timeout(3_000));
    if (error) recordProductEvent({ kind: "system", name: "ai.usage.persist", outcome: "failed", attributes: { errorCode: "USAGE_WRITE_FAILED" } });
    return !error;
  } catch {
    recordProductEvent({ kind: "system", name: "ai.usage.persist", outcome: "failed", attributes: { errorCode: "USAGE_WRITE_FAILED" } });
    return false;
  }
}
