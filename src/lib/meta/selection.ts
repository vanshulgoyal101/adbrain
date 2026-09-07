import type { MetaAdAccountOption, MetaPageOption } from "./oauth";
import type { Blocker, CandidateDTO } from "./connect-contracts";

export type DiscoveryPair = {
  pairId: string;
  adAccount: MetaAdAccountOption;
  page: MetaPageOption;
  relationshipVerified: boolean;
  currencySupported: boolean;
};

export type SelectionDecision =
  | { kind: "auto_link"; pair: DiscoveryPair }
  | { kind: "choose"; pairs: DiscoveryPair[] }
  | { kind: "guided_setup"; reason: "incomplete" | "no_eligible_pair" }
  | { kind: "retry_discovery" };

function canAdvertise(page: MetaPageOption): boolean {
  return Boolean(page.tasks?.some((task) => ["ADVERTISE", "MANAGE"].includes(task)));
}

export function buildDiscoveryPairs(input: {
  adAccounts: MetaAdAccountOption[];
  pages: MetaPageOption[];
  relationshipPairs: Array<{ adAccountId: string; pageId: string }>;
  supportedCurrencies: readonly string[];
}): DiscoveryPair[] {
  const relationships = new Set(
    input.relationshipPairs.map((pair) => `${pair.adAccountId}:${pair.pageId}`),
  );
  const pairs: DiscoveryPair[] = [];
  for (const account of input.adAccounts) {
    for (const page of input.pages) {
      if (!canAdvertise(page)) continue;
      pairs.push({
        pairId: `${account.id}:${page.id}`,
        adAccount: account,
        page,
        relationshipVerified: relationships.has(`${account.id}:${page.id}`),
        currencySupported: input.supportedCurrencies.includes(account.currency ?? ""),
      });
    }
  }
  return pairs;
}

export function decideSelection(input: {
  complete: boolean;
  pairs: DiscoveryPair[];
  existingPairId?: string | null;
}): SelectionDecision {
  if (!input.complete) return { kind: "retry_discovery" };
  const eligible = input.pairs.filter(
    (pair) =>
      !pair.adAccount.disabled &&
      pair.adAccount.status === 1 &&
      pair.relationshipVerified &&
        pair.currencySupported &&
        Boolean(pair.adAccount.timezoneName),
  );
  if (input.existingPairId) {
    const existing = eligible.find((pair) => pair.pairId === input.existingPairId);
    if (existing) return { kind: "auto_link", pair: existing };
  }
  if (eligible.length === 1) return { kind: "auto_link", pair: eligible[0] };
  if (eligible.length > 1) return { kind: "choose", pairs: eligible };
  return { kind: "guided_setup", reason: "no_eligible_pair" };
}

export function buildCandidateDTOs(
  pairs: DiscoveryPair[],
): CandidateDTO[] {
  return pairs.flatMap((pair) => {
    const currency = pair.adAccount.currency;
    if (!currency || !/^[A-Z]{3}$/.test(currency) || !pair.adAccount.timezoneName) {
      return [];
    }
    const blockers: Blocker[] = [];
    if (pair.adAccount.disabled || pair.adAccount.status !== 1) {
      blockers.push({ code: "ACCOUNT_RESTRICTED", message: "This ad account is not active.", action: null });
    }
    if (!pair.relationshipVerified) {
      blockers.push({ code: "SETUP_REQUIRED", message: "Meta did not verify this Page and ad account belong together.", action: null });
    }
    if (!pair.currencySupported) {
      blockers.push({ code: "UNSUPPORTED_CURRENCY", message: "This account currency is not supported for campaigns yet.", action: null });
    }
    return [{
      pairId: pair.pairId,
      assets: {
        metaBusinessId: pair.adAccount.metaBusinessId ?? null,
        adAccountId: pair.adAccount.id,
        accountName: pair.adAccount.name,
        pageId: pair.page.id,
        pageName: pair.page.name,
        currency,
        timezoneName: pair.adAccount.timezoneName,
      },
      eligible: blockers.length === 0,
      blockers,
    }];
  });
}