import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/create/interview-non-answer.json";
import { openAIReply, requestUrl } from "./replay";
import type { BrandContext } from "@/lib/templates/ads";

// interview-non-answer.json: real Solaride interview replies recorded on 2026-10-24 by
// scripts/record-interview-fixtures.ts (#284). `replies` use interview-v3; `rejectedUnderV2`
// are interview-v2 replies the old claim check refused for "₹10,000" when the goal said
// "10,000 rupees", the rule that failed in production. The goal and the offer question with its
// "type it below" chip are written to match the 19:43Z production attempt, which has no stored body.
const brand = recorded.brand as BrandContext;

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    GROQ_API_KEYS: "core-groq",
    GROQ_MODEL: "qwen/qwen3.8-27b",
    LLM_BUDGET_PROVIDER_ORDER: "groq",
  })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function replay(contents: string[]) {
  const queue = [...contents];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    expect(requestUrl(input)).toBe("https://api.groq.com/openai/v1/chat/completions");
    const next = queue.shift();
    if (next === undefined) throw new Error("No recorded interview reply left.");
    return openAIReply(next, "qwen/qwen3.8-27b");
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function interview(answers: typeof recorded.nonAnswer[] = []) {
  const { runInterview } = await import("@/lib/creative/interview");
  const attempts: { valid: boolean; rules: string[] }[] = [];
  const result = await runInterview({ brand, goal: recorded.goal, answers }, {
    onAttempt: async (_completion, _attempt, valid, rules = []) => { attempts.push({ valid, rules }); },
  });
  return { result, attempts };
}

describe("core: Create never gets stuck on a non-answer (#284)", () => {
  it("re-asks the offer after a 'type it below' chip instead of failing the repeat rule", async () => {
    const reply = recorded.replies.find((item) => item.turn === "non-answer")!;
    replay([reply.content]);
    const { result, attempts } = await interview([recorded.nonAnswer]);
    expect(result).toMatchObject({ ready: false, question: { field: "offer", allowText: true } });
    expect(attempts).toEqual([{ valid: true, rules: [] }]);
  });

  it("accepts the recorded replies the old check rejected for ₹10,000 against '10,000 rupees'", async () => {
    expect(recorded.rejectedUnderV2.replies.length).toBeGreaterThanOrEqual(2);
    for (const reply of recorded.rejectedUnderV2.replies) {
      vi.resetModules();
      replay([reply.content]);
      const { result, attempts } = await interview(reply.turn === "non-answer" ? [recorded.nonAnswer] : []);
      expect(result.ready).toBe(true);
      expect(result.brief).toMatch(/10,000/);
      expect(attempts).toEqual([{ valid: true, rules: [] }]);
    }
  });

  it("drops a 'type it below' chip from a recorded question and keeps the text box", async () => {
    const reply = JSON.parse(recorded.replies.find((item) => item.turn === "non-answer")!.content);
    reply.question.options = ["Free site survey", "Custom offer (type it below)"];
    reply.question.allowText = false;
    replay([JSON.stringify(reply)]);
    const { result } = await interview([recorded.nonAnswer]);
    expect(result.question).toMatchObject({ options: ["Free site survey"], allowText: true });
  });

  it("names the failing rule, without user text, when a reply invents an amount", async () => {
    const reply = recorded.rejectedUnderV2.replies[0].content.replaceAll("₹10,000", "₹50,000");
    const repaired = recorded.rejectedUnderV2.replies[0].content;
    const fetch = replay([reply, repaired]);
    const { attempts } = await interview(recorded.rejectedUnderV2.replies[0].turn === "non-answer" ? [recorded.nonAnswer] : []);
    expect(attempts).toEqual([{ valid: false, rules: ["unsupported-commercial-claim"] }, { valid: true, rules: [] }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
