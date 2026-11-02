import { bannedClaimsForVertical, foldClaimText, HEALTH_VERTICAL, MEDICAL_BANNED_CLAIMS, scanAdCopy } from "@/lib/creative/slopScan";

export type AdPolicyHit = { creativeId: string; headline: string | null; term: string };

type Copy = { id: string; headline: string | null; primaryText?: string | null; description?: string | null };

/**
 * #739: the industry's banned claims (`bannedClaimsForVertical`) in text Meta reviews, by Create's own rule. Whole
 * words only: banned-claim scanning matches substrings ("cure" in "secure"), Review blocks the word or its plural.
 */
export function bannedTermsIn(text: string, vertical: string | null | undefined): string[] {
  const normalized = text.normalize("NFC");
  const folded = foldClaimText(normalized);
  const bannedClaims = bannedClaimsForVertical(vertical);
  const listed = new Set(bannedClaims.map(foldClaimText));
  const whole = (term: string, plural: boolean) => new RegExp(`(?<![\\p{L}\\p{M}])${escape(term)}${plural ? "s" : ""}(?![\\p{L}\\p{M}])`, "u").test(folded);
  return scanAdCopy(normalized, { bannedClaims })
    .filter((finding) => {
      if (finding.rule !== "banned-claim") return false;
      const term = foldClaimText(finding.detail);
      // A listed plural ("cures") names itself, so "cure" doesn't also claim "Cures".
      return whole(term, false) || (!listed.has(`${term}s`) && whole(term, true));
    })
    .map((finding) => finding.detail);
}

/** #739: banned claims in each ad's saved wording. */
export function adPolicyHits(creatives: Copy[], vertical: string | null | undefined): AdPolicyHit[] {
  return creatives.flatMap((creative) => bannedTermsIn([creative.headline, creative.primaryText, creative.description].filter(Boolean).join("\n"), vertical)
    .map((term) => ({ creativeId: creative.id, headline: creative.headline, term })));
}

/** How Review names a banned term: a health claim for a clinic, otherwise a promise (#1609, #2423). */
export function bannedTermKind(term: string, vertical: string | null | undefined): string {
  return HEALTH_VERTICAL.test(vertical ?? "") && (MEDICAL_BANNED_CLAIMS as readonly string[]).includes(term) ? "a health promise" : "a promise";
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
