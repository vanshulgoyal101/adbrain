import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types";
import { getProductionPaymentConfig } from "@/lib/payments/production-config";

/**
 * The writer lease and last decision for a managed child ad account's Meta spending limit (#522),
 * `private.managed_spend_caps` behind service-role functions (migration 20261025_managed_spend_caps).
 */

/** Longer than any pass: a few Meta calls with their own timeouts inside a 60 s function. */
export const SPEND_CAP_LEASE_SECONDS = 120;

export type RecordedSpendCapDecision = { action: "set" | "keep" | "freeze" | "stop"; capPaise: number; roomPaise: number };
export interface SpendCapInputs { mediaThisAccountPaise: number; mediaOtherAccountsPaise: number; taxRateBps: number }
/** `leased`: a pass is running now; it will see any newer event before it releases the lease. */
export interface SpendCapState { dirty: boolean; leased: boolean; action: RecordedSpendCapDecision["action"] | null; capPaise: number | null; roomPaise: number | null }
export type SpendCapTarget = { businessId: string; userId: string };

export interface SpendCapStore {
  /** Marks the limit stale and claims the writer lease if free. True: the caller writes. */
  request(businessId: string, adAccountId: string, token: string): Promise<boolean>;
  /** Starts a pass and clears the stale mark. False: the lease was lost. */
  begin(adAccountId: string, token: string): Promise<boolean>;
  /** Records the decision. True: an event arrived during the pass, so run again. Throws SpendCapLeaseLostError. */
  finish(adAccountId: string, token: string, decision: RecordedSpendCapDecision): Promise<boolean>;
  /** A failed pass: releases the lease, keeps the limit stale and drops the last decision. */
  abandon(adAccountId: string, token: string): Promise<void>;
  inputs(businessId: string, adAccountId: string): Promise<SpendCapInputs>;
  state(businessId: string, adAccountId: string): Promise<SpendCapState>;
  /** Marks a business's child account limit stale; its owner when it is managed, else null. */
  markStale(businessId: string): Promise<SpendCapTarget | null>;
  /** The same for a payment event, by payment or provider order, before AdBrain has processed it. */
  markPaymentStale(paymentId: string, providerOrderId: string | null): Promise<SpendCapTarget | null>;
  /** Managed businesses in sweep order: stale limits first, then the oldest decision. */
  due(limit: number): Promise<string[]>;
}

export class SpendCapLeaseLostError extends Error {
  constructor() {
    super("Another writer took over this ad account's spending limit.");
    this.name = "SpendCapLeaseLostError";
  }
}

export class SpendCapStoreError extends Error {
  constructor() {
    super("The managed account's spending limit record could not be read or written.");
    this.name = "SpendCapStoreError";
  }
}

type SpendCapDatabase = Database & { public: { Functions: {
  managed_spend_cap_request: { Args: { p_business_id: string; p_ad_account_id: string; p_token: string; p_lease_seconds: number }; Returns: boolean };
  managed_spend_cap_begin: { Args: { p_ad_account_id: string; p_token: string; p_lease_seconds: number }; Returns: boolean };
  managed_spend_cap_finish: { Args: { p_ad_account_id: string; p_token: string; p_action: string; p_cap_paise: number; p_room_paise: number; p_lease_seconds: number }; Returns: boolean };
  managed_spend_cap_abandon: { Args: { p_ad_account_id: string; p_token: string }; Returns: undefined };
  managed_spend_cap_state: { Args: { p_business_id: string; p_ad_account_id: string }; Returns: unknown };
  managed_spend_cap_inputs: { Args: { p_business_id: string; p_ad_account_id: string; p_account_id: string }; Returns: unknown };
  managed_spend_cap_mark_stale: { Args: { p_business_id: string }; Returns: unknown };
  managed_spend_cap_mark_payment_stale: { Args: { p_account_id: string; p_payment_id: string; p_provider_order_id: string | null }; Returns: unknown };
  managed_spend_cap_due: { Args: { p_limit: number }; Returns: unknown };
} } };

const paise = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const inputsSchema = z.object({ mediaThisAccountPaise: paise, mediaOtherAccountsPaise: paise, taxRateBps: z.number().int().min(0).max(10_000) });
const targetSchema = z.object({ businessId: z.uuid(), userId: z.uuid() }).nullable();
const stateSchema = z.object({
  dirty: z.boolean(), leased: z.boolean(), action: z.enum(["set", "keep", "freeze", "stop"]).nullable(), capPaise: paise.nullable(), roomPaise: paise.nullable(),
});

async function call<Schema extends z.ZodType>(query: PromiseLike<{ data: unknown; error: { code?: string } | null }>, schema: Schema) {
  const { data, error } = await query;
  if (error?.code === "55000") throw new SpendCapLeaseLostError();
  const parsed = schema.safeParse(data);
  if (error || !parsed.success) throw new SpendCapStoreError();
  return parsed.data as z.output<Schema>;
}

export function supabaseSpendCapStore(): SpendCapStore {
  const database = createAdminClient() as SupabaseClient<SpendCapDatabase>;
  const lease = { p_lease_seconds: SPEND_CAP_LEASE_SECONDS };
  return {
    request: (businessId, adAccountId, token) => call(database.rpc("managed_spend_cap_request",
      { p_business_id: businessId, p_ad_account_id: adAccountId, p_token: token, ...lease }), z.boolean()),
    begin: (adAccountId, token) => call(database.rpc("managed_spend_cap_begin", { p_ad_account_id: adAccountId, p_token: token, ...lease }), z.boolean()),
    finish: (adAccountId, token, decision) => call(database.rpc("managed_spend_cap_finish", {
      p_ad_account_id: adAccountId, p_token: token, p_action: decision.action,
      p_cap_paise: decision.capPaise, p_room_paise: decision.roomPaise, ...lease,
    }), z.boolean()),
    abandon: async (adAccountId, token) => {
      await call(database.rpc("managed_spend_cap_abandon", { p_ad_account_id: adAccountId, p_token: token }), z.unknown());
    },
    inputs: (businessId, adAccountId) => call(database.rpc("managed_spend_cap_inputs", {
      p_business_id: businessId, p_ad_account_id: adAccountId, p_account_id: getProductionPaymentConfig().accountId,
    }), inputsSchema),
    state: (businessId, adAccountId) => call(database.rpc("managed_spend_cap_state", { p_business_id: businessId, p_ad_account_id: adAccountId }), stateSchema),
    markStale: (businessId) => call(database.rpc("managed_spend_cap_mark_stale", { p_business_id: businessId }), targetSchema),
    markPaymentStale: (paymentId, providerOrderId) => call(database.rpc("managed_spend_cap_mark_payment_stale", {
      p_account_id: getProductionPaymentConfig().accountId, p_payment_id: paymentId, p_provider_order_id: providerOrderId,
    }), targetSchema),
    due: async (limit) => (await call(database.rpc("managed_spend_cap_due", { p_limit: limit }), z.array(z.object({ business_id: z.uuid() }))))
      .map((row) => row.business_id),
  };
}
