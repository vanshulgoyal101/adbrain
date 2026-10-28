import { describe, expect, it } from "vitest";
import { whatsappExpectation } from "@/lib/campaign/expectations";

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
