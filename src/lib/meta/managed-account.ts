import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MetaCredentials } from "./client";
import type { Capability, ConnectionDTO } from "./connect-contracts";

/**
 * A managed business's child ad account and Page under AdBrain's parent business (2-Tier, #518).
 * Campaign calls run on the parent system user's token (#520) with the child's own ad account and
 * Page; customers with their own OAuth connection never get here (#525). Off unless
 * MANAGED_ACCOUNTS_ENABLED; the ledger is `managed_meta_accounts` (#519).
 */
/** The columns of #519's `managed_meta_accounts` this module relies on (contract-tested against its migration). */
export const MANAGED_LEDGER_COLUMNS = ["business_id", "state", "child_business_id", "ad_account_id", "page_id", "funding_state"] as const;
export const MANAGED_LEDGER_STATES = ["requested", "page_linked", "child_created", "ad_account_created", "funded",
  "whatsapp_linked", "ready", "failed", "offboarding", "offboarded"] as const;
/** A card shared to the child account or a Meta invoice line pays for its spend (#522). */
export const ACTIVATION_FUNDING_STATES = ["card_attached", "invoiced"] as const;

const managedRowSchema = z.object({
  business_id: z.string().min(1),
  state: z.enum(MANAGED_LEDGER_STATES),
  child_business_id: z.string().regex(/^\d+$/).nullable(),
  ad_account_id: z.string().regex(/^act_\d+$/).nullable(),
  page_id: z.string().regex(/^\d+$/).nullable(),
  funding_state: z.string().min(1),
  // The ad account can't change once set (#519's trigger); a Page change is caught by campaign bindings.
  generation: z.number().int().nonnegative().safe().optional().default(1),
});
export type ManagedAccount = z.infer<typeof managedRowSchema>;

export class ManagedAccountError extends Error {
  constructor(message = "The managed Meta account could not be read.") {
    super(message);
    this.name = "ManagedAccountError";
  }
}

/** Read like env.ts's MANAGED_ACCOUNTS_ENABLED, without validating the whole environment for callers that never use it. */
export function managedAccountsEnabled(): boolean {
  const value = process.env.MANAGED_ACCOUNTS_ENABLED;
  return value === "true" || value === "1";
}

/** The business's own managed account, or null when managed accounts are off or it has none. */
export async function getManagedAccount(businessId: string): Promise<ManagedAccount | null> {
  if (!managedAccountsEnabled()) return null;
  // The ledger is new in #519 and not yet in the generated database types.
  const database = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await database
    .from("managed_meta_accounts")
    // "*" so an optional column (generation) never breaks the read for every business.
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new ManagedAccountError();
  if (!data) return null;
  const parsed = managedRowSchema.safeParse(data);
  // Only this business's row is ever used; the ledger keeps ad account and Page ids unique (#519).
  if (!parsed.success || parsed.data.business_id !== businessId) throw new ManagedAccountError();
  return parsed.data;
}

/** Its ad account and Page exist: reads, pause and delete work in any state, so spend can always be stopped. */
export function hasManagedAssets(account: ManagedAccount): account is ManagedAccount & { ad_account_id: string; page_id: string } {
  return Boolean(account.ad_account_id && account.page_id);
}

/** Ready for new campaigns: set up end to end. */
export function isManagedReady(account: ManagedAccount): account is ManagedAccount & { ad_account_id: string; page_id: string } {
  return account.state === "ready" && hasManagedAssets(account);
}

export function isManagedFunded(account: ManagedAccount): boolean {
  return (ACTIVATION_FUNDING_STATES as readonly string[]).includes(account.funding_state);
}

const available: Capability = { state: "available", blockers: [] };
const blocked = (message: string): Capability => ({ state: "blocked", blockers: [{ code: "UNAVAILABLE", message, action: null }] });

/** The connection the rest of the app sees for a managed business. */
export function managedConnection(businessId: string, account: ManagedAccount): ConnectionDTO {
  const ready = isManagedReady(account);
  const assets = hasManagedAssets(account);
  const setup = blocked("Your AdBrain-managed Meta account is still being set up.");
  return {
    businessId,
    generation: account.generation,
    authorization: "connected",
    selected: assets ? {
      metaBusinessId: account.child_business_id,
      adAccountId: account.ad_account_id!,
      accountName: "AdBrain-managed ad account",
      pageId: account.page_id!,
      pageName: "Your Facebook Page",
      currency: "INR",
      timezoneName: "Asia/Kolkata",
    } : null,
    capabilities: {
      canReadInsights: assets ? available : setup,
      canReadLeads: assets ? available : setup,
      canCreatePaused: ready ? available : setup,
      canActivate: !ready ? setup : isManagedFunded(account) ? available
        : blocked("Your managed ad account isn't funded yet, so nothing can run on it."),
    },
    checkedAt: null,
  };
}

/**
 * Credentials for a managed account with an ad account and Page, or null; never another business's
 * or an OAuth token. What each purpose may do is checked by the caller's capabilities.
 */
export function managedCredentials(account: ManagedAccount): MetaCredentials | null {
  const token = getEnv().META_PARENT_SYSTEM_TOKEN;
  if (!hasManagedAssets(account) || !token) return null;
  return { adAccountId: account.ad_account_id, pageId: account.page_id, accessToken: token };
}
