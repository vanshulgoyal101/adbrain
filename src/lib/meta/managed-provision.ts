/**
 * #521 (2-Tier, #518): provision a managed customer under the AdBrain BP (#2357), walking #519's ledger:
 * page_linked → child business → INR ad account. Each step looks up before it creates (Meta's
 * `child_business_external_id`, and a deterministic ad account name), so a lost response is found
 * on the next run and nothing is created twice. Failures leave the row `failed` with a code.
 *
 * Tokens per step (#521 design note): the child business is created with the customer's token,
 * because Meta requires the caller to administer `shared_page_id` (error 1690138); the ad account
 * with the parent system user's. Then (CTO decision 1, Meta's setup-cbm) the child's own system
 * user is minted with the parent token, its token stored encrypted (never in the ledger), and that
 * user is assigned to the ad account with its own token, so one customer's token can't reach
 * another's account.
 */

export interface ProvisionGraph {
  get<T>(path: string, token: string): Promise<T>;
  post<T>(path: string, form: Record<string, string>, token: string): Promise<T>;
}

type Row = {
  business_id: string; state: string; page_id: string | null; child_business_id: string | null; ad_account_id: string | null; step_keys: unknown;
  manager_user_id?: string | null; manager_token_id?: string | null;
};

/** The child system user's token goes to the encrypted token store; the ledger keeps only its id. */
export interface ManagerTokens {
  appId: string;
  save(token: string, systemUserId: string): Promise<string>;
  load(tokenId: string): Promise<string | null>;
  /** Best effort: delete a token row the ledger no longer references. */
  remove(tokenId: string): Promise<void>;
}

export interface ProvisionStore {
  get(businessId: string): Promise<Row | null>;
  update(values: Partial<Pick<Row, "state" | "child_business_id" | "ad_account_id" | "manager_user_id" | "manager_token_id">> & { step_keys?: Record<string, string>; last_error?: string | null }): Promise<void>;
  event(values: { business_id: string; step: "child_business" | "ad_account"; outcome: "started" | "succeeded" | "failed"; request_id?: string; idempotency_key?: string; meta_object_id?: string; error_code?: string }): Promise<void>;
}

export type ProvisionResult =
  | { ok: true; state: string; childBusinessId: string; adAccountId: string }
  | { ok: false; code: string; retryable: boolean };

import { segmentForCategory } from "@/lib/segments";

const INDIA_TIMEZONE_ID = "71";

/** A value of Meta's Business `vertical` enum (Graph reference, user/businesses), which owned_businesses requires (#2358). */
export type MetaVertical = "ENERGY_AND_UTILITIES" | "EDUCATION" | "PROFESSIONAL_SERVICES" | "OTHER";
const SEGMENT_VERTICALS: Record<string, MetaVertical> = { solar: "ENERGY_AND_UTILITIES", ielts: "EDUCATION", interiors: "PROFESSIONAL_SERVICES" };

/** The Brand's free-text category as Meta's vertical: the pilot segments, else OTHER. */
export function metaVertical(category: string | null | undefined): MetaVertical {
  return SEGMENT_VERTICALS[segmentForCategory(category)?.slug ?? ""] ?? "OTHER";
}
const MAX_CHILD_PAGES = 50;

/** A lookup that can't prove the child doesn't exist: stop rather than risk a second one (QA #527 T3). */
class LookupError extends Error {
  constructor(readonly code: "CHILD_LOOKUP_UNVERIFIED" | "CHILD_LOOKUP_INCOMPLETE" | "AD_ACCOUNT_AMBIGUOUS" | "MANAGER_TOKEN_MISSING") { super(code); }
}

type ChildPage = { data?: { id: string; child_business_external_id?: string }[]; paging?: { next?: string; cursors?: { after?: string } } };

/** Every child of the parent (all pages); fails closed if any child doesn't say whose it is. */
async function findChild(graph: ProvisionGraph, parentBusinessId: string, businessId: string, token: string): Promise<string | null> {
  const base = `${parentBusinessId}/owned_businesses?fields=id,child_business_external_id&limit=200`;
  let path: string | null = base;
  for (let page = 0; path; page++) {
    if (page >= MAX_CHILD_PAGES) throw new LookupError("CHILD_LOOKUP_INCOMPLETE");
    const answer: ChildPage = await graph.get<ChildPage>(path, token);
    for (const child of answer.data ?? []) {
      if (!child.child_business_external_id) throw new LookupError("CHILD_LOOKUP_UNVERIFIED");
      if (child.child_business_external_id === businessId) return child.id;
    }
    const after = answer.paging?.next ? answer.paging.cursors?.after : undefined;
    path = after ? `${base}&after=${encodeURIComponent(after)}` : null;
  }
  return null;
}
const MANAGER_TASKS = ["MANAGE", "ADVERTISE", "ANALYZE"];
/** #624: campaigns run on the child token, so it needs the Page and lead reads too (Meta OBO guide, step 2). */
export const MANAGER_SCOPE = "ads_management,business_management,pages_read_engagement,pages_manage_ads,pages_show_list,leads_retrieval";
const SETUP_STATES = ["page_linked", "child_created", "ad_account_created", "failed"];
const REPAIRABLE_STATES = ["funded", "whatsapp_linked", "ready"];
/** The tasks the customer shared with the child business (child creation's page_permitted_tasks). */
const PAGE_TASKS = ["ADVERTISE", "ANALYZE", "MESSAGING"];

