import { createAdminClient } from "@/lib/supabase/admin";
import type { MetaClient } from "./client";
import { maskedWhatsAppNumberPattern, type WhatsAppNumberSource } from "./whatsapp-status-shared";
import { whatsappChoiceId } from "./whatsapp-choice";

/**
 * #253: the WhatsApp numbers bound to one AdBrain business (`whatsapp_number_bindings`). A
 * business-account number must have an appropriate binding before an ad may send chats to it.
 */
export async function boundWhatsAppNumbers(businessId: string): Promise<string[]> {
  return (await readBindings(businessId)).bound;
}

async function readBindings(businessId: string) {
  const [{ data, error }, managed] = await Promise.all([
    createAdminClient().from("whatsapp_number_bindings").select("phone_e164, source").eq("business_id", businessId),
    isManagedBusiness(businessId),
  ]);
  if (error) throw new Error("WhatsApp number bindings could not be read.");
  const rows = data ?? [];
  // Page-link bindings never authorise a business-account candidate after the Page changes.
  const bound = rows.filter((row) => row.source === "embedded_signup" || (!managed && row.source === "owner_pick"))
    .map((row) => row.phone_e164);
  return { bound, managed, rows };
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
 * verified for it by Embedded Signup can be bound. A Page link is checked against the current Page,
 * not treated as a business-account binding.
 */
export async function whatsappNumberForBusiness(
  businessId: string, meta: MetaClient, requested: string | null, source?: WhatsAppNumberSource, choiceId?: string,
): Promise<{ number: string; source: WhatsAppNumberSource } | null> {
  if (requested && maskedWhatsAppNumberPattern.test(requested) && (!source || !choiceId)) return null;
  if (choiceId && !source) return null;
  const candidate = await meta.resolveWhatsAppNumberCandidate(requested, source);
  if (!candidate) return null;
  const { number, source: candidateSource } = candidate;
  if (source && candidateSource !== source) return null;
  if (choiceId && whatsappChoiceId(businessId, candidateSource, number) !== choiceId) return null;
  const { bound, managed, rows } = await readBindings(businessId);
  if (candidateSource === "page" || bound.includes(number)) return candidate;
  if (!requested || managed || rows.some((row) => row.phone_e164 === number)) return null;
  const { error } = await createAdminClient().from("whatsapp_number_bindings")
    .upsert({ business_id: businessId, phone_e164: number, source: "owner_pick" }, { onConflict: "business_id,phone_e164", ignoreDuplicates: true });
  if (error) throw new Error("The WhatsApp number could not be bound.");
  return candidate;
}
