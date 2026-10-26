import { describe, expect, it } from "vitest";
import { affirmedInFact } from "@/lib/creative/claim-support";

// #687: the shared rule both the Assistant (#613) and Create use for "does this Brand fact state the offer?".
const states = (fact: string, term = "free") => affirmedInFact(fact, fact.toLowerCase().indexOf(term), term);

describe("affirmedInFact (#687)", () => {
  it.each(["Free site survey, no obligation", "Free survey (not for commercial sites)", "Get a free assessment"])("%s states it", (fact) => {
    expect(states(fact)).toBe(true);
  });
  it.each(["No free survey", "Site survey isn't free", "Avoid free offers", "Free survey no longer offered", "Free survey not available this month"])("%s does not", (fact) => {
    expect(states(fact)).toBe(false);
  });
});
