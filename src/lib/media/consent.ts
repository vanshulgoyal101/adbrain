import type { SupabaseClient } from "@supabase/supabase-js";
import { HEALTH_VERTICAL } from "@/lib/creative/slopScan";

/**
 * #784 (#744 phase 1, CPO spec): an owner confirms their rights before their own photos or videos are
 * accepted, once per business and again whenever these words change. The record is append-only
 * (`media_consents`, written only by `media_consent_record`). The legal wording is the CPO's placeholder
 * until the CEO's legal read (#744 d); bump MEDIA_TERMS_VERSION with any change to the text below.
 */
export const MEDIA_TERMS_VERSION = "2026-10-28";

export const MEDIA_RIGHTS_TEXT = "I own these photos and videos, or have permission to use them, including any music and the people shown.";
export const MEDIA_PEOPLE_TEXT = "Everyone recognisable has agreed to appear in your ads.";
/** Shown with a video upload: a note, not a checkbox. */
export const MEDIA_MUSIC_NOTE = "Music from films or popular songs can get your ad muted or rejected. Use your own audio or royalty-free music.";

// Clinics, salons and coaching photograph customers (patients, clients, students), so they also confirm their consent.
const PEOPLE_VERTICAL = new RegExp(`${HEALTH_VERTICAL.source}|salon|beauty|spa|parlou?r|makeup|bridal|hair|skin|nail|coaching|tuition|tutor|academy|institute|school|classes|gym|fitness|yoga`, "i");

export function needsPeopleConsent(vertical: string | null | undefined): boolean {
  return PEOPLE_VERTICAL.test(vertical ?? "");
}

type ConsentRow = { terms_version: string; people_confirmed: boolean };
type Store = Pick<SupabaseClient, "from" | "rpc">;

/**
 * Server gate for an upload or a launch with the owner's own media: true when the business has confirmed
 * the current terms, with the people clause when its vertical needs it. Uses the caller's RLS client.
 */
export async function hasCurrentMediaConsent(database: Store, business: { id: string; vertical?: string | null }): Promise<boolean> {
  const { data, error } = await database.from("media_consents").select("terms_version, people_confirmed")
    .eq("business_id", business.id).eq("terms_version", MEDIA_TERMS_VERSION).order("confirmed_at", { ascending: false }).limit(1);
  if (error) throw new Error("Media consent could not be checked.");
  const latest = (data as ConsentRow[] | null)?.[0];
  return Boolean(latest && (latest.people_confirmed || !needsPeopleConsent(business.vertical)));
}

/** Records the signed-in owner's confirmation of the current terms (refused for another owner's business). */
export async function recordMediaConsent(database: Store, business: { id: string; vertical?: string | null }, confirmed: { rights: boolean; people: boolean }): Promise<void> {
  if (!confirmed.rights) throw new Error("Confirm you own these photos and videos, or have permission to use them.");
  if (needsPeopleConsent(business.vertical) && !confirmed.people) throw new Error("Confirm that everyone recognisable has agreed to appear in your ads.");
  const { error } = await database.rpc("media_consent_record", {
    p_business_id: business.id, p_terms_version: MEDIA_TERMS_VERSION, p_people_confirmed: confirmed.people,
  });
  if (error) throw new Error("Your confirmation couldn't be saved. Try again.");
}
