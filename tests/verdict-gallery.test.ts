import { describe, expect, it } from "vitest";
import { galleryCards } from "@/lib/campaign/verdict-gallery";
import { verdict } from "@/lib/campaign/verdict";
import { rejectionCopy } from "@/lib/meta/rejection-copy";

// #1255 (CPO): the walk page shows every card state; if a threshold moves, an example must still land in its state.
describe("card states gallery (#1255)", () => {
  it("has one example per state the CPO asked to walk", () => {
    const cards = galleryCards(Date.parse("2026-10-28T12:00:00Z"));
    expect(Object.fromEntries(cards.map((card) => [card.name, verdict(card.input).state]))).toEqual({
      "Early days": "early",
      "Working": "working",
      "Costly": "costly",
      "Weak ad": "weak_ad",
      "No chats, people opened WhatsApp": "no_results",
      "Not showing after a day": "not_showing_day",
      "1 of 3 ads rejected": "early",
      "Ended, it worked": "ended_worked",
      "Deleted in Meta": "ended_measured",
      "New audience waiting": "measured",
      "People waiting": "measured",
    });
    const rejected = cards.find((card) => card.reviews)!;
    expect(rejectionCopy(rejected.reviews!.flatMap((review) => review.feedback))?.row).toBe("misleading");
    expect(verdict(cards.at(-1)!.input).sentence).toMatch(/^2 people are waiting for your reply\./);
    // #1841 (Designer): the newer card states are on the page too, so walks cover them.
    expect(cards.filter((card) => card.extra).map((card) => [card.name, card.extra])).toEqual([["Deleted in Meta", "deleted_in_meta"], ["New audience waiting", "audience_waiting"]]);
  });
});
