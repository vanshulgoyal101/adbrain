import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
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