/** Meta failures → stable codes the owner screen explains (#518 research, external-api-error-contracts). */
export function provisionErrorCode(error: unknown): { code: string; retryable: boolean } {
  const value = (error ?? {}) as { name?: string; status?: number; code?: number; subcode?: number };
  if (error instanceof LookupError) return { code: error.code, retryable: false };
  if (value.name === "TimeoutError" || value.name === "AbortError") return { code: "META_TIMEOUT", retryable: true };
  if (value.subcode === 1690138) return { code: "PAGE_ADMIN_REQUIRED", retryable: false };
  if (value.subcode === 2859040) return { code: "PAGE_OWNER_DISALLOWED", retryable: false };
  if (value.code === 3918 || value.subcode === 3918) return { code: "PAGE_IN_OTHER_BUSINESS", retryable: false };
  if (value.code !== undefined && [4, 17, 32, 613, 80004].includes(value.code)) return { code: "META_BUSY", retryable: true };
  if (value.code !== undefined && [3, 10, 190, 200].includes(value.code)) return { code: "NOT_PERMITTED", retryable: false };
  if (typeof value.status === "number" && value.status >= 500) return { code: "META_BUSY", retryable: true };
  if (value.code !== undefined) return { code: `META_${value.code}${value.subcode ? `_${value.subcode}` : ""}`, retryable: false };
  return { code: "META_NETWORK", retryable: true };
}

