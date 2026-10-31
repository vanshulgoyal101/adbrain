import { describe, expect, it } from "vitest";
import recorded from "./fixtures/gemini/flash-lite-concepts.json";
import evalCases from "../eval/cases.json";
import { parseJSON } from "@/lib/llm";
import { validateConcept } from "@/lib/creative/concept";
import { AD_ANGLES } from "@/lib/templates/ads";

// #2444: production's free text model, gemini-3.5-flash-lite (#2189), writes a multi-line primary_text with raw
// newlines inside the JSON string. JSON.parse rejects that ("Bad control character"), so a good concept was thrown away
// as invalid-json and cost a repair or the ad. Recorded: 3 of 6 first attempts on the eval gate cases, Oct 31.
describe("core: flash-lite's raw newlines inside JSON strings don't cost the concept (#2444)", () => {
  it.each(recorded.replies.map((reply) => [`${reply.case} ${reply.angle}`, reply] as const))("%s parses and validates", (_, reply) => {
    expect(() => JSON.parse(reply.text)).toThrow(/control character/i);
    const value = parseJSON<{ primary_text: string }>(reply.text);
    expect(value.primary_text).toContain("\n");
    const item = evalCases.cases.find((entry) => entry.id === reply.case)!;
    const angle = AD_ANGLES.find((entry) => entry.id === reply.angle)!;
    const result = validateConcept(value, { brand: item.brand, brief: item.brief, angle, language: item.language, sourceFacts: item.sourceFacts });
    expect(result).toMatchObject({ success: true });
  });

  it("escapes only inside strings: escaped quotes, backslashes and whitespace between tokens stay as they were", () => {
    const text = '{\n  "a": "line 1\nsaid \\"hi\\"\tthen\\\\",\n  "b": ["x\r\ny"]\n}';
    expect(parseJSON(text)).toEqual({ a: 'line 1\nsaid "hi"\tthen\\', b: ["x\r\ny"] });
    expect(parseJSON('Here you go:\n```json\n{"a": "1\n2"}\n```')).toEqual({ a: "1\n2" });
    expect(() => parseJSON('{"a": "unterminated\n')).toThrow(/Failed to parse LLM JSON output/);
  });
});
