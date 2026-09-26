import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types";
import { getProductionPaymentConfig } from "./production-config";
import { customerBalanceSchema, customerPaiseSchema as paise, customerCostEvidenceSchema, customerRefundAllocationSchema, type CustomerBalance } from "./customer-balance-contracts";

type Actor = { businessId: string; userId: string };
type Scope = { p_business_id: string; p_user_id: string; p_account_id: string };
type AccountingDatabase = Database & { public: { Functions: {
  customer_ad_balance: { Args: Scope; Returns: unknown };
  customer_ad_reserve: { Args: Scope & {
    p_campaign_id: string; p_ad_account_id: string; p_connection_generation: number;
    p_daily_budget_paise: number; p_request_key: string; p_review_only: boolean;
  }; Returns: unknown };
  customer_ad_activation_result: { Args: Scope & { p_campaign_id: string; p_reservation_id: string; p_state: "active" | "paused" | "uncertain" }; Returns: undefined };
  customer_ad_reconcile_costs: { Args: {
    p_business_id: string; p_actor_id: string; p_account_id: string; p_campaign_id: string; p_ad_account_id: string;
    p_connection_generation: number; p_media_paise: number; p_tax_paise: number; p_tax_rate_bps: number;
    p_observed_at: string; p_evidence_reference: string; p_final: boolean; p_reservation_id: string | null;
  }; Returns: undefined };
  customer_ad_refund_allocation: { Args: {
    p_business_id: string; p_actor_id: string; p_account_id: string; p_order_id: string; p_service_refunded_paise: number;
    p_advertising_refunded_paise: number; p_service_earned_paise: number; p_evidence_reference: string;
  }; Returns: undefined };
} } };

export class CustomerBalanceError extends Error {
  constructor(message = "Customer advertising funds could not be verified. Payment or cost reconciliation is required.") {
    super(message);
    this.name = "CustomerBalanceError";
  }
}

function accounting(actor: Actor) {
  const config = getProductionPaymentConfig();
  return {
    database: createAdminClient() as SupabaseClient<AccountingDatabase>,
    scope: { p_business_id: z.uuid().parse(actor.businessId), p_user_id: z.uuid().parse(actor.userId), p_account_id: config.accountId },
  };
}

async function checked<Schema extends z.ZodType>(query: {
  abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
}, schema: Schema): Promise<z.output<Schema>> {
  try {
    const { data, error } = await query.abortSignal(AbortSignal.timeout(4_000));
    const parsed = schema.safeParse(data);
    if (error || !parsed.success) throw new CustomerBalanceError();
    return parsed.data;
  } catch {
    throw new CustomerBalanceError();
  }
}

export async function getCustomerBalance(actor: Actor): Promise<CustomerBalance> {
  const { database, scope } = accounting(actor);
  const balance = await checked(database.rpc("customer_ad_balance", scope), customerBalanceSchema);
  if (balance.businessId !== actor.businessId) throw new CustomerBalanceError();
  return balance;
}

export async function reserveCustomerCampaign(actor: Actor, input: {
  campaignId: string; adAccountId: string; connectionGeneration: number; dailyBudgetRupees: number; requestKey: string;
}, reviewOnly = false) {
  const { database, scope } = accounting(actor);
  const rupees = z.number().positive().multipleOf(0.01).parse(input.dailyBudgetRupees);
  const result = await checked(database.rpc("customer_ad_reserve", {
    ...scope, p_campaign_id: z.uuid().parse(input.campaignId),
    p_ad_account_id: z.string().regex(/^act_[0-9]+$/).parse(input.adAccountId),
    p_connection_generation: z.number().int().positive().parse(input.connectionGeneration),
    p_daily_budget_paise: paise.positive().parse(Math.round(rupees * 100)),
    p_request_key: z.string().regex(/^[a-f0-9]{64}$/).parse(input.requestKey),
    p_review_only: reviewOnly,
  }), z.object({ reservationId: z.uuid(), mediaLimitPaise: paise.positive(), balance: customerBalanceSchema }));
  if (result.balance.businessId !== actor.businessId || result.balance.held) throw new CustomerBalanceError();
  return result;
}

export async function confirmCustomerCampaign(actor: Actor, campaignId: string, reservationId: string, state: "active" | "paused" | "uncertain") {
  const { database, scope } = accounting(actor);
  await checked(database.rpc("customer_ad_activation_result", {
    ...scope, p_campaign_id: z.uuid().parse(campaignId), p_reservation_id: z.uuid().parse(reservationId), p_state: state,
  }), z.unknown());
}

export async function reconcileCustomerCosts(actor: Actor, input: z.infer<typeof customerCostEvidenceSchema>) {
  const { database, scope } = accounting(actor);
  const evidence = customerCostEvidenceSchema.parse(input);
  await checked(database.rpc("customer_ad_reconcile_costs", {
    p_business_id: scope.p_business_id, p_actor_id: scope.p_user_id, p_account_id: scope.p_account_id,
    p_campaign_id: evidence.campaignId, p_ad_account_id: evidence.adAccountId, p_connection_generation: evidence.connectionGeneration,
    p_media_paise: evidence.mediaPaise, p_tax_paise: evidence.taxPaise, p_tax_rate_bps: evidence.taxRateBps,
    p_observed_at: evidence.observedAt, p_evidence_reference: evidence.evidenceReference, p_final: evidence.final, p_reservation_id: evidence.reservationId,
  }), z.unknown());
}

export async function reconcileCustomerRefund(actor: Actor, input: z.infer<typeof customerRefundAllocationSchema>) {
  const { database, scope } = accounting(actor);
  const allocation = customerRefundAllocationSchema.parse(input);
  await checked(database.rpc("customer_ad_refund_allocation", {
    p_business_id: scope.p_business_id, p_actor_id: scope.p_user_id, p_account_id: scope.p_account_id,
    p_order_id: allocation.orderId, p_service_refunded_paise: allocation.serviceRefundedPaise,
    p_advertising_refunded_paise: allocation.advertisingRefundedPaise, p_service_earned_paise: allocation.serviceEarnedPaise,
    p_evidence_reference: allocation.evidenceReference,
  }), z.unknown());
}