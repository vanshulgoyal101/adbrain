import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getManagedAccount } from "@/lib/meta/managed-account";
import type { Database } from "@/lib/types";

type FundingDatabase = Database & { public: { Functions: {
  operator_funded: { Args: { p_business_id: string }; Returns: boolean };
} } };

/** #245: the operator funds this business directly on Meta, so no customer allowance applies. Throws when unverifiable. */
export async function isOperatorFunded(businessId: string): Promise<boolean> {
  const database = createAdminClient() as SupabaseClient<FundingDatabase>;
  const { data, error } = await database.rpc("operator_funded", { p_business_id: z.uuid().parse(businessId) })
    .abortSignal(AbortSignal.timeout(4_000));
  if (error || typeof data !== "boolean") throw new Error("Operator funding could not be verified.");
  return data;
}

/**
 * #759 (CTO): who pays Meta for this business's ads. `operator`: the operator funds it on Meta (#245).
 * `managed`: AdBrain holds the owner's ad money, so activation needs an allowance. `own`: the owner pays
 * Meta from their own ad account and AdBrain holds nothing. Throws when unverifiable (callers fail closed).
 */
export type FundingMode = "operator" | "managed" | "own";
export async function fundingMode(businessId: string): Promise<FundingMode> {
  if (await isOperatorFunded(businessId)) return "operator";
  return (await getManagedAccount(businessId)) ? "managed" : "own";
}
