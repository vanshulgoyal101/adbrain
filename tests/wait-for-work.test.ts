import { describe, expect, it } from "vitest";
import { linkedIssues, matchers, waitingOnMe } from "../scripts/wait-for-work.mjs";

describe("wait-for-work handoffs", () => {
  const devops = matchers("devops");
  const dev = matchers("dev");

  it("treats a PR whose title names an owned issue as linked (#309 → #274)", () => {
    expect(linkedIssues("#274 Reliable scheduler: Supabase pg_cron runs enforce-spend")).toEqual([274]);
    expect(linkedIssues("chore(deps): latest dependencies")).toEqual([]);
  });

  it("wakes the owner when someone else spoke last without handing off elsewhere", () => {
    expect(waitingOnMe("QA verdict at d44e9c4: **approved**. Migration sha256 unchanged.", devops)).toBe(true);
    expect(waitingOnMe(null, devops)).toBe(true);
  });

  it("wakes the owner when addressed, even alongside another role", () => {
    expect(waitingOnMe("CTO review: **approved**. → DevOps: release once QA names d44e9c4.", devops)).toBe(true);
  });

  it("stays quiet when the last word is the owner's own or a handoff to someone else", () => {
    expect(waitingOnMe("DevOps: → QA: ready at adbc563.", devops)).toBe(false);
    expect(waitingOnMe("QA: approved at e1f423c. → CTO: review (tenant boundary).", devops)).toBe(false);
  });

  it("ignores items parked on the owner or outside the team", () => {
    expect(waitingOnMe("CEO: please submit", devops, ["core", "waiting-owner"])).toBe(false);
  });

  it("keeps Dev distinct from Dev 2, Dev 3 and DevOps", () => {
    expect(dev.writtenByMe("Dev 2: slice 3 is finished")).toBe(false);
    expect(waitingOnMe("CTO: → Dev 2: yours now.", dev)).toBe(false);
    expect(waitingOnMe("CTO: → DevOps: clear the claim.", dev)).toBe(false);
    expect(waitingOnMe("CTO: → Dev: yours, queue #1.", dev)).toBe(true);
  });
});
