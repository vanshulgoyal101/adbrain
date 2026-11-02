import { describe, expect, it } from "vitest";
import { createFailureLines, parseCreateStream } from "../scripts/lib/smoke-create-failures.mjs";

describe("parseCreateStream (#2504)", () => {
  it("returns the final result and counts streamed ads, skipping cut-off lines", () => {
    const text = [
      JSON.stringify({ type: "progress", step: 1 }),
      JSON.stringify({ type: "creative", angleId: "a" }),
      "{\"type\":\"creat",
      JSON.stringify({ type: "creative", angleId: "b" }),
      JSON.stringify({ type: "result", status: 200, body: { creatives: [{}, {}], failures: [{ angle: "Price", error: "Too long" }] } }),
      "",
    ].join("\n");
    const { result, streamed } = parseCreateStream(text);
    expect(streamed).toBe(2);
    expect(result?.status).toBe(200);
    expect(result?.body.failures).toHaveLength(1);
  });

  it("keeps a 0-ad 502 result and reports no result for a cut stream", () => {
    const failed = parseCreateStream(JSON.stringify({ type: "result", status: 502, body: { error: "No ads", failures: [] } }));
    expect(failed.result?.status).toBe(502);
    expect(parseCreateStream(JSON.stringify({ type: "progress" })).result).toBeNull();
  });
});

describe("createFailureLines (#2504)", () => {
  it("is silent when every ad saved", () => {
    expect(createFailureLines({ expected: 3, saved: 3, failures: [], usage: [] })).toEqual([]);
  });

  it("names each missing ad and groups failed attempts by reason, provider and model", () => {
    const row = { usage_kind: "text", provider: "groq", model: "m1", status: "error", error_code: "CreativeValidationError",
      metadata: { validationRules: ["too-long"] } };
    const lines = createFailureLines({
      expected: 3,
      saved: 2,
      failures: [{ angle: "Price", error: "Could not write this ad.\nstack" }],
      usage: [row, row, { usage_kind: "text", provider: "gemini", model: "m2", status: "error", error_code: "LLM_RATE_LIMIT" },
        { usage_kind: "text", provider: "groq", model: "m1", status: "fallback", error_code: "X" }],
    });
    expect(lines).toEqual([
      "NOTE missing ad \"Price\": Could not write this ad.",
      "NOTE failed attempts: 2× CreativeValidationError[too-long] (groq/m1); 1× LLM_RATE_LIMIT (gemini/m2)",
    ]);
  });

  it("says when the result or the attempts were not read", () => {
    expect(createFailureLines({ expected: 3, saved: 1, failures: null, usage: null })).toEqual([
      "NOTE 2 missing ads not named by Create (the run's result was not read)",
      "NOTE failed attempts: not read",
    ]);
    expect(createFailureLines({ expected: 3, saved: null, failures: null, usage: [] })).toEqual([
      "NOTE failed attempts: none recorded for this run",
    ]);
  });
});
