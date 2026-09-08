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
});