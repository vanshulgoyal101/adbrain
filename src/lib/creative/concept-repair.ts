import type { ChatMessage } from "@/lib/llm";

/**
 * #2444 (CTO): the one repair shows the model its own draft and asks it to change only what failed. A fresh rewrite
 * threw away what was right, and gemini-3.5-flash-lite wrote the same repeated headline again. A reply that wasn't
 * JSON leaves no draft to keep, so that repair still starts fresh.
 */
export function repairMessages(draft: unknown, issues: string[]): ChatMessage[] {
  const failures = `using only supplied facts, without inventing claims:\n${issues.join("\n")}`;
  if (draft === undefined) {
    return [{ role: "user", content: `Generate a fresh, complete JSON concept for the original brief. Fix these validation failures ${failures}` }];
  }
  return [
    { role: "assistant", content: JSON.stringify(draft) },
    {
      role: "user",
      content: "Your draft above failed these checks. Return the complete JSON concept again: rewrite only what these failures name "
        + `and keep every other field exactly as it is. Fix them ${failures}`,
    },
  ];
}
