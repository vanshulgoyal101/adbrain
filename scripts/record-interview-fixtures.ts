/**
 * Records real interview replies for the test:core stuck-Create case (#284): an offer
 * question answered with a "type it below" chip and nothing typed. Calls the configured
 * LLM providers; reads the Brand read-only; writes no data.
 *
 *   npx tsx --env-file=.env.local scripts/record-interview-fixtures.ts <business-id> [runs]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runInterview, type InterviewAnswer } from "@/lib/creative/interview";
import type { BrandContext } from "@/lib/templates/ads";

export const GOAL = "Ad for factory owners: from 31 Dec, non-DCR solar panels are banned and the cost goes up by more than 10,000 rupees per kW. Install before the deadline.";
export const NON_ANSWER: InterviewAnswer = {
  question: "What offer should the ad highlight for factory owners?",
  answer: "Custom offer (type it below)",
  questionId: "offer",
  field: "offer",
  options: ["Free site survey this week", "Lock in today's price", "Custom offer (type it below)"],
};

async function main() {
  const [businessId, runsArg] = process.argv.slice(2);
  if (!businessId) throw new Error("Pass a business ID.");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: brand, error } = await supabase.from("businesses")
    .select("name, vertical, description, brand_voice, target_audience, usps, offers, languages, locations")
    .eq("id", businessId).single();
  if (error) throw error;
  const replies: { turn: string; attempt: number; valid: boolean; rules: string[]; provider: string; model: string; content: string }[] = [];
  for (let run = 0; run < Number(runsArg ?? 3); run++) {
    for (const [turn, answers] of [["goal", []], ["non-answer", [NON_ANSWER]]] as const) {
      const result = await runInterview({ brand: brand as BrandContext, goal: GOAL, answers: [...answers] }, {
        onAttempt: async (completion, attempt, valid, rules = []) => {
          replies.push({ turn, attempt, valid, rules, provider: completion.provider, model: completion.model, content: completion.text });
        },
      }).catch((err: unknown) => ({ failed: err instanceof Error ? err.message : String(err) }));
      console.log(`${run} ${turn}: ${JSON.stringify(result).slice(0, 300)}`);
    }
  }
  writeFileSync(join(process.cwd(), "tests/core/fixtures/create/interview-non-answer.json"),
    `${JSON.stringify({ recordedAt: new Date().toISOString(), brand, goal: GOAL, nonAnswer: NON_ANSWER, replies }, null, 2)}\n`);
  console.log(replies.map((reply) => `${reply.turn}#${reply.attempt} ${reply.valid ? "valid" : `invalid ${reply.rules.join(",")}`} ${reply.model}`).join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
