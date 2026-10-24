/**
 * #419: checks a planned campaign against Meta's new-advertiser guidance, offline.
 * By default it checks the payloads today's launch code sends (the launch gate's tape).
 *
 *   npx tsx scripts/plan-check.ts [--cost-per-result 69] [plan.json]
 *
 * plan.json: { "adSets": [<adsets POST form>], "creatives": [<adcreatives POST form>], "costPerResultRupees"?: number }
 * Exits 1 when a rule fails.
 */
import { readFileSync } from "node:fs";
import { checkPlan, type PlannedCampaign } from "@/lib/campaign/plan-check";

const args = process.argv.slice(2);
const costIndex = args.indexOf("--cost-per-result");
const cost = costIndex >= 0 ? Number(args.splice(costIndex, 2)[1]) : undefined;
const file = args[0];

type Exchange = { destination: string; kind: string; form: Record<string, string> };
const plans: [string, PlannedCampaign][] = file
  ? [[file, JSON.parse(readFileSync(file, "utf8")) as PlannedCampaign]]
  : (() => {
    const tape = (JSON.parse(readFileSync("tests/core/fixtures/meta/launch-validate.json", "utf8")) as { tape: Exchange[] }).tape;
    return ["instant_form", "whatsapp"].map((destination): [string, PlannedCampaign] => [`today's ${destination} launch`, {
      adSets: tape.filter((e) => e.destination === destination && e.kind === "adsets").map((e) => e.form),
      creatives: tape.filter((e) => e.destination === destination && e.kind === "adcreatives").map((e) => e.form),
    }]);
  })();

let failed = false;
for (const [label, plan] of plans) {
  console.log(`\n${label}`);
  for (const f of checkPlan({ ...plan, costPerResultRupees: cost ?? plan.costPerResultRupees })) {
    console.log(`  ${f.status.toUpperCase().padEnd(7)} ${f.rule}: ${f.detail}`);
    if (f.status === "fail") failed = true;
  }
}
process.exit(failed ? 1 : 0);
