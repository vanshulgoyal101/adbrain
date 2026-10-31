import { createHmac, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProvisionGraph } from "./managed-provision";
import { graphClient, readToken } from "./managed-provision-runner";

/**
 * #2359 (#2357): a managed customer pays Meta with their own card on their child ad account. Meta has
 * no API to add a card, so the owner names the person who will add it; AdBrain invites them to the
 * child business as EMPLOYEE, gives that person alone MANAGE on its ad account once they have joined
 * (MANAGE "includes billing"), and moves the ledger to `funded` only when Meta's own read of the ad
 * account shows a usable funding source. A click never funds. Every call runs on the child's own
 * system-user token (#624), inside the ledger lease. The email is sent to Meta only; the ledger keeps a
 * keyed hash of it (step_keys.payer) to bind the grant, never the address.
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

/** none: nobody named; invited: Meta's invite is not accepted yet; joined: the named person is in the child business. */
export type PayerStatus = "none" | "invited" | "joined";

export type BillingCheck =
  | { status: "funded" }
  | { status: "not_funded"; reason: FundingReason; payer: PayerStatus }
  | { status: "busy" }
  | { status: "waiting_setup" }
  | { status: "unavailable" };

/** invited: a new invite went out; pending: one was already waiting; joined: already in the child, so MANAGE was granted now. */
export type PayerInvite =
  | { status: "invited" | "pending" | "joined" }
  | { status: "funded" }
  | { status: "invalid_email" }
  | { status: "too_many_invites" }
  | { status: "busy" }
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
  /** The ledger lease provisioning uses (database time), so invites and grants for one business run one at a time. */
  claim(leaseId: string): Promise<boolean>;
  release(leaseId: string): Promise<boolean>;
  /** Writes only while the row is still in `whenState`; false when it no longer was (nothing written). */
  update(values: { state?: "funded" | "whatsapp_linked"; funding_state?: "card_attached"; step_keys?: Record<string, string>; last_error?: null }, whenState: string): Promise<boolean>;
  event(values: { step: "funding"; outcome: "started" | "succeeded"; idempotency_key: string; meta_object_id?: string }): Promise<void>;
  /** A keyed hash of the named person's email: binds the MANAGE grant to them without storing the address. */
  payerKey(email: string): string;
  graph: ProvisionGraph;
}

const FUNDED_STATES = ["funded", "whatsapp_linked", "ready"];
const STOPPED_STATES = ["failed", "offboarding", "offboarded"];
const PAYER_ROLE = "EMPLOYEE";
/** Invites go out from a child under the AdBrain BP: refuse a new address while this many are unaccepted, so it can't send spam. */
export const MAX_PENDING_INVITES = 3;
const PAYER_TASKS = ["MANAGE"];
// Same as provisioning: one call can chain 6 Graph requests at 15 s each.
const LEASE_SECONDS = 300;
const email = z.email().max(254);

type Ready = { row: BillingRow; childId: string; adAccountId: string; token: string; keys: Record<string, string> };
type Settled = { status: "funded" | "waiting_setup" | "unavailable" };

