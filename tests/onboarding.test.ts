import { describe, expect, it } from "vitest";
import { onboardingSteps, onboardingProgress } from "@/lib/onboarding";

const base = { hasBrand: false, creativeCount: 0, approvedCount: 0, campaignCount: 0 };

describe("onboardingSteps", () => {
  it("returns four ordered steps with correct hrefs", () => {
    const steps = onboardingSteps(base);
    expect(steps.map((s) => s.id)).toEqual(["brand", "generate", "approve", "launch"]);
    expect(steps.map((s) => s.href)).toEqual(["/brand", "/create", "/studio", "/campaigns"]);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("marks steps done from the account state", () => {
    const steps = onboardingSteps({
      hasBrand: true,
      creativeCount: 3,
      approvedCount: 1,
      campaignCount: 0,
    });
    const done = Object.fromEntries(steps.map((s) => [s.id, s.done]));
    expect(done).toEqual({ brand: true, generate: true, approve: true, launch: false });
  });
});

describe("onboardingProgress", () => {
  it("reports the next incomplete step", () => {
    const p = onboardingProgress(
      onboardingSteps({ ...base, hasBrand: true }),
    );
    expect(p.done).toBe(1);
    expect(p.total).toBe(4);
    expect(p.complete).toBe(false);
    expect(p.next?.id).toBe("generate");
  });

  it("is complete with no next step once all are done", () => {
    const p = onboardingProgress(
      onboardingSteps({ hasBrand: true, creativeCount: 2, approvedCount: 1, campaignCount: 1 }),
    );
    expect(p.complete).toBe(true);
    expect(p.next).toBeNull();
    expect(p.done).toBe(4);
  });
});
