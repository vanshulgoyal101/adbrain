/**
 * #366: records real planner replies from the budget route's fallbacks (Gemini 3.6 Flash with thinking
 * off, and OpenRouter Claude Haiku) for test:core, with latencies. Sends the exact messages the plan
 * route builds for the core test's Cedar Ridge case (captured from tests/core/campaign-prepare.test.ts).
 * Text only; writes no data.
 *
 *   MESSAGES_JSON=<file> npx tsx --env-file=.env.local scripts/record-planner-fallback-fixtures.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { plannerResultSchema } from "@/lib/campaign/planner";
import { complete, parseJSON } from "@/lib/llm";
import type { ChatMessage, CompletionOptions } from "@/lib/llm/types";

const { messages } = JSON.parse(readFileSync(process.env.MESSAGES_JSON!, "utf8")) as { messages: ChatMessage[] };
const base: CompletionOptions = { task: "campaign planner", json: true, responseSchema: plannerResultSchema, cache: false, temperature: 0.2, maxTokens: 3000 };

// getEnv() caches, so the budget order is blanked once and each sample names its provider.
process.env.LLM_BUDGET_PROVIDER_ORDER = " ";
process.env.OPENROUTER_MODEL = "anthropic/claude-haiku-5.5";

async function sample(label: string, provider: string, options: CompletionOptions) {
  const runs: { ms: number; valid: boolean; model: string; text: string; tokens?: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const started = Date.now();
    try {
      const result = await complete(messages, { ...base, ...options, extraProviders: [provider],
        onAttempt: (attempt) => { if (attempt.status === "error") console.log("  attempt", attempt.provider, attempt.failure, attempt.latencyMs, "ms"); } });
      const value = parseJSON<{ plan?: { radius_km?: unknown } }>(result.text);
      if (value?.plan && (value.plan.radius_km === 0 || value.plan.radius_km === null)) delete value.plan.radius_km;
      runs.push({ ms: Date.now() - started, valid: plannerResultSchema.safeParse(value).success, model: result.model, text: result.text, tokens: result.usage?.completionTokens });
    } catch (error) {
      const detail = error as { message?: string; code?: string; status?: number; cause?: { message?: string } };
      runs.push({ ms: Date.now() - started, valid: false, model: "error", text: `${detail.code ?? ""} ${detail.status ?? ""} ${detail.message ?? String(error)} ${detail.cause?.message ?? ""}`.slice(0, 300) });
    }
    console.log(label, runs.at(-1)!.ms, "ms", runs.at(-1)!.valid ? "valid" : "INVALID", runs.at(-1)!.model, runs.at(-1)!.tokens ?? "", "completion tokens", runs.at(-1)!.valid ? "" : runs.at(-1)!.text.slice(0, 160));
  }
  return runs;
}

async function main() {
  const only = process.env.ONLY;
  const skip = async () => [] as Awaited<ReturnType<typeof sample>>;
  const thinking = !only || only === "on" ? await sample("gemini thinking-on", "google", { routing: "budget", attemptTimeoutMs: 20_000 }) : await skip();
  const off = !only || only === "off" ? await sample("gemini thinking-off", "google", { routing: "budget", attemptTimeoutMs: 20_000, thinking: "off" }) : await skip();
  const haiku = !only || only === "haiku" ? await sample("openrouter haiku", "openrouter", { routing: "budget", attemptTimeoutMs: 20_000, thinking: "off" }) : await skip();
  const firstValid = (runs: typeof off) => runs.find((run) => run.valid);
  const out = {
    recordedAt: new Date().toISOString(),
    latencyMs: { geminiThinkingOn: thinking.map((r) => r.ms), geminiThinkingOff: off.map((r) => r.ms), openrouterHaiku: haiku.map((r) => r.ms) },
    geminiThinkingOff: { model: firstValid(off)?.model, text: firstValid(off)?.text },
    openrouterHaiku: { model: firstValid(haiku)?.model, text: firstValid(haiku)?.text },
  };
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
  else writeFileSync(join(process.cwd(), "tests/core/fixtures/planner/fallback-replies.json"), `${JSON.stringify(out, null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
