import { bannedTermKind, bannedTermsIn } from "@/lib/campaign/ad-policy";
import { copyClaimWarnings, type EditableCopy } from "@/lib/creative/concept";
import { policyFindings } from "@/lib/creative/policy-rules";

const COPY_FIELDS = ["headline", "primary_text", "description"] as const;
type CopyField = (typeof COPY_FIELDS)[number];
const COPY_LABELS: Record<CopyField, string> = { headline: "Headline", primary_text: "Main text", description: "Description" };

export class OwnWordsCopyError extends Error {
  readonly code = "OWN_WORDS_COPY_REJECTED";
  constructor(readonly index: number, readonly field: CopyField, message: string) {
    super(`Ad ${index + 1}, ${COPY_LABELS[field]}: ${message}`);
  }
}

export function ownWordsCopyError(
  items: readonly Pick<EditableCopy, CopyField>[],
  facts: (string | null | undefined)[],
  vertical: string | null | undefined,
): OwnWordsCopyError | null {
  const sources = facts.filter((fact): fact is string => typeof fact === "string" && fact.trim() !== "");
  for (const [index, item] of items.entries()) {
    for (const field of COPY_FIELDS) {
      const text = item[field];
      if (!text) continue;
      const term = bannedTermsIn(text, vertical)[0];
      if (term) return new OwnWordsCopyError(index, field, `"${term}" is ${bannedTermKind(term, vertical)} Meta rejects. Reword it.`);
      const policy = policyFindings(text, { vertical, facts: sources })[0];
      if (policy) return new OwnWordsCopyError(index, field, `"${policy.detail}": Meta often rejects this. ${policy.fix[0].toUpperCase()}${policy.fix.slice(1)}.`);
      // Review's whole-word banned-claim rule above replaces Studio's older substring warning here.
      const claim = copyClaimWarnings({ headline: text, primary_text: "", description: "" }, facts, null, { ownPicture: true })[0];
      if (claim) return new OwnWordsCopyError(index, field, claim);
    }
  }
  return null;
}
