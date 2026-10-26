import type { PrivacyRequest } from "@/lib/privacy-requests";

/** #730: who a queued request is for; a Facebook-initiated one carries its confirmation code. */
export function privacyRequestSubject(row: Pick<PrivacyRequest, "owner_id" | "source" | "confirmation_code">): string {
  if (row.source !== "meta_callback") return row.owner_id ?? "Unknown owner";
  return row.owner_id
    ? `${row.owner_id} · from Facebook (code ${row.confirmation_code})`
    : `Facebook request, no matching AdBrain owner (code ${row.confirmation_code})`;
}
