import { createClient } from "@/lib/supabase/server";
import { getEnv } from "@/lib/env";
import type { TokenUsage } from "./types";

export interface LLMUsageEvent {
  businessId: string;
  userId: string;
  route: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  requestId: string;
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
        provider: event.provider,
        model: event.model,
        prompt_tokens: event.usage.promptTokens,
        completion_tokens: event.usage.completionTokens,
        total_tokens: event.usage.totalTokens,
        estimated_cost_usd: estimatedCost(event.model, event.usage),
        request_id: event.requestId,
      })),
    );
  } catch {
    // Usage telemetry must never break creative generation.
  }
}
