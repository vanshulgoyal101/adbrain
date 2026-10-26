/**
 * #738: records real Claude Haiku replies for Create's "Solve a pain point" angle under the current
 * prompt, on the Cedar Ridge run-4 Brand and brief, with production's concept settings. Text only
 * (about $0.001 a reply); writes no data. Adds `painPointV738` to cedar-ridge-haiku.json.
 * #713: `--all-angles` records three takes of each run-4 angle at CREATIVE_REASONING_EFFORT into
 * `byEffort.<effort>` instead, for the Create p90 replay (tests/core/create-p90.test.ts).
 *
 *   CREATIVE_PROVIDER_ORDER=openrouter OPENROUTER_MODEL=anthropic/claude-haiku-5.5 [CREATIVE_REASONING_EFFORT=low] \
 *     npx tsx --env-file=.env.local scripts/record-haiku-policy-fixture.ts [--all-angles]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildConceptMessages, creativeConceptSchema, validateConcept, conceptValidationRules } from "@/lib/creative/concept";
import { getEnv } from "@/lib/env";
import { complete } from "@/lib/llm";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import run4 from "../tests/core/fixtures/create/cedar-ridge-run4.json";

async function main() {
  const env = getEnv();
  const allAngles = process.argv.includes("--all-angles");
  const angles = allAngles
    ? run4.angles.map(({ angleName }) => AD_ANGLES.find(({ name }) => name === angleName)!)
    : [AD_ANGLES.find(({ id }) => id === "problem")!];
  const replies = [];
  for (let run = 0; run < 3; run++) for (const angle of angles) {
    const input = { brand: run4.brand as BrandContext, brief: run4.brief, angle };
    const started = Date.now();
    const reply = await complete(buildConceptMessages(input), {
      routing: "creative", json: true, responseSchema: creativeConceptSchema, temperature: 0.8,
      maxTokens: env.CREATIVE_MAX_TOKENS, reasoningEffort: env.CREATIVE_REASONING_EFFORT, cache: false,
    });
    let rules: string[] = ["invalid-json"];
    try {
      const result = validateConcept(JSON.parse(reply.text.replace(/^```json\s*|```\s*$/g, "")), input);
      rules = result.success ? [] : conceptValidationRules(result.issues);
    } catch { /* kept as invalid-json */ }
    console.log(reply.model, Date.now() - started, "ms", rules.join(",") || "valid", "|", reply.text.match(/"headline"\s*:\s*"([^"]*)"/)?.[1]);
    replies.push({ angleName: angle.name, content: reply.text, usage: { prompt: reply.usage?.promptTokens ?? 0, completion: reply.usage?.completionTokens ?? 0 }, latencyMs: Date.now() - started, rulesAtRecording: rules });
  }
  const path = join(process.cwd(), "tests/core/fixtures/create/cedar-ridge-haiku.json");
  const fixture = JSON.parse(readFileSync(path, "utf8"));
  const recording = { recordedAt: new Date().toISOString(), model: replies.length ? env.OPENROUTER_MODEL : null, replies };
  if (allAngles) fixture.byEffort = { ...fixture.byEffort, [env.CREATIVE_REASONING_EFFORT]: recording };
  else fixture.painPointV738 = recording;
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
