/**
 * #738: records only the missing Create repair attempts in solaride-hindi.json. It replays the fixture's
 * own Brand, brief and recorded attempts through the real Create pipeline; a concept request with no
 * recorded reply goes to OpenRouter (Claude Haiku) and is appended, so its repair prompt is exactly
 * production's. Image requests are refused (text only, about $0.001 a reply); writes no data.
 *
 *   CREATIVE_PROVIDER_ORDER=openrouter OPENROUTER_MODEL=anthropic/claude-haiku-5.5 \
 *     npx tsx --env-file=.env.local scripts/record-hindi-create-repairs.ts hi:vague[:<angle name>:<attempt>] …
 *
 * With an angle and attempt, that angle's recorded replies from that attempt on are dropped first and
 * re-recorded: a stale repair whose prompt now carries different validation issues.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conceptValidationRules, validateConcept } from "@/lib/creative/concept";
import { generateVariants } from "@/lib/creative/generate";
import { languagePromptName } from "@/lib/languages";
import { parseJSON } from "@/lib/llm";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";

type Reply = { language: string; goal: string; phase: string; angle?: string; attempt: number; content: string; model: string; rulesAtRecording: string[] };

async function main() {
  const path = join(process.cwd(), "tests/core/fixtures/create/solaride-hindi.json");
  const fixture = JSON.parse(readFileSync(path, "utf8")) as {
    brand: BrandContext; recentCopy: { headline: string; primary_text: string }[];
    turns: { language: string; goal: string; result: { brief: string; sourceFacts: string[] } }[]; replies: Reply[];
  };
  const realFetch = globalThis.fetch;
  for (const target of process.argv.slice(2)) {
    const [language, goal, staleAngle, staleFrom] = target.split(":");
    if (staleAngle) {
      fixture.replies = fixture.replies.filter((reply) => !(reply.language === language && reply.goal === goal && reply.phase === "concept"
        && reply.angle === staleAngle && reply.attempt >= Number(staleFrom)));
    }
    const final = fixture.turns.filter((turn) => turn.language === language && turn.goal === goal).at(-1)!.result;
    const concepts = () => fixture.replies.filter((reply) => reply.language === language && reply.goal === goal && reply.phase === "concept");
    const served = new Map<string, number>();
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://openrouter.ai/api/v1/chat/completions")) return new Response("images are not recorded", { status: 503 });
      const body = String(init?.body ?? "");
      const angle = AD_ANGLES.map(({ name }) => name).find((name) => body.includes(name))!;
      const attempt = (served.get(angle) ?? 0) + 1;
      served.set(angle, attempt);
      const recorded = concepts().find((reply) => reply.angle === angle && reply.attempt === attempt);
      if (recorded) return Response.json({ id: "replay", model: recorded.model, choices: [{ message: { role: "assistant", content: recorded.content }, finish_reason: "stop" }] });
      const response = await realFetch(input, init);
      const json = await response.clone().json() as { model?: string; choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content ?? "";
      const angleSpec = AD_ANGLES.find(({ name }) => name === angle)!;
      let rules = ["invalid-json"];
      try {
        const result = validateConcept(parseJSON(content), { brand: fixture.brand, brief: final.brief, angle: angleSpec,
          language: languagePromptName(language), format: "portrait", recentCopy: fixture.recentCopy, sourceFacts: final.sourceFacts });
        rules = result.success ? [] : conceptValidationRules(result.issues);
      } catch { /* kept as invalid-json */ }
      fixture.replies.push({ language, goal, phase: "concept", angle, attempt, content, model: json.model ?? "anthropic/claude-haiku-5.5", rulesAtRecording: rules });
      console.log(`${language} ${goal} ${angle} #${attempt}: ${rules.join(",") || "valid"}`);
      return response;
    };
    await generateVariants({ brand: fixture.brand, brief: final.brief, count: 3, language: languagePromptName(language),
      format: "portrait", recentCopy: fixture.recentCopy, sourceFacts: final.sourceFacts, onFailure: async () => {} });
  }
  globalThis.fetch = realFetch;
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
