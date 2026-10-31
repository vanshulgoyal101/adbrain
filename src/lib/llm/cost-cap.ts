import { getEnv } from "@/lib/env";
import { isInternalUser, type AccountIdentity } from "@/lib/internal-accounts";
import { markCostCapped } from "@/lib/llm/spend-policy";
import { createClient } from "@/lib/supabase/server";

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** The start of the calendar month in India (IST), as an ISO instant. */
export function monthStartIst(now = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS).toISOString();
}

/** A business's AI spend this IST month (text and paid pictures, USD); null when it can't be read. */
export async function monthlyAiCostUsd(businessId: string, now = new Date()): Promise<number | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("monthly_ai_cost_usd", { p_business_id: businessId, p_since: monthStartIst(now) });
    const usd = Number(data);
    return error || data === null || !Number.isFinite(usd) || usd < 0 ? null : usd;
  } catch {
    return null;
  }
}

/**
 * #1717: paid pictures weren't in the monthly cap (tokens only), so one account could drain the shared image key for
 * every customer. When `AI_MONTHLY_COST_LIMIT_USD` is set and this business's month-to-date AI spend has reached it
 * (or can't be read), this request's pictures come from the free providers. Internal accounts are exempt; unset = no
 * cap and no read. Text keeps the token cap. Returns whether the request is capped.
 */
export async function applyMonthlyCostCap(businessId: string, user: AccountIdentity, now = new Date()): Promise<boolean> {
  const limit = getEnv().AI_MONTHLY_COST_LIMIT_USD;
  if (limit === undefined || isInternalUser(user)) return false;
  const used = await monthlyAiCostUsd(businessId, now);
  if (used !== null && used < limit) return false;
  markCostCapped();
  return true;
}
