import { isExemptFromFreeProviders, isInternalUser } from "@/lib/internal-accounts";
import { currentVerifiedActor } from "@/lib/observability/context";

/**
 * Internal (team, owner, test) accounts make their ad images on free Pollinations, so the paid
 * OpenRouter key is spent on customers' images (#449). Their text stays on the normal models: Haiku
 * is about $0.006 a Create and the free text tiers are too small (#466). The user ids in
 * `exemptFromFreeProviders` keep the paid path; requests without a signed-in user are paid.
 */
export function freeImagesOnly(): boolean {
  const actor = currentVerifiedActor();
  return isInternalUser(actor) && !isExemptFromFreeProviders(actor);
}
