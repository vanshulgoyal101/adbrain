import { describe, expect, it } from "vitest";
import { whatsappExpectation } from "@/lib/campaign/expectations";
import { poolLedger } from "@/lib/campaign/ledger";

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
  it("pools stopped AdBrain runs per destination; a running one waits until it stops", () => {
    const pooled = poolLedger([
      { destination: "whatsapp", status: "paused", spend: "820.04", conversations: 5, leads: 0 },
      { destination: "whatsapp", status: "paused", spend: "374.76", conversations: 1, leads: 0 },
      { destination: "whatsapp", status: "active", spend: "145.15", conversations: 0, leads: 0 },
      { destination: "instant_form", status: "completed", spend: 0, conversations: null, leads: 0 },
    ]);
    expect(pooled.whatsapp).toEqual({ results: 6, spendRupees: 1194.8, runs: 2 });
    expect(pooled.instant_form).toEqual({ results: 0, spendRupees: 0, runs: 0 });
    expect(whatsappExpectation({ chats: pooled.whatsapp.results, spendRupees: pooled.whatsapp.spendRupees })).toBe(whatsappExpectation());
  });
  it("counts leads for forms and ignores other destinations", () => {
    expect(poolLedger([
      { destination: "instant_form", status: "paused", spend: 300, conversations: null, leads: 2 },
      { destination: "call", status: "paused", spend: 100, conversations: null, leads: 0 },
    ]).instant_form).toEqual({ results: 2, spendRupees: 300, runs: 1 });
  });
});
