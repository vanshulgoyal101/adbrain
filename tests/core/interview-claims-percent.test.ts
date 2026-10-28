import { beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/create/interview-claims-percent.json";

// #1415: production INTERVIEW_VALIDATION on a bakery Brand ('Flat 10% off', eggless cakes). Recorded with
// scripts/record-interview-claim-fixtures.ts (free providers): Gemini writes "100% eggless", which the
// percent rule read as an unsupported commercial term, costing a repair call or the offer's sentence.
vi.mock("@/lib/llm", () => ({ complete: vi.fn(), parseJSON: JSON.parse }));
const { complete } = await import("@/lib/llm");
const { runInterview } = await import("@/lib/creative/interview");

const reply = (content: string) => ({ text: content, provider: "google", model: "gemini-3.6-flash", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
const input = { brand: recorded.brand as never, goal: recorded.goal, answers: [] };
const firstReplies = recorded.replies.filter((r) => r.attempt === 1).map((r) => r.content);
const brief = (content: string) => (JSON.parse(content) as { brief: string }).brief;

beforeEach(() => vi.mocked(complete).mockReset());

describe("core: Create's assistant keeps a Brand-backed '100% …' (#1415)", () => {
  it.each(firstReplies.map((content, index) => [index, content]))("recorded reply %i: accepted first time, offer kept", async (_index, content) => {
    expect(content).toMatch(/100% eggless/i);
    vi.mocked(complete).mockResolvedValue(reply(content as string));
    const rules: string[][] = [];
    const result = await runInterview(input, { onAttempt: async (_c, _a, _v, r = []) => { rules.push(r); } });
    expect(rules).toEqual([[]]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect((result as { brief: string }).brief).toBe(brief(content as string));
    expect((result as { brief: string }).brief).toMatch(/10% off/i);
  });

  it("a 100% the Brand doesn't back is still refused ('100% refund')", async () => {
    const invented = JSON.parse(firstReplies[0]) as { brief: string };
    vi.mocked(complete).mockResolvedValue(reply(JSON.stringify({ ...invented, brief: `${invented.brief} Not happy? Get a 100% refund.` })));
    const rules: string[][] = [];
    await runInterview(input, { onAttempt: async (_c, _a, _v, r = []) => { rules.push(r); } });
    expect(rules[0]).toEqual(["unsupported-commercial-claim:percent"]);
  });

  it("an amount ends at its last digit: '…for just $49.' is the Brand's $49 offer", async () => {
    const brand = { name: "Cedar Ridge", offers: ["$49 new-patient exam and consultation"], usps: [], description: "Chiropractic clinic in Austin" };
    vi.mocked(complete).mockResolvedValue(reply(JSON.stringify({ ready: true,
      brief: "A warm ad for Cedar Ridge in Austin: book a new-patient exam and consultation for just $49. Show a friendly chiropractor with a patient." })));
    const rules: string[][] = [];
    const result = await runInterview({ brand: brand as never, goal: "More bookings", answers: [] }, { onAttempt: async (_c, _a, _v, r = []) => { rules.push(r); } });
    expect(rules).toEqual([[]]);
    expect((result as { brief: string }).brief).toContain("$49.");
  });
});
