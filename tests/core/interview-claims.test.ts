import { beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/create/interview-claims.json";

// #613: real Groq replies for a Brand with no offers (production 2439a215 had 2 claim failures in
// 72 h; recorded with scripts/record-interview-claim-fixtures.ts, free providers only).
vi.mock("@/lib/llm", () => ({ complete: vi.fn(), parseJSON: JSON.parse }));
const { complete } = await import("@/lib/llm");
const { runInterview } = await import("@/lib/creative/interview");

const reply = (content: string) => ({ text: content, provider: "groq", model: "qwen/qwen3.8-27b", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
const input = { brand: recorded.brand as never, goal: recorded.goal, answers: [] };
const offerQuestion = recorded.replies.find((r) => r.run === 1 && r.attempt === 1)!.content;
const freeBrief = recorded.replies.find((r) => r.run === 0 && r.attempt === 1)!.content;

beforeEach(() => vi.mocked(complete).mockReset());

describe("core: Create's assistant on a Brand with no offers (#613)", () => {
  it("offers 'Free …' choices on an offer question as-is: the owner decides, the AI can't", async () => {
    vi.mocked(complete).mockResolvedValue(reply(offerQuestion));
    const result = await runInterview(input);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ready: false, question: { field: "offer", allowRandom: false, aiCanDecide: false,
      options: ["Free Home Solar Survey", "Free System Design Consultation", "No, focus on savings and trust"] } });
  });

  it("answers with the brief minus its invented offer when the repair repeats it, instead of failing", async () => {
    vi.mocked(complete).mockResolvedValue(reply(freeBrief));
    const rules: string[][] = [];
    const result = await runInterview(input, { onAttempt: async (_c, _a, _v, r = []) => { rules.push(r); } });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(rules).toEqual([["unsupported-commercial-claim:free"], ["unsupported-commercial-claim:free"]]);
    expect(result.ready).toBe(true);
    const brief = (result as { brief: string }).brief;
    expect(brief).not.toMatch(/\bfree\b/i);
    expect(brief).toContain("Mohali");
    expect(brief.length).toBeGreaterThan(100);
  });
});
