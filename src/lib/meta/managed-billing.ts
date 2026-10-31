import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProvisionGraph } from "./managed-provision";
import { graphClient, readToken } from "./managed-provision-runner";

/**
 * #2359 (#2357): a managed customer pays Meta with their own card on their child ad account. Meta has
 * no API to add a card, so the owner names the person who will add it; AdBrain invites them to the
 * child business as EMPLOYEE, gives them MANAGE on its ad account once they have joined (MANAGE
 * "includes billing"), and moves the ledger to `funded` only when Meta's own read of the ad account
 * shows a usable funding source. A click never funds. Every call runs on the child's own system-user
 * token (#624). The invited email is sent to Meta only: never stored, logged or put in step_keys.
 */

/** Meta's `funding_source_details` and `account_status` (Graph reference, Ad Account). */
export type FundingRead = {
  account_status?: number;
  funding_source_details?: { id?: string; type?: number; display_string?: string } | null;
};

/** Why an ad account can't run ads yet, as the owner screen explains it. */
export type FundingReason =
  | "NO_PAYMENT_METHOD" | "PREPAID_UNCONFIRMED" | "NOT_OWN_PAYMENT_METHOD" | "PAYMENT_DUE" | "PENDING_REVIEW"
  | "IN_GRACE_PERIOD" | "ACCOUNT_DISABLED" | "ACCOUNT_CLOSED" | "ACCOUNT_NOT_ACTIVE";

/** 0 UNSET and 14 FS_NULL: no payment method. */
const NO_SOURCE_TYPES = [0, 14];
/**
 * Payment methods a customer adds themselves: 1 card, 12/13 PayPal, 17 direct debit, 19 alternative payment.
 * An allow-list, so a credit line or invoice (4, 6) shared from a parent, or any unknown type, fails closed:
 * AdBrain's money must never fund a child (#2357).
 */
const CUSTOMER_SOURCE_TYPES = [1, 12, 13, 17, 19];
/** 20 STORED_BALANCE: a prepaid balance can be empty and then won't deliver; funded only once a walk records its shape (CTO, #2359). */
const PREPAID_TYPE = 20;

/** Funded only when the account is ACTIVE (1) and Meta reports a real payment method (CTO conditions, #2359). */
export function fundingFromMeta(read: FundingRead): { funded: true } | { funded: false; reason: FundingReason } {
  const status = read.account_status;
  if (status === 2) return { funded: false, reason: "ACCOUNT_DISABLED" };
  if (status === 100 || status === 101 || status === 202) return { funded: false, reason: "ACCOUNT_CLOSED" };
  const source = read.funding_source_details;
  if (!source?.id || typeof source.type !== "number" || NO_SOURCE_TYPES.includes(source.type)) return { funded: false, reason: "NO_PAYMENT_METHOD" };
  if (source.type === PREPAID_TYPE) return { funded: false, reason: "PREPAID_UNCONFIRMED" };
  if (!CUSTOMER_SOURCE_TYPES.includes(source.type)) return { funded: false, reason: "NOT_OWN_PAYMENT_METHOD" };
  if (status === 3 || status === 8) return { funded: false, reason: "PAYMENT_DUE" };
  if (status === 7) return { funded: false, reason: "PENDING_REVIEW" };
  if (status === 9) return { funded: false, reason: "IN_GRACE_PERIOD" };
  if (status !== 1) return { funded: false, reason: "ACCOUNT_NOT_ACTIVE" };
  return { funded: true };
}

/** none: nobody invited; invited: Meta's invite is not accepted yet ("waiting for your person"); joined: in the child business. */
export type PayerStatus = "none" | "invited" | "joined";

export type BillingCheck =
  | { status: "funded" }
  | { status: "not_funded"; reason: FundingReason; payer: PayerStatus }
  | { status: "waiting_setup" }
  | { status: "unavailable" };

export type PayerInvite =
  | { status: "invited" }
  | { status: "funded" }
  | { status: "invalid_email" }
  | { status: "too_many_invites" }
  | { status: "waiting_setup" }
  | { status: "unavailable" };

export type BillingRow = {
  state: string;
  child_business_id: string | null;
  ad_account_id: string | null;
  step_keys: unknown;
  manager_token_id: string | null;
  whatsapp_number_e164: string | null;
};

export interface BillingDeps {
  businessId: string;
  row(): Promise<BillingRow | null>;
  managerToken(tokenId: string): Promise<string | null>;
  /** Writes only while the row is still in `whenState`, so a concurrent change is never overwritten. */
  update(values: { state?: "funded" | "whatsapp_linked"; funding_state?: "card_attached"; step_keys?: Record<string, string>; last_error?: null }, whenState: string): Promise<void>;
  event(values: { step: "funding"; outcome: "started" | "succeeded"; idempotency_key: string; meta_object_id?: string }): Promise<void>;
  graph: ProvisionGraph;
}

const FUNDED_STATES = ["funded", "whatsapp_linked", "ready"];
const STOPPED_STATES = ["failed", "offboarding", "offboarded"];
const PAYER_ROLE = "EMPLOYEE";
/** Invites go out from a child under the AdBrain BP: refuse a new address while this many are unaccepted, so it can't send spam. */
export const MAX_PENDING_INVITES = 3;
const PAYER_TASKS = ["MANAGE"];
const email = z.email().max(254);

type Ready = { row: BillingRow; childId: string; adAccountId: string; token: string; keys: Record<string, string> };