export async function provisionManagedAccount(input: {
  businessId: string;
  businessName: string;
  vertical: MetaVertical;
  parentBusinessId: string;
  store: ProvisionStore;
  graph: ProvisionGraph;
  tokens: { customer: string; parent: string };
  manager: ManagerTokens;
  requestId?: string;
}): Promise<ProvisionResult> {
  const { businessId, store, graph, tokens, parentBusinessId, requestId } = input;
  const row = await store.get(businessId);
  // #624 (Reviewer): a set-up account (funded onwards) can be repaired, re-minting its manager token or
  // granting its Page, without moving its state; a failed repair keeps the state and records last_error.
  const repair = Boolean(row && REPAIRABLE_STATES.includes(row.state) && row.child_business_id && row.ad_account_id);
  if (!row?.page_id || !(SETUP_STATES.includes(row.state) || repair)) {
    return { ok: false, code: "PAGE_NOT_LINKED", retryable: false };
  }
  const keys = row.step_keys && typeof row.step_keys === "object" && !Array.isArray(row.step_keys) ? { ...(row.step_keys as Record<string, string>) } : {};
  let childId = row.child_business_id;
  let adAccountId = row.ad_account_id;
  let step: "child_business" | "ad_account" = "child_business";
  let state = row.state;

  try {
    if (!childId) {
      const key = `child:${businessId}`;
      await store.event({ business_id: businessId, step, outcome: "started", request_id: requestId, idempotency_key: key });
      childId = await findChild(graph, parentBusinessId, businessId, tokens.parent);
      if (!childId) {
        const created = await graph.post<{ id: string }>(`${parentBusinessId}/owned_businesses`, {
          name: input.businessName.trim().slice(0, 100),
          vertical: input.vertical,
          shared_page_id: row.page_id,
          page_permitted_tasks: JSON.stringify(PAGE_TASKS),
          timezone_id: INDIA_TIMEZONE_ID,
          child_business_external_id: businessId,
        }, tokens.customer);
        childId = created.id;
      }
      keys.child_business = key;
      await store.update({ state: "child_created", child_business_id: childId, step_keys: keys, last_error: null });
      state = "child_created";
      await store.event({ business_id: businessId, step, outcome: "succeeded", request_id: requestId, idempotency_key: key, meta_object_id: childId });
    }

    if (!adAccountId) {
      step = "ad_account";
      const key = `account:${businessId}`;
      const name = `AdBrain ${businessId.slice(0, 8)} ${input.businessName.trim()}`.slice(0, 100);
      await store.event({ business_id: businessId, step, outcome: "started", request_id: requestId, idempotency_key: key });
      // A child belongs to one customer: its only ad account is ours (even after a rename); several is unexpected.
      const existing = await graph.get<{ data?: { id: string; name?: string }[] }>(`${childId}/owned_ad_accounts?fields=id,name&limit=100`, tokens.parent);
      const owned = existing.data ?? [];
      if (owned.length > 1) throw new LookupError("AD_ACCOUNT_AMBIGUOUS");
      adAccountId = owned[0]?.id ?? null;
      if (!adAccountId) {
        const created = await graph.post<{ id: string }>(`${childId}/adaccount`, {
          name, currency: "INR", timezone_id: INDIA_TIMEZONE_ID, end_advertiser: row.page_id, media_agency: "NONE", partner: "NONE",
        }, tokens.parent);
        adAccountId = created.id;
      }
      adAccountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
      keys.ad_account = key;
      await store.update({ state: "ad_account_created", ad_account_id: adAccountId, step_keys: keys, last_error: null });
      state = "ad_account_created";
      await store.event({ business_id: businessId, step, outcome: "succeeded", request_id: requestId, idempotency_key: key, meta_object_id: adAccountId });
    }

    // The child's own system user: reuse the stored one, mint (with the parent token) only if absent or its token is gone.
    let managerUserId = row.manager_user_id ?? null;
    let managerToken = row.manager_token_id && managerUserId ? await input.manager.load(row.manager_token_id) : null;
    // A token minted before the scope grew (#624) can't read the Page: mint again.
    if (!managerToken || !managerUserId || keys.manager_scope !== MANAGER_SCOPE) {
      step = "ad_account";
      const key = `manager:${businessId}`;
      const minted = await graph.post<{ access_token?: string }>(`${childId}/access_token`, {
        id: childId, app_id: input.manager.appId, scope: MANAGER_SCOPE,
      }, tokens.parent);
      if (!minted.access_token) throw new LookupError("MANAGER_TOKEN_MISSING");
      // Meta's guide reads the system user from /me with the child token.
      const me = await graph.get<{ id?: string }>("me?fields=id", minted.access_token);
      if (!me.id) throw new LookupError("MANAGER_TOKEN_MISSING");
      managerUserId = me.id;
      managerToken = minted.access_token;
      const tokenId = await input.manager.save(managerToken, managerUserId);
      keys.manager = key;
      keys.manager_scope = MANAGER_SCOPE;
      try {
        await store.update({ manager_user_id: managerUserId, manager_token_id: tokenId, step_keys: keys, last_error: null });
      } catch (error) {
        await input.manager.remove(tokenId).catch(() => undefined);
        throw error;
      }
      // The replaced token (revoked, expired or unreadable) is no longer referenced.
      if (row.manager_token_id && row.manager_token_id !== tokenId) await input.manager.remove(row.manager_token_id).catch(() => undefined);
      await store.event({ business_id: businessId, step, outcome: "succeeded", request_id: requestId, idempotency_key: key, meta_object_id: managerUserId });
    }

    if (!keys.grant) {
      step = "ad_account";
      const key = `grant:${businessId}`;
      const assigned = await graph.get<{ data?: { id: string; tasks?: string[] }[] }>(
        `${adAccountId}/assigned_users?business=${encodeURIComponent(childId)}&fields=id,tasks`, managerToken);
      const granted = assigned.data?.some((user) => user.id === managerUserId && MANAGER_TASKS.every((task) => user.tasks?.includes(task)));
      if (!granted) {
        await graph.post(`${adAccountId}/assigned_users`, { user: managerUserId, tasks: JSON.stringify(MANAGER_TASKS), business: childId }, managerToken);
      }
      keys.grant = key;
      await store.update({ ...(repair ? {} : { state: "ad_account_created" as const }), step_keys: keys, last_error: null });
      if (!repair) state = "ad_account_created";
      await store.event({ business_id: businessId, step, outcome: "succeeded", request_id: requestId, idempotency_key: key, meta_object_id: adAccountId });
    }

    // #624: the child token runs the campaigns, so its system user needs the shared Page (Meta OBO guide, step 4).
    if (!keys.page_grant) {
      step = "ad_account";
      const key = `page:${businessId}`;
      const pageId = row.page_id!;
      const assigned = await graph.get<{ data?: { id: string; tasks?: string[] }[] }>(
        `${pageId}/assigned_users?business=${encodeURIComponent(childId)}&fields=id,tasks`, managerToken);
      const granted = assigned.data?.some((user) => user.id === managerUserId && PAGE_TASKS.every((task) => user.tasks?.includes(task)));
      if (!granted) {
        await graph.post(`${pageId}/assigned_users`, { user: managerUserId, tasks: JSON.stringify(PAGE_TASKS), business: childId }, managerToken);
      }
      keys.page_grant = key;
      await store.update({ step_keys: keys, last_error: null });
      await store.event({ business_id: businessId, step, outcome: "succeeded", request_id: requestId, idempotency_key: key, meta_object_id: pageId });
    }
    // Only set-up runs reach "failed" (a repair keeps its state), so a failed row whose remaining step was
    // the Page grant resumes to ad_account_created here, as the earlier steps do.
    if (!repair && state === "failed") await store.update({ state: "ad_account_created", last_error: null });
    return { ok: true, state: repair ? row.state : "ad_account_created", childBusinessId: childId, adAccountId };
  } catch (error) {
    const failure = provisionErrorCode(error);
    await store.update({ ...(repair ? {} : { state: "failed" as const }), last_error: failure.code });
    await store.event({ business_id: businessId, step, outcome: "failed", request_id: requestId, error_code: failure.code });
    return { ok: false, ...failure };
  }
}
