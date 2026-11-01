import type { ChatMessage } from "@/lib/llm";
import { conceptValidationRules } from "./concept";

// A draft that broke a fact or policy rule may hold more invented detail than the validator names, so its repair
// starts fresh, as before (Oct 1).
const FRESH_RULES = new Set([
  "unsupported-commercial-claim", "sourceQuotes", "banned-claim", "exaggerated-result", "unsupported-superlative",
  "personal-attribute", "price-unit", "work-claim", "contact-in-copy", "other", "schema-or-other",
]);

/**
 * #2444 (CTO): a draft that failed only on form (length, a repeated headline or opening, an empty scene, the fold)
 * goes back to the model, which rewrites just what failed. A fresh rewrite threw away what was right, and
 * gemini-3.5-flash-lite wrote the same repeated headline again. A reply that wasn't JSON leaves no draft.
 */
export function repairMessages(draft: unknown, issues: string[]): ChatMessage[] {
  const failures = `using only supplied facts, without inventing claims:\n${issues.join("\n")}`;
  if (draft === undefined || conceptValidationRules(issues).some((rule) => FRESH_RULES.has(rule))) {
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
