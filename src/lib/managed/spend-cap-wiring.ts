import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MetaClient } from "@/lib/meta/client";
import { getManagedAccount, hasManagedAssets, managedAccountsEnabled, managedCredentials, type ManagedAccount } from "@/lib/meta/managed-account";
import { confirmCustomerCampaign, getCustomerBalance } from "@/lib/payments/customer-balance";
import { recordProductEvent } from "@/lib/observability/logger";
import type { Json } from "@/lib/types";
import { supabaseSpendCapStore, type SpendCapStore } from "./spend-cap-store";
import { syncChildSpendCap, type SpendCapMeta, type SpendCapSyncResult } from "./spend-cap-sync";

/**
 * #522 wiring: the managed child ad account's Meta spending limit follows the customer's balance on
 * every payment, refund or dispute (`scheduleManagedSpendCapSync` from the payment service), on the
 * 15-minute spend sweep, and before any activation. Behind `MANAGED_ACCOUNTS_ENABLED`.
 */

type Actor = { businessId: string; userId: string };
type ManagedAsset = ManagedAccount & { ad_account_id: string; page_id: string };
const MAX_CAMPAIGN_PAGES = 50;

export type ManagedSpendCapResult = SpendCapSyncResult | { status: "disabled" | "unmanaged" };

/** Pauses every ACTIVE campaign on the child ad account, trying all before failing closed. */
export async function pauseActiveCampaigns(meta: Pick<MetaClient, "listCampaignsPage" | "updateCampaignStatus">): Promise<string[]> {
  const paused: string[] = [];
  let failure: unknown = null;
  let after: string | undefined;
  for (let page = 0; page < MAX_CAMPAIGN_PAGES; page += 1) {
    const listed = await meta.listCampaignsPage(after);
    for (const campaign of listed.campaigns.filter((item) => item.status === "ACTIVE")) {
      try {
        await meta.updateCampaignStatus(campaign.id, "PAUSED");
        paused.push(campaign.id);
      } catch (error) { failure ??= error; }
    }
    if (!listed.nextCursor) {
      if (failure) throw failure;
      return paused;
    }
    after = listed.nextCursor;
  }
  throw new Error("Too many campaigns to stop on the managed ad account.");
}

/** AdBrain's side of "stop": every active campaign on the child account is paused, its reserve confirmed paused. */
async function recordStopped(actor: Actor, adAccountId: string, reason: "held" | "no_allowance") {
  const admin = createAdminClient();
  const { data: campaigns, error } = await admin.from("campaigns").select("id, meta_campaign_id")
    .eq("business_id", actor.businessId).eq("meta_ad_account_id", adAccountId).eq("status", "active");
  if (error) throw new Error("Managed campaigns could not be loaded.");
  if (!campaigns.length) return;
  const balance = await getCustomerBalance(actor).catch(() => null);
  for (const campaign of campaigns) {
    const { error: updateError } = await admin.from("campaigns").update({ status: "paused" }).eq("id", campaign.id).eq("status", "active");
    if (updateError) throw new Error("A managed campaign could not be marked paused.");
    const reservation = balance?.reservations.find((item) => item.campaignId === campaign.id && item.state !== "closed");
    if (reservation) await confirmCustomerCampaign(actor, campaign.id, reservation.reservationId, "paused");
    await admin.rpc("append_verified_audit_event", {
      p_business_id: actor.businessId, p_actor_id: null, p_system_actor: "worker", p_action: "spend.auto_paused",
      p_entity_type: "campaign", p_entity_id: campaign.id, p_meta_object_id: campaign.meta_campaign_id,
      p_reason: reason === "held"
        ? "Customer advertising funds require reconciliation (managed ad account stopped)"
        : "No advertising allowance left (managed ad account stopped)",
      p_details: {} as Json,
    });
  }
}

export async function syncManagedSpendCap(actor: Actor, store: SpendCapStore = supabaseSpendCapStore()): Promise<ManagedSpendCapResult> {
  if (!managedAccountsEnabled()) return { status: "disabled" };
  const account = await getManagedAccount(actor.businessId);
  if (!account || !hasManagedAssets(account)) return { status: "unmanaged" };
  const credentials = managedCredentials(account);
  if (!credentials) throw new Error("Managed Meta credentials are unavailable.");
  const client = new MetaClient(credentials);
  const meta: SpendCapMeta = {
    readAccountFunding: () => client.readAccountFunding(),
    setAccountSpendCap: (capPaise, maxRoomPaise) => client.setAccountSpendCap(capPaise, maxRoomPaise),
    pauseActiveCampaigns: () => pauseActiveCampaigns(client),
  };
  const result = await syncChildSpendCap({ businessId: actor.businessId, adAccountId: account.ad_account_id }, {
    store, meta,
    balance: async () => {
      const balance = await getCustomerBalance(actor);
      return { advertisingAllocationPaise: balance.advertisingAllocationPaise, advertisingRefundedPaise: balance.advertisingRefundedPaise, held: balance.held };
    },
    onStopped: (reason) => recordStopped(actor, account.ad_account_id, reason),
  });
  recordProductEvent({ kind: "workflow", name: "managed.spend_cap", businessId: actor.businessId,
    outcome: result.status === "applied" ? "success" : "partial",
    attributes: result.status === "applied"
      ? { errorCode: `SPEND_CAP_${result.decision.action.toUpperCase()}`, count: result.passes }
      : { errorCode: `SPEND_CAP_${result.status.toUpperCase()}` } });
  return result;
}

/** After a payment, refund or dispute changed the balance: refresh the limit once the response is sent. */
export function scheduleManagedSpendCapSync(actor: Actor): void {
  if (!managedAccountsEnabled()) return;
  try {
    after(async () => {
      try { await syncManagedSpendCap(actor); }
      catch { console.warn(JSON.stringify({ source: "adbrain.managed", code: "SPEND_CAP_SYNC_FAILED", businessId: actor.businessId })); }
    });
  } catch {
    console.warn(JSON.stringify({ source: "adbrain.managed", code: "SPEND_CAP_SCHEDULE_FAILED", businessId: actor.businessId }));
  }
}

export type ManagedActivationGate = "allowed" | "no_room" | "updating";

/**
 * New delivery on a managed child account needs a current limit with room: the last decision was
 * set or keep with room left, and no payment, refund or hold has arrived since (#522, QA #527 T4).
 */
export async function managedSpendCapGate(actor: Actor, account: ManagedAsset, store: SpendCapStore = supabaseSpendCapStore()): Promise<ManagedActivationGate> {
  let state = await store.state(actor.businessId, account.ad_account_id);
  if (state.dirty || !state.action) {
    await syncManagedSpendCap(actor, store);
    state = await store.state(actor.businessId, account.ad_account_id);
  }
  if (state.dirty || !state.action) return "updating";
  return (state.action === "set" || state.action === "keep") && (state.roomPaise ?? 0) > 0 ? "allowed" : "no_room";
}

/** Managed businesses with a child ad account whose limit the sweep refreshes. */
export async function listManagedSpendCapBusinesses(): Promise<string[]> {
  const { data, error } = await createAdminClient().from("managed_meta_accounts").select("business_id")
    .not("ad_account_id", "is", null).neq("state", "offboarded").order("business_id").limit(500);
  if (error || !data) throw new Error("Managed accounts could not be listed.");
  return data.map((row) => row.business_id);
}
