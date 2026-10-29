import { isExemptFromFreeProviders, isInternalUser, isSmokeUser } from "@/lib/internal-accounts";
import { currentVerifiedActor, eventContext } from "@/lib/observability/context";

/**
 * Internal (team, owner, test) accounts make their ad images on free Pollinations, so the paid
 * OpenRouter key is spent on customers' images (#449). Their text stays on the normal models: Haiku
 * is about $0.006 a Create and the free text tiers are too small (#466). The user ids in
 * `exemptFromFreeProviders` keep the paid path; requests without a signed-in user are paid.
 */
// #1717: requests whose business is over its monthly AI cost cap get free pictures (per request, not per instance).
const costCappedRequests = new WeakSet<object>();

export function markCostCapped(): void {
  const context = eventContext.getStore();
  if (context) costCappedRequests.add(context);
}

export function costCapped(): boolean {
  const context = eventContext.getStore();
  return Boolean(context && costCappedRequests.has(context));
}

export function freeImagesOnly(): boolean {
  const actor = currentVerifiedActor();
  return isInternalUser(actor) && !isExemptFromFreeProviders(actor);
}

/** Text providers on free tiers: the fallback when a paid key is out of credit (#449), and all the smoke login may use. */
export const FREE_TEXT_PROVIDERS: readonly string[] = ["google", "groq"];

/**
 * #2230: the production smoke login writes on free text models only, so its scheduled Prepare spends $0. When they
 * can't answer, the call fails with FREE_TEXT_UNAVAILABLE rather than paying. Customers and the team are unchanged.
 */
export function freeTextOnly(): boolean {
  return isSmokeUser(currentVerifiedActor());
}
