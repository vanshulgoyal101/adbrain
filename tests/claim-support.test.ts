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

  // #767 (CTO): a withdrawal later in the same sentence still withdraws, even after a comma.
  it.each([
    ["$49 exam, no longer offered", "$49"],
    ["$49.99 exam no longer offered", "$49.99"],
    ["Free survey, discontinued", "free"],
    ["Free survey for new homes, expired last month", "free"],
  ])("%s does not state %s", (fact, term) => {
    expect(affirmedInFact(fact, fact.toLowerCase().indexOf(term.toLowerCase()), term)).toBe(false);
  });
  it.each([
    ["Free survey. The old discount has ended.", "free"],
    ["$49 exam; the $99 package is discontinued", "$49"],
  ])("%s still states %s (the withdrawal is in another sentence)", (fact, term) => {
    expect(affirmedInFact(fact, fact.toLowerCase().indexOf(term.toLowerCase()), term)).toBe(true);
  });
});
