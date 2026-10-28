import { describe, expect, it } from "vitest";
import { whatsappExpectation } from "@/lib/campaign/expectations";
import { excludedFromLedger, poolLedger, type LedgerRun } from "@/lib/campaign/ledger";
import internal from "@/lib/internal-accounts.json";

// #1307: Review states the ledger's facts with n, and quotes no typical cost under 20 pooled chats.
describe("whatsappExpectation (#1307)", () => {
  it("says what AdBrain's runs got today, and that it's too few to predict", () => {
    expect(whatsappExpectation()).toBe("AdBrain's WhatsApp ads so far got 6 chats for about ₹1,200, about ₹200 each. That's too few to predict yours.");
  });
  it("drops the caveat from 20 chats, and says nothing about cost with none", () => {
    expect(whatsappExpectation({ chats: 20, spendRupees: 3_960 })).toBe("AdBrain's WhatsApp ads so far got 20 chats for about ₹4,000, about ₹200 each.");
    expect(whatsappExpectation({ chats: 1, spendRupees: 33 })).toContain("got 1 chat for about ₹33, about ₹33 each.");
    expect(whatsappExpectation({ chats: 0, spendRupees: 0 })).toBe("AdBrain hasn't run enough WhatsApp campaigns yet to quote a cost per chat.");
  });
});

// #1307 "Next": the line reads the #588 ledger live. Production rows read 2026-10-28 (read-only): Diwali (#157) and
// Free Survey (#499) paused, Lever 2 still running.
describe("poolLedger (#1307)", () => {
  const run = (businessId: string, extra: Partial<LedgerRun> = {}): LedgerRun =>
    ({ businessId, destination: "whatsapp", status: "paused", spend: 200, conversations: 1, leads: 0, ...extra });

  it("pools stopped AdBrain runs per destination; a running or unspent one isn't counted", () => {
    const pooled = poolLedger([run("a", { spend: "820.04", conversations: 5 }), run("b", { spend: "374.76" }), run("c"), run("d"), run("e"),
      run("f", { status: "active", spend: "145.15", conversations: 0 }), run("g", { spend: 0 })]);
    expect(pooled.whatsapp).toEqual({ results: 9, spendRupees: 1794.8, runs: 5 });
    expect(pooled.instant_form).toBeNull();
  });

  // Reviewer on #1400: until the pool is big enough, the 'pooled' line is one or two other customers' results.
  it("says nothing until 5 runs from 3 different businesses", () => {
    expect(poolLedger(["a", "b", "c", "d"].map((id) => run(id))).whatsapp).toBeNull();
    expect(poolLedger(["a", "a", "a", "b", "b"].map((id) => run(id))).whatsapp).toBeNull();
    expect(poolLedger(["a", "a", "a", "b", "c"].map((id) => run(id))).whatsapp).toEqual({ results: 5, spendRupees: 1000, runs: 5 });
  });

  it("counts leads for forms and ignores other destinations", () => {
    const forms = ["a", "b", "c", "d", "e"].map((id) => run(id, { destination: "instant_form", spend: 300, conversations: null, leads: 2 }));
    expect(poolLedger([...forms, run("x", { destination: "call" })]).instant_form).toEqual({ results: 10, spendRupees: 1500, runs: 5 });
  });
});

describe("excludedFromLedger (#1307)", () => {
  it("leaves out the team, smoke, the demo workspace and sales prospects; keeps customers", () => {
    const confirmed = "2026-10-01T00:00:00Z";
    expect(excludedFromLedger({ id: "u", email: "owner@gmail.com", email_confirmed_at: confirmed }, "demo@example.com")).toBe(false);
    expect(excludedFromLedger({ id: "u", email: "demo@example.com", email_confirmed_at: confirmed }, "demo@example.com")).toBe(true);
    expect(excludedFromLedger({ id: "u", email: `qa@${internal.domains[0]}`, email_confirmed_at: confirmed }, null)).toBe(true);
    expect(excludedFromLedger({ id: "u", email: `sales+prospect-x@${internal.domains[0]}`, email_confirmed_at: confirmed }, null)).toBe(true);
    if (internal.smokeUserIds[0]) expect(excludedFromLedger({ id: internal.smokeUserIds[0], email: "x@gmail.com", email_confirmed_at: confirmed }, null)).toBe(true);
  });
});
