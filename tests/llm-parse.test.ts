import { describe, expect, it } from "vitest";
import { parseJSON } from "@/lib/llm";

describe("parseJSON", () => {
  it("parses plain JSON", () => {
    expect(parseJSON<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips ```json code fences", () => {
    const text = '```json\n{"headline":"Save big"}\n```';
    expect(parseJSON<{ headline: string }>(text)).toEqual({
      headline: "Save big",
    });
  });

  it("strips bare ``` fences", () => {
    const text = '```\n{"cta":"Get Quote"}\n```';
    expect(parseJSON<{ cta: string }>(text)).toEqual({ cta: "Get Quote" });
  });

  it("salvages a JSON object embedded in prose", () => {
    const text = 'Sure! Here is your ad: {"headline":"Go solar"} Hope it helps.';
    expect(parseJSON<{ headline: string }>(text)).toEqual({
      headline: "Go solar",
    });
  });

  it("throws on unrecoverable output", () => {
    expect(() => parseJSON("no json here")).toThrow();
  });
});
