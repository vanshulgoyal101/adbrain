import { describe, expect, it } from "vitest";
import { buildCandidateDTOs, buildDiscoveryPairs, decideSelection } from "@/lib/meta/selection";

const account = { id: "act_1", accountId: "1", name: "Main", currency: "INR", status: 1, disabled: false, timezoneName: "Asia/Kolkata" };
const page = { id: "page_1", name: "Main Page", tasks: ["ADVERTISE"] };

describe("Meta asset selection", () => {
  it("auto-links only one complete, related, active, supported pair", () => {
    const pairs = buildDiscoveryPairs({
      adAccounts: [account],
      pages: [page],
      relationshipPairs: [{ adAccountId: "act_1", pageId: "page_1" }],
      supportedCurrencies: ["INR"],
    });
    expect(decideSelection({ complete: true, pairs }).kind).toBe("auto_link");
  });

  it("never auto-links an unverified relationship or disabled account", () => {
    const pairs = buildDiscoveryPairs({
      adAccounts: [{ ...account, disabled: true }],
      pages: [page],
      relationshipPairs: [],
      supportedCurrencies: ["INR"],
    });
    expect(decideSelection({ complete: true, pairs })).toEqual({
      kind: "guided_setup",
      reason: "no_eligible_pair",
    });
  });

  it("does not select from incomplete discovery", () => {
    const pairs = buildDiscoveryPairs({
      adAccounts: [account],
      pages: [page],
      relationshipPairs: [{ adAccountId: "act_1", pageId: "page_1" }],
      supportedCurrencies: ["INR"],
    });
    expect(decideSelection({ complete: false, pairs })).toEqual({ kind: "retry_discovery" });
  });

  it("creates an eligible candidate only from explicit shared business evidence", () => {
    const pairs = buildDiscoveryPairs({
      adAccounts: [{ ...account, metaBusinessId: "biz_1", timezoneName: "Asia/Kolkata" }],
      pages: [{ ...page, metaBusinessId: "biz_1" }],
      relationshipPairs: [{ adAccountId: "act_1", pageId: "page_1" }],
      supportedCurrencies: ["INR"],
    });
    expect(buildCandidateDTOs(pairs)).toEqual([
      expect.objectContaining({ pairId: "act_1:page_1", eligible: true }),
    ]);

    const unverified = buildDiscoveryPairs({
      adAccounts: [{ ...account, metaBusinessId: "biz_1", timezoneName: "Asia/Kolkata" }],
      pages: [{ ...page, metaBusinessId: "biz_2" }],
      relationshipPairs: [],
      supportedCurrencies: ["INR"],
    });
    expect(buildCandidateDTOs(unverified)[0].eligible).toBe(false);
  });

  it("tells a shop whose Page and ad account sit outside one portfolio to put both in one (#679)", () => {
    // A personal ad account (no portfolio) next to a Page: Meta returns no shared business id.
    const [candidate] = buildCandidateDTOs(buildDiscoveryPairs({
      adAccounts: [account], pages: [page], relationshipPairs: [], supportedCurrencies: ["INR"],
    }));
    expect(candidate.eligible).toBe(false);
    expect(candidate.blockers).toEqual([expect.objectContaining({ code: "SETUP_REQUIRED" })]);
    expect(candidate.blockers[0].message).toMatch(/same business portfolio.*Meta Business Settings/);
    expect(candidate.blockers[0].message).toContain("No portfolio yet? Create one in Business Settings.");
  });

  it("names the account's currency and the fix for a non-rupee ad account (#2421)", () => {
    const [candidate] = buildCandidateDTOs(buildDiscoveryPairs({
      adAccounts: [{ ...account, currency: "USD" }], pages: [page],
      relationshipPairs: [{ adAccountId: "act_1", pageId: "page_1", metaBusinessId: "biz_1" }],
      supportedCurrencies: ["INR"],
    }));
    expect(candidate.eligible).toBe(false);
    expect(candidate.blockers).toEqual([{
      code: "UNSUPPORTED_CURRENCY",
      message: "This ad account uses USD. AdBrain runs ads in rupees, and Meta can't change an account's currency. Create a new ad account in rupees (INR) in your business portfolio, then tap Reconnect Meta.",
      action: null,
    }]);
  });
});