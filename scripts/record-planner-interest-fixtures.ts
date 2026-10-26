/**
 * #686: records a real Groq planner reply under the current prompt and Meta's real interest search
 * for its names (read-only Graph search, no writes), for test:core. Groq is free; tokens are stripped.
 * MESSAGES_JSON holds the route's messages (captured from tests/core/campaign-prepare.test.ts, with
 * production brand facts swapped in).
 *
 *   MESSAGES_JSON=<file> npx tsx --env-file=.env.local scripts/record-planner-interest-fixtures.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLANNER_PROMPT_VERSION, plannerResultSchema } from "@/lib/campaign/planner";
import { complete, parseJSON } from "@/lib/llm";
import type { ChatMessage } from "@/lib/llm/types";
import { metaClientFromEnv } from "./lib/meta-env";

const { messages } = JSON.parse(readFileSync(process.env.MESSAGES_JSON!, "utf8")) as { messages: ChatMessage[] };
process.env.LLM_BUDGET_PROVIDER_ORDER = "groq";

async function main() {
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Set META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID and META_PAGE_ID in .env.local.");
  const reply = await complete(messages, { routing: "budget", task: "campaign planner", json: true, responseSchema: plannerResultSchema,
    cache: false, temperature: 0.2, maxTokens: 3000, thinking: "off" });
  const names = parseJSON<{ plan?: { interests?: string[] } }>(reply.text)?.plan?.interests ?? [];
  if (!names.length) throw new Error(`No interests in the reply: ${reply.text.slice(0, 200)}`);

  const tape: { method: string; path: string; status: number; body: unknown }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await realFetch(input, init);
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    url.searchParams.delete("appsecret_proof");
    tape.push({ method: init?.method ?? "GET", path: url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search, status: response.status, body: await response.clone().json() });
    return response;
  };
  const resolved = await meta.resolveAudienceInterests(names);
  globalThis.fetch = realFetch;
  console.log(reply.provider, reply.model, JSON.stringify(names), "->", JSON.stringify(resolved.interests.map((interest) => interest.name)));

  const dir = join(process.cwd(), "tests/core/fixtures");
  writeFileSync(join(dir, "planner/groq-meta-interest-names.json"), `${JSON.stringify({
    recordedAt: new Date().toISOString(), promptVersion: PLANNER_PROMPT_VERSION, model: reply.model, text: reply.text,
  }, null, 2)}\n`);
  writeFileSync(join(dir, "meta/interests-planner-v6.json"), `${JSON.stringify(tape, null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
