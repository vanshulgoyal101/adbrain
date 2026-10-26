import { bannedClaimsForVertical, scanAdCopy } from "@/lib/creative/slopScan";

export type AdPolicyHit = { creativeId: string; headline: string | null; term: string };

type Copy = { id: string; headline: string | null; primaryText?: string | null; description?: string | null };

/**
 * #739: health promises in each ad's saved wording, by Create's own banned-claim rule. #738's new
 * rules (personal attributes, superlatives) join here with their own plain-words message.
 */
export function adPolicyHits(creatives: Copy[], vertical: string | null | undefined): AdPolicyHit[] {
  const bannedClaims = bannedClaimsForVertical(vertical);
  return creatives.flatMap((creative) => {
    const text = [creative.headline, creative.primaryText, creative.description].filter(Boolean).join("\n").normalize("NFC");
    const lower = text.toLowerCase();
    return scanAdCopy(text, { bannedClaims })
      // banned-claim matches substrings ("cure" in "secure"); Review only blocks the whole word.
      .filter((finding) => finding.rule === "banned-claim" && new RegExp(`(?<![\\p{L}\\p{M}])${escape(finding.detail.toLowerCase())}(?![\\p{L}\\p{M}])`, "u").test(lower))
      .map((finding) => ({ creativeId: creative.id, headline: creative.headline, term: finding.detail }));
  });
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
