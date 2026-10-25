import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { MetaClient } from "./client";
import { maskWhatsAppNumber } from "./whatsapp-status-shared";
import { getManagedAccount, managedCredentials } from "./managed-account";

export type ManagedWhatsAppCheck =
  | { status: "linked"; masked: string }
  | { status: "not_linked" }
  | { status: "waiting_setup" }
  | { status: "taken" }
  | { status: "unavailable" };

const STOPPED_STATES = ["failed", "offboarding", "offboarded"];

/**
 * #524 v1 (Page-linked WhatsApp): read the number the customer linked to their own Page (Meta
 * verified it with their OTP), record it on their ledger row and bind it (`page_link`, #253).
 * The Page is read with the parent token, so it needs the child business and ad account (#525).
 */
export async function checkManagedWhatsApp(businessId: string): Promise<ManagedWhatsAppCheck> {
  const account = await getManagedAccount(businessId);
  if (account && STOPPED_STATES.includes(account.state)) return { status: "unavailable" };
  const credentials = account ? managedCredentials(account) : null;
  if (!account || !credentials) return { status: "waiting_setup" };
  const number = await new MetaClient(credentials).getWhatsAppNumber(null);
  if (!number) return { status: "not_linked" };

  // The ledger is new in #519 and not yet in the generated database types.
  const database = createAdminClient() as unknown as SupabaseClient;
  const current = await database.from("managed_meta_accounts").select("whatsapp_number_e164").eq("business_id", businessId).maybeSingle();
  if (current.error) throw new Error("The WhatsApp number could not be read.");
  const previous = (current.data as { whatsapp_number_e164?: string | null } | null)?.whatsapp_number_e164 ?? null;
  const { error } = await database.from("managed_meta_accounts")
    .update({ whatsapp_number_e164: number, ...(account.state === "funded" ? { state: "whatsapp_linked" } : {}) })
    .eq("business_id", businessId);
  // One active customer per number (unique index): another customer's Page already uses it.
  if (error?.code === "23505") return { status: "taken" };
  if (error) throw new Error("The WhatsApp number could not be recorded.");
  const bound = await database.from("whatsapp_number_bindings")
    .upsert({ business_id: businessId, phone_e164: number, source: "page_link" }, { onConflict: "business_id,phone_e164", ignoreDuplicates: true });
  if (bound.error) throw new Error("The WhatsApp number could not be bound.");
  // A re-linked Page: the old number is no longer this customer's, and the ledger's unique index has
  // freed it for others, so its page_link binding must go too (QA and Reviewer on #585).
  const stale = await database.from("whatsapp_number_bindings")
    .delete().eq("business_id", businessId).eq("source", "page_link").neq("phone_e164", number);
  if (stale.error) throw new Error("The previous WhatsApp number could not be unbound.");
  if (previous !== number) {
    const event = await database.from("managed_meta_account_events")
      .insert({ business_id: businessId, step: "whatsapp", outcome: "succeeded", meta_object_id: credentials.pageId });
    if (event.error) throw new Error("The WhatsApp step could not be logged.");
  }
  return { status: "linked", masked: maskWhatsAppNumber(number) };
}
