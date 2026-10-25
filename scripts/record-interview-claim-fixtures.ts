/**
 * #613: records real interview replies that the commercial-claim rule rejects, for a Brand with no
 * offers (production business 2439a215 had 2 such failures in 72 h). Budget routing only (free
 * providers); reads the Brand read-only; writes no data. Stops once it has `want` rejected replies.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-interview-claim-fixtures.ts <business-id> [want] [maxRuns]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runInterview } from "@/lib/creative/interview";
import type { BrandContext } from "@/lib/templates/ads";

export const CLAIM_GOAL = "Get more homeowners in Mohali to enquire about rooftop solar this month.";

async function main() {
  const [businessId, wantArg, runsArg] = process.argv.slice(2);
  if (!businessId) throw new Error("Pass a business ID.");
  // BRAND_JSON: the Brand read beforehand (e.g. read-only from production); else read here.
  const brand = process.env.BRAND_JSON ? JSON.parse(readFileSync(process.env.BRAND_JSON, "utf8")) : await (async () => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data, error } = await supabase.from("businesses")
      .select("name, vertical, description, brand_voice, target_audience, usps, offers, languages, locations")
      .eq("id", businessId).single();
    if (error) throw error;
    return data;
  })();
  const replies: { run: number; attempt: number; valid: boolean; rules: string[]; provider: string; model: string; content: string }[] = [];
  const want = Number(wantArg ?? 2);
  for (let run = 0; run < Number(runsArg ?? 8) && replies.filter((reply) => reply.rules.includes("unsupported-commercial-claim")).length < want; run++) {
    const result = await runInterview({ brand: brand as BrandContext, goal: CLAIM_GOAL, answers: [] }, {
      onAttempt: async (completion, attempt, valid, rules = []) => {
        replies.push({ run, attempt, valid, rules, provider: completion.provider, model: completion.model, content: completion.text });
      },
    }).catch((err: unknown) => ({ failed: err instanceof Error ? err.name : String(err) }));
    console.log(`${run}: ${JSON.stringify(result).slice(0, 200)}`);
  }
  writeFileSync(join(process.cwd(), "tests/core/fixtures/create/interview-claims.json"), `${JSON.stringify({
    recordedAt: new Date().toISOString(), note: "#613: real interview replies for a Brand with no offers (free providers, budget routing).",
    brand, goal: CLAIM_GOAL, replies,
  }, null, 2)}\n`);
  console.log(`replies ${replies.length}, rejected for claims ${replies.filter((reply) => reply.rules.includes("unsupported-commercial-claim")).length}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