/** The child, its ad account and its manager (granted on the ad account) exist; otherwise why not. */
async function setUp(deps: BillingDeps): Promise<Ready | { status: "funded" | "waiting_setup" | "unavailable" }> {
  const row = await deps.row();
  if (!row) return { status: "waiting_setup" };
  if (FUNDED_STATES.includes(row.state)) return { status: "funded" };
  if (STOPPED_STATES.includes(row.state)) return { status: "unavailable" };
  const keys = row.step_keys && typeof row.step_keys === "object" && !Array.isArray(row.step_keys) ? { ...(row.step_keys as Record<string, string>) } : {};
  if (row.state !== "ad_account_created" || !row.child_business_id || !row.ad_account_id || !row.manager_token_id || !keys.grant) return { status: "waiting_setup" };
  const token = await deps.managerToken(row.manager_token_id);
  if (!token) return { status: "waiting_setup" };
  return { row, childId: row.child_business_id, adAccountId: row.ad_account_id, token, keys };
}

type Person = { id: string; email?: string };
const people = async (deps: BillingDeps, path: string, token: string) => (await deps.graph.get<{ data?: Person[] }>(path, token)).data ?? [];
const sameEmail = (a: string | undefined, b: string) => a?.trim().toLowerCase() === b;

/** Invite the owner's person to the child business, unless they are already in it or invited (read before write). */
export async function invitePayer(input: { email: string }, deps: BillingDeps): Promise<PayerInvite> {
  const parsed = email.safeParse(input.email.trim().toLowerCase());
  if (!parsed.success) return { status: "invalid_email" };
  const ready = await setUp(deps);
  if ("status" in ready) return ready;
  const { childId, token, keys } = ready;
  const address = parsed.data;
  const member = (await people(deps, `${childId}/business_users?fields=id,email&limit=100`, token)).some((person) => sameEmail(person.email, address));
  const pending = member ? [] : await people(deps, `${childId}/pending_users?fields=id,email&limit=100`, token);
  const known = member || pending.some((person) => sameEmail(person.email, address));
  const key = `invite:${deps.businessId}`;
  if (!known && pending.length >= MAX_PENDING_INVITES) return { status: "too_many_invites" };
  if (!known) {
    await deps.event({ step: "funding", outcome: "started", idempotency_key: key });
    await deps.graph.post(`${childId}/business_users`, { email: address, role: PAYER_ROLE }, token);
  }
  if (keys.payer_invite !== key) await deps.update({ step_keys: { ...keys, payer_invite: key } }, "ad_account_created");
  return { status: "invited" };
}

/**
 * 'Check again': give everyone who has joined the child MANAGE on its ad account (only the people the
 * owner invited, or the owner, can be in it), then read the account's funding from Meta.
 */
export async function checkFunding(deps: BillingDeps): Promise<BillingCheck> {
  const ready = await setUp(deps);
  if ("status" in ready) return ready;
  const { row, childId, adAccountId, token, keys } = ready;

  const members = await people(deps, `${childId}/business_users?fields=id&limit=100`, token);
  if (members.length) {
    const assigned = await deps.graph.get<{ data?: { id: string; tasks?: string[] }[] }>(
      `${adAccountId}/assigned_users?business=${encodeURIComponent(childId)}&fields=id,tasks`, token);
    for (const person of members) {
      const has = assigned.data?.some((user) => user.id === person.id && PAYER_TASKS.every((task) => user.tasks?.includes(task)));
      if (!has) await deps.graph.post(`${adAccountId}/assigned_users`, { user: person.id, tasks: JSON.stringify(PAYER_TASKS), business: childId }, token);
    }
  }
  const payer: PayerStatus = members.length ? "joined"
    : keys.payer_invite || (await people(deps, `${childId}/pending_users?fields=id&limit=100`, token)).length ? "invited" : "none";

  const verdict = fundingFromMeta(await deps.graph.get<FundingRead>(`${adAccountId}?fields=account_status,funding_source_details`, token));
  if (!verdict.funded) return { status: "not_funded", reason: verdict.reason, payer };

  await deps.update({ state: "funded", funding_state: "card_attached", last_error: null }, "ad_account_created");
  // WhatsApp linked while the account waited for its card (#524): move on as managed-whatsapp does from funded.
  if (row.whatsapp_number_e164) await deps.update({ state: "whatsapp_linked" }, "funded");
  await deps.event({ step: "funding", outcome: "succeeded", idempotency_key: `funding:${deps.businessId}`, meta_object_id: adAccountId });
  return { status: "funded" };
}

/** The real dependencies: the ledger (service role), the encrypted token store and Meta's Graph API. */
export function billingDeps(businessId: string): BillingDeps {
  const admin = createAdminClient();
  // whatsapp_number_e164 (#519) isn't in the generated types yet, as in managed-whatsapp.
  const table = () => (admin as unknown as SupabaseClient).from("managed_meta_accounts");
  return {
    businessId,
    row: async () => {
      const { data, error } = await table()
        .select("state,child_business_id,ad_account_id,step_keys,manager_token_id,whatsapp_number_e164").eq("business_id", businessId).maybeSingle();
      if (error) throw new Error("The managed account could not be read.");
      return data as BillingRow | null;
    },
    managerToken: (tokenId) => readToken(admin, tokenId, businessId),
    update: async (values, whenState) => {
      const { error } = await table().update(values).eq("business_id", businessId).eq("state", whenState);
      if (error) throw new Error("The managed account could not be updated.");
    },
    event: async (values) => {
      const { error } = await admin.from("managed_meta_account_events").insert({ business_id: businessId, ...values });
      if (error) throw new Error("The funding step could not be logged.");
    },
    graph: graphClient(getEnv().META_APP_SECRET),
  };
}
