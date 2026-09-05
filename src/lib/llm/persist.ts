import { createClient } from "@/lib/supabase/server";
import { getEnv } from "@/lib/env";
import type { TokenUsage } from "./types";
import type { Json } from "@/lib/types";

export interface LLMUsageEvent {
  businessId: string;
  userId: string;
  route: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  requestId: string;
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
  imageWidth?: number;
  imageHeight?: number;
  estimatedCostUsd?: number;
  metadata?: { [key: string]: Json };
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
};

function estimatedCost(model: string, usage: TokenUsage): number {
  const rate = RATES_USD_PER_MILLION[model] ?? { input: 1, output: 4 };
  return (
    (usage.promptTokens * rate.input + usage.completionTokens * rate.output) /
    1_000_000
  );
}

function monthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Returns null when the ledger table has not been migrated yet. */
export async function monthlyTokenUsage(businessId: string): Promise<number | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("llm_usage_events")
      .select("total_tokens")
      .eq("business_id", businessId)
      .gte("created_at", monthStart());
    if (error) return null;
    return (data ?? []).reduce((sum, row) => sum + (row.total_tokens ?? 0), 0);
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

export function configuredMonthlyTokenLimit(): number {
  return getEnv().LLM_MONTHLY_TOKEN_LIMIT;
}

/** Best-effort persistence: generation should not fail because telemetry is unavailable. */
export async function persistLLMUsage(events: LLMUsageEvent[]): Promise<void> {
  if (!events.length) return;
  try {
    const supabase = await createClient();
    await supabase.from("llm_usage_events").insert(
      events.map((event) => ({
        business_id: event.businessId,
        user_id: event.userId,
        route: event.route,
        usage_kind: event.usageKind ?? "text",
        provider: event.provider,
        model: event.model,
        prompt_tokens: event.usage.promptTokens,
        completion_tokens: event.usage.completionTokens,
        total_tokens: event.usage.totalTokens,
        estimated_cost_usd:
          event.estimatedCostUsd ?? estimatedCost(event.model, event.usage),
        prompt_version: event.promptVersion ?? null,
        input_chars: event.inputChars ?? 0,
        output_chars: event.outputChars ?? 0,
        temperature: event.temperature ?? null,
        max_tokens: event.maxTokens ?? null,
        cache_hit: event.cacheHit ?? false,
        latency_ms: event.latencyMs ?? null,
        attempt: event.attempt ?? 1,
        status: event.status ?? "success",
        error_code: event.errorCode ?? null,
        image_width: event.imageWidth ?? null,
        image_height: event.imageHeight ?? null,
        metadata: event.metadata ?? {},
        request_id: event.requestId,
      })),
    );
  } catch {
    // Usage telemetry must never break creative generation.
  }
}