/** The child, its ad account and its manager (granted on the ad account) exist; otherwise why not. */
async function setUp(deps: BillingDeps): Promise<Ready | Settled> {
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

/** A ledger write matched no row: the state moved after our read, so report what it is now (never success). */
async function reconcile(deps: BillingDeps): Promise<Settled> {
  const now = await setUp(deps);
  return "status" in now ? now : { status: "unavailable" };
}

/** Runs the work inside the business's ledger lease; a concurrent invite or check gets `busy` and writes nothing. */
async function leased<T>(deps: BillingDeps, work: (ready: Ready) => Promise<T>): Promise<T | Settled | { status: "busy" }> {
  const first = await setUp(deps);
  if ("status" in first) return first;
  const leaseId = randomUUID();
  if (!(await deps.claim(leaseId))) return { status: "busy" };
  try {
    const ready = await setUp(deps);
    return "status" in ready ? ready : await work(ready);
  } finally {
    await deps.release(leaseId).catch(() => false);
  }
}

type Person = { id: string; email?: string; tasks?: string[] };
const personList = z.object({
  data: z.array(z.object({ id: z.string().min(1), email: z.string().optional(), tasks: z.array(z.string()).optional() })),
  paging: z.object({ next: z.string().optional() }).optional(),
});
/** Meta's list, or a throw: a 200 without `data`, or a further page, means membership isn't known, so no write follows (fail closed). */
async function people(deps: BillingDeps, path: string, token: string): Promise<Person[]> {
  const read = personList.safeParse(await deps.graph.get<unknown>(path, token));
  if (!read.success || read.data.paging?.next) throw new Error("Meta returned an incomplete list of people.");
  return read.data.data;
}
const sameEmail = (a: string | undefined, b: string) => a?.trim().toLowerCase() === b;

/** Give the named person MANAGE on the child's ad account (it includes billing), unless they already have it. */
async function grantPayer({ childId, adAccountId, token }: Ready, personId: string, deps: BillingDeps) {
  const assigned = await people(deps, `${adAccountId}/assigned_users?business=${encodeURIComponent(childId)}&fields=id,tasks&limit=100`, token);
  const has = assigned.some((user) => user.id === personId && PAYER_TASKS.every((task) => user.tasks?.includes(task)));
  if (!has) await deps.graph.post(`${adAccountId}/assigned_users`, { user: personId, tasks: JSON.stringify(PAYER_TASKS), business: childId }, token);
}

/**
 * Name the person who adds the card. Already in the child: MANAGE now (`joined`). Invite waiting: `pending`. Otherwise,
 * under the cap, invite them as EMPLOYEE (`invited`); MANAGE follows on 'Check again' once they accept. The named
 * person is recorded (as a keyed hash) before Meta is asked, so only they are ever granted.
 */
export async function invitePayer(input: { email: string }, deps: BillingDeps): Promise<PayerInvite> {
  const parsed = email.safeParse(input.email.trim().toLowerCase());
  if (!parsed.success) return { status: "invalid_email" };
  const address = parsed.data;
  return leased(deps, async (ready): Promise<PayerInvite> => {
    const { childId, token, keys } = ready;
    const member = (await people(deps, `${childId}/business_users?fields=id,email&limit=100`, token)).find((person) => sameEmail(person.email, address));
    const pending = member ? [] : await people(deps, `${childId}/pending_users?fields=id,email&limit=100`, token);
    const waiting = pending.some((person) => sameEmail(person.email, address));
    if (!member && !waiting && pending.length >= MAX_PENDING_INVITES) return { status: "too_many_invites" };
    const payer = deps.payerKey(address);
    if (keys.payer !== payer && !(await deps.update({ step_keys: { ...keys, payer } }, "ad_account_created"))) return reconcile(deps);
    if (member) {
      await grantPayer(ready, member.id, deps);
      return { status: "joined" };
    }
    if (waiting) return { status: "pending" };
    await deps.event({ step: "funding", outcome: "started", idempotency_key: `invite:${deps.businessId}` });
    // A timeout here may still have sent it: the next try reads it back as pending (under the lease), never a second invite.
    await deps.graph.post(`${childId}/business_users`, { email: address, role: PAYER_ROLE }, token);
    return { status: "invited" };
  });
}

/** 'Check again': give the named person MANAGE once they've joined the child, then read the account's funding from Meta. */
export async function checkFunding(deps: BillingDeps): Promise<BillingCheck> {
  return leased(deps, async (ready): Promise<BillingCheck> => {
    const { row, childId, adAccountId, token, keys } = ready;
    let payer: PayerStatus = "none";
    if (keys.payer) {
      const member = (await people(deps, `${childId}/business_users?fields=id,email&limit=100`, token))
        .find((person) => person.email && deps.payerKey(person.email.trim().toLowerCase()) === keys.payer);
      if (member) await grantPayer(ready, member.id, deps);
      payer = member ? "joined" : "invited";
    }

    const verdict = fundingFromMeta(await deps.graph.get<FundingRead>(`${adAccountId}?fields=account_status,funding_source_details`, token));
    if (!verdict.funded) return { status: "not_funded", reason: verdict.reason, payer };

    if (!(await deps.update({ state: "funded", funding_state: "card_attached", last_error: null }, "ad_account_created"))) return reconcile(deps);
    // WhatsApp linked while the account waited for its card (#524): move on as managed-whatsapp does from funded.
    if (row.whatsapp_number_e164) await deps.update({ state: "whatsapp_linked" }, "funded");
    await deps.event({ step: "funding", outcome: "succeeded", idempotency_key: `funding:${deps.businessId}`, meta_object_id: adAccountId });
    return { status: "funded" };
  });
}

/** The ledger's binding of the named person: a keyed hash, so the email itself is never stored. */
export function payerKey(address: string, secret: string): string {
  return createHmac("sha256", secret).update(`managed-payer:${address}`).digest("hex").slice(0, 32);
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
    claim: async (leaseId) => {
      const { data, error } = await admin.rpc("managed_meta_account_claim", { p_business_id: businessId, p_lease_id: leaseId, p_seconds: LEASE_SECONDS });
      if (error) throw new Error("The managed account could not be locked.");
      return data === true;
    },
    release: async (leaseId) => (await admin.rpc("managed_meta_account_release", { p_business_id: businessId, p_lease_id: leaseId })).data === true,
    update: async (values, whenState) => {
      const { data, error } = await table().update(values).eq("business_id", businessId).eq("state", whenState).select("business_id");
      if (error) throw new Error("The managed account could not be updated.");
      return (data ?? []).length > 0;
    },
    event: async (values) => {
      const { error } = await admin.from("managed_meta_account_events").insert({ business_id: businessId, ...values });
      if (error) throw new Error("The funding step could not be logged.");
    },
    payerKey: (address) => payerKey(address, getEnv().META_APP_SECRET),
    graph: graphClient(getEnv().META_APP_SECRET),
  };
}
