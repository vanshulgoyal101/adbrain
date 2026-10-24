import { isExemptFromFreeProviders, isInternalUser } from "@/lib/internal-accounts";
import { currentVerifiedActor } from "@/lib/observability/context";

/** Providers billed to the shared paid key. */
export const PAID_PROVIDERS = new Set(["openrouter"]);

/**
 * Internal (team, owner, test) accounts use only free providers, so the paid OpenRouter key is
 * spent on customers alone (#449), except the listed `exemptFromFreeProviders` (#466). Requests
 * without a signed-in user (cron, workers) are paid.
 */
export function freeProvidersOnly(): boolean {
  const actor = currentVerifiedActor();
  return isInternalUser(actor) && !isExemptFromFreeProviders(actor);
}
