import { describe, expect, it } from "vitest";
import { fundingShortfall } from "@/lib/campaign/funding-check";

// #774 (CTO): activation and budget edits share one funding rule by #806's fundingMode.
const account = (spendCapPaise: number, roomPaise: number) => ({ spendCapPaise, amountSpentPaise: spendCapPaise - roomPaise, roomPaise, prepay: false });

describe("core: funding shortfall by funding mode (#774, #806)", () => {
  it("own account with no account limit: the run's Meta cap is the guard", () => {
    expect(fundingShortfall({ mode: "own", neededPaise: 84_000, account: account(0, 0) })).toBeNull();
  });
  it("own account with a limit must have room for the run", () => {
    expect(fundingShortfall({ mode: "own", neededPaise: 84_000, account: account(100_000, 50_000) })).toEqual({ kind: "short", roomPaise: 50_000, neededPaise: 84_000 });
    expect(fundingShortfall({ mode: "own", neededPaise: 84_000, account: account(100_000, 84_000) })).toBeNull();
  });
  it("operator funding requires an account limit", () => {
    expect(fundingShortfall({ mode: "operator", neededPaise: 84_000, account: account(0, 0) })).toEqual({ kind: "no_limit" });
  });
  it("managed funding checks the AdBrain allowance, not the account", () => {
    expect(fundingShortfall({ mode: "managed", neededPaise: 84_000, account: null, allowancePaise: 50_000 })).toEqual({ kind: "allowance", allowancePaise: 50_000, neededPaise: 84_000 });
    expect(fundingShortfall({ mode: "managed", neededPaise: 84_000, account: null, allowancePaise: null })).toEqual({ kind: "unverified" });
  });
  it("an unreadable account fails closed", () => {
    expect(fundingShortfall({ mode: "own", neededPaise: 84_000, account: null })).toEqual({ kind: "unverified" });
  });
});
