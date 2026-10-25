import { createAdminClient } from "@/lib/supabase/admin";
import type { MetaClient } from "./client";

/**
 * #253: the WhatsApp numbers bound to one AdBrain business (`whatsapp_number_bindings`). A
 * number other than the Page's own must be one of these before an ad may send chats to it.
 */
export async function boundWhatsAppNumbers(businessId: string): Promise<string[]> {
  const { data, error } = await createAdminClient().from("whatsapp_number_bindings").select("phone_e164").eq("business_id", businessId);
  if (error) throw new Error("WhatsApp number bindings could not be read.");
  return (data ?? []).map((row) => row.phone_e164);
}

async function isManagedBusiness(businessId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from("managed_meta_accounts").select("business_id").eq("business_id", businessId).maybeSingle();
  if (error) throw new Error("Managed account state could not be read.");
  return data !== null;
}

/**
 * The verified number for this business's draft. The Page's own number and already-bound numbers
 * pass. Otherwise, for a business on its **own** Meta connection, the owner's chosen number from
 * their ad account's business is bound on first use (`owner_pick`). A managed (2-Tier) business
 * never binds by pick: its parent's WABAs hold other customers' numbers, so only a number Meta
 * verified for it (Page link or Embedded Signup) can be bound.
 */
export async function whatsappNumberForBusiness(businessId: string, meta: MetaClient, requested: string | null): Promise<string | null> {
  const bound = await boundWhatsAppNumbers(businessId);
  const number = await meta.getWhatsAppNumber(requested, bound);
  if (number || !requested || await isManagedBusiness(businessId)) return number;
  const { business } = await meta.whatsappNumbers();
  const picked = await meta.getWhatsAppNumber(requested, business);
  if (!picked || !business.includes(picked)) return picked;
  const { error } = await createAdminClient().from("whatsapp_number_bindings")
    .upsert({ business_id: businessId, phone_e164: picked, source: "owner_pick" }, { onConflict: "business_id,phone_e164", ignoreDuplicates: true });
  if (error) throw new Error("The WhatsApp number could not be bound.");
  return picked;
}
