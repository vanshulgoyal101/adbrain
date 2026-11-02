import { beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/create/interview-claims-currency.json";

// #2649: qwen's INTERVIEW_VALIDATION (unsupported-commercial-claim:currency) in production was all on the
// Cedar Ridge smoke Brand ("$49 new-patient exam…", "Free 15-minute spine check") before #1415 made an
// amount end at its last digit. Production keeps no output text, so these qwen replies were recorded
// with scripts/record-interview-claim-fixtures.ts (Groq only, Brand read-only) and the failing sentence
// shapes are built on top of them.
vi.mock("@/lib/llm", () => ({ complete: vi.fn(), parseJSON: JSON.parse }));
const { complete } = await import("@/lib/llm");
const { runInterview } = await import("@/lib/creative/interview");

const reply = (content: string) => ({ text: content, provider: "groq", model: "qwen/qwen3.8-27b", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
const input = { brand: recorded.brand as never, goal: recorded.goal, answers: [] };
const firstReplies = recorded.replies.filter((r) => r.attempt === 1).map((r) => r.content);
const withBrief = (content: string, extra: string) => {
  const parsed = JSON.parse(content) as { brief: string };
  return JSON.stringify({ ...parsed, brief: `${parsed.brief} ${extra}` });
};
const rulesFor = async (content: string) => {
  vi.mocked(complete).mockResolvedValue(reply(content));
  const rules: string[][] = [];
  const result = await runInterview(input, { onAttempt: async (_c, _a, _v, r = []) => { rules.push(r); } });
  return { rules, result: result as { brief?: string } };
};

beforeEach(() => vi.mocked(complete).mockReset());

describe("core: Create's assistant keeps the Brand's own amount and free offer (#2649)", () => {
  it("records only Groq qwen replies", () => {
    expect(firstReplies.length).toBeGreaterThanOrEqual(3);
    expect(new Set(recorded.replies.map((r) => `${r.provider}/${r.model}`))).toEqual(new Set(["groq/qwen/qwen3.8-27b"]));
  });

  it.each(firstReplies.map((content, index) => [index, content]))("recorded reply %i: accepted first time, the Brand amount kept", async (_index, content) => {
    expect(content).toMatch(/\$49/);
    const { rules, result } = await rulesFor(content as string);
    expect(rules).toEqual([[]]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.brief).toMatch(/\$49/);
  });

  it.each([
    "Book a new-patient exam and consultation for just $49.",
    "New patients pay $49, exam and consultation included.",
    "Try the Free 15-minute spine check before your $49 visit.",
  ])("the Brand's own offer at a sentence edge is accepted: %s", async (sentence) => {
    const { rules, result } = await rulesFor(withBrief(firstReplies[0], sentence));
    expect(rules).toEqual([[]]);
    expect(result.brief).toContain(sentence);
  });

  it("an amount the Brand doesn't offer is still refused ('$29')", async () => {
    const { rules } = await rulesFor(withBrief(firstReplies[0], "First adjustment only $29."));
    expect(rules[0]).toEqual(["unsupported-commercial-claim:currency"]);
  });
});
