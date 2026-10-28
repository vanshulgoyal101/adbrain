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
      "IELTS: promised a band or visa": "early",
      "IELTS: talked about the reader's result": "early",
      "IELTS: read as a job or visa offer": "early",
      "Interiors: read as a property ad": "early",
      "Interiors: lowest price, fixed handover": "early",
      "Deleted in Meta": "ended_measured",
      "New audience waiting": "measured",
      "People waiting": "measured",
    });
    const rejected = cards.find((card) => card.reviews)!;
    expect(rejectionCopy(rejected.reviews!.flatMap((review) => review.feedback))?.row).toBe("misleading");
    expect(verdict(cards.at(-1)!.input).sentence).toMatch(/^2 people are waiting for your reply\./);
    // #1854 (QA): each pilot segment's rejection is on the page with its business type, so #1690's words can be walked.
    expect(cards.filter((card) => card.vertical).map((card) => [card.name, rejectionCopy(card.reviews!.flatMap((review) => review.feedback), { vertical: card.vertical })?.row])).toEqual([
      ["IELTS: promised a band or visa", "misleading"], ["IELTS: talked about the reader's result", "personal_attributes"],
      ["IELTS: read as a job or visa offer", "job_or_visa_offer"], ["Interiors: read as a property ad", "special_category"],
      ["Interiors: lowest price, fixed handover", "misleading"],
    ]);
    // #1841 (Designer): the newer card states are on the page too, so walks cover them.
    expect(cards.filter((card) => card.extra).map((card) => [card.name, card.extra])).toEqual([["Deleted in Meta", "deleted_in_meta"], ["New audience waiting", "audience_waiting"]]);
  });
});
