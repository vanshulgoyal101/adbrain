import { copyClaimWarnings } from "@/lib/creative/concept";

export type OwnerWrittenCreativeCopy = {
  ownWords?: boolean;
  headline: string | null;
  primaryText?: string | null;
  description?: string | null;
};

type OwnWordsContext = { brandFacts: string[]; vertical: string | null };

export function ownerWrittenCopyWarning(input: {
  creatives: readonly OwnerWrittenCreativeCopy[];
  ownWordsContext?: OwnWordsContext;
  brandFacts?: string[];
  vertical?: string | null;
}): string | undefined {
  const creatives = input.creatives.filter((creative) => creative.ownWords);
  if (!creatives.length) return undefined;

  const context = input.ownWordsContext
    ?? (input.brandFacts !== undefined && input.vertical !== undefined
      ? { brandFacts: input.brandFacts, vertical: input.vertical }
      : undefined);
  if (!context) throw new Error("Current Brand facts could not be checked for owner-written ads.");

  return creatives.flatMap((creative) => copyClaimWarnings({
    headline: creative.headline ?? "",
    primary_text: creative.primaryText ?? "",
    description: creative.description ?? "",
  }, context.brandFacts, context.vertical, { ownPicture: true }))[0];
}
