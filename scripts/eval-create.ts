/**
 * Create eval gate (#418): runs the frozen cases in tests/eval/cases.json through the production
 * Create pipeline (concepts, fact check, image, overlay) and scores each run: 3 of 3 saved,
 * first-try passes, offer in the first 125 characters, post text in the chosen script, cost,
 * latency, and a blind judge on the post text and the finished ad image. The judge's copy score is
 * first calibrated on the gold-labelled evals/creative fixtures (pass: MAE <= 0.15).
 *
 * --profile paid (default): production's models on OpenRouter, about $0.05 per case plus judge calls;
 * stops before --cap-usd (default 5), never touches the free Groq/Gemini keys (#410).
 * --profile free: the $0 gate for generation changes (CTO, Oct 25): Gemini then Groq on the free keys,
 * Pollinations images, OpenRouter switched off. Runs the two gate cases (English, Hindi) with no judge
 * (--judge adds it) and compares only the deterministic copy checks with tests/eval/baseline-free.json.
 *
 *   npx tsx --env-file=.env.local scripts/eval-create.ts [--profile free] [--cases id,id] [--repeat 2] [--write-baseline] [--no-judge | --judge]
 *
 * Without --write-baseline it compares with its profile's baseline and exits 1 when a customer
 * would see something worse (the upgrade-only gate). Bake-off: set EVAL_TEXT_MODEL,
 * EVAL_IMAGE_MODEL or EVAL_JUDGE_MODEL; EVAL_SCHEDULE=serial runs the paid profile one concept at a time (#713). Report and rendered ads go to /tmp/adbrain-eval/<time>/.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { BrandContext } from "@/lib/templates/ads";
import {
  compareSummaries, expectedScript, inconclusive, offerInFold, summarize, textScript,
  type AdResult, type CaseResult, type JudgeScore,
} from "./lib/eval-create-score";
import { evalProfile } from "./lib/eval-profile";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };

const OPENROUTER_KEY = (process.env.OPENROUTER_API_KEYS ?? "").split(",")[0]?.trim();
const GOOGLE_KEY = (process.env.GOOGLE_AI_API_KEYS ?? "").split(",")[0]?.trim();
// Production Create settings (llm_usage_events, Oct 24), pinned over any stale .env.local value,
// before the pipeline reads its environment.
const { settings, env: profileEnv } = evalProfile(option("profile") ?? "paid", process.env);
Object.assign(process.env, profileEnv);
const FREE = settings.profile === "free";

const ROOT = process.cwd();
const BASELINE = join(ROOT, settings.baseline);
const CAP_USD = Number(option("cap-usd") ?? 5);
const REPEAT = Math.max(1, Number(option("repeat") ?? 1));
if (!FREE && !OPENROUTER_KEY) throw new Error("Set OPENROUTER_API_KEYS (run with --env-file=.env.local).");
if (FREE && !GOOGLE_KEY) throw new Error("Set GOOGLE_AI_API_KEYS (run with --env-file=.env.local).");

type EvalCase = { id: string; language: string; source: string; brand: BrandContext; brief: string; sourceFacts: string[]; offerTerms: string[] };
const allCases = (JSON.parse(readFileSync(join(ROOT, "tests/eval/cases.json"), "utf8")) as { cases: EvalCase[] }).cases;
const only = option("cases")?.split(",") ?? settings.gateCases ?? undefined;
const cases = only ? allCases.filter((item) => only.includes(item.id)) : allCases;

const COPY_RUBRIC = `5 = specific, on-brand, clear CTA, no clichés, sounds human.
1 = generic AI slop, clichés, shouting, vague.`;
const JUDGE_RUBRIC = `You grade one Facebook/Instagram ad for a local business. You get the business's facts, the brief,
the post text and the finished ad image. You do not know who or what wrote it.
Score from 1 to 5:
- copy (post text, headline and CTA): ${COPY_RUBRIC}
- image (the finished ad): 5 = looks professional and fits the business; any text on it is correctly spelt,
  legible and fully visible. 1 = garbled, misspelt or cut-off text, or a picture unrelated to the business.
inventedClaims: each offer, price, number, guarantee or service in the post text or on the image that the facts
and brief do not support (empty if none).
imageTextErrors: each misspelt, garbled, broken-script or cut-off piece of text on the image (empty if none).
Return only JSON: {"copy": 1-5, "image": 1-5, "inventedClaims": [string], "imageTextErrors": [string]}`;
const judgeSchema = z.object({
  copy: z.coerce.number().min(1).max(5),
  image: z.coerce.number().min(1).max(5),
  inventedClaims: z.array(z.string()).default([]),
  imageTextErrors: z.array(z.string()).default([]),
});

let spentUsd = 0;
let prices: Record<string, { prompt: number; completion: number }> = {};

async function loadPrices() {
  if (FREE) return;
  // The key is shared with production (#449): never let an eval spend production's headroom.
  const key = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${OPENROUTER_KEY}` } });
  const { data: limits } = await key.json() as { data?: { limit?: number | null; limit_remaining?: number | null } };
  if (limits?.limit != null && (limits.limit_remaining ?? 0) < CAP_USD + 2) {
    throw new Error(`The OpenRouter key has $${(limits.limit_remaining ?? 0).toFixed(2)} left; this run needs its $${CAP_USD} cap plus $2 kept for production. Lower --cap-usd or raise the key limit.`);
  }
  const response = await fetch("https://openrouter.ai/api/v1/models");
  const { data } = await response.json() as { data: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
  prices = Object.fromEntries(data.map((model) => [model.id, { prompt: Number(model.pricing?.prompt ?? 0), completion: Number(model.pricing?.completion ?? 0) }]));
  for (const model of [settings.textModel, settings.judgeModel]) if (!prices[model]) throw new Error(`OpenRouter has no model ${model}.`);
}

function textCost(entries: { model: string; usage: { promptTokens: number; completionTokens: number } }[]): number {
  return entries.reduce((sum, entry) => {
    const price = prices[entry.model] ?? { prompt: 0, completion: 0 };
    return sum + entry.usage.promptTokens * price.prompt + entry.usage.completionTokens * price.completion;
  }, 0);
}

/** One judge call: a prompt and, for an ad, its image; free runs ask Google directly at $0. */
async function judgeJSON(text: string, jpeg: Buffer | null, maxTokens: number): Promise<{ value: unknown; costUsd: number }> {
  return FREE ? googleJSON(text, jpeg, maxTokens) : openRouterJSON([
    { type: "text", text },
    ...(jpeg ? [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } }] : []),
  ], maxTokens);
}

async function googleJSON(text: string, jpeg: Buffer | null, maxTokens: number): Promise<{ value: unknown; costUsd: number }> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${settings.judgeModel}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GOOGLE_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }, ...(jpeg ? [{ inline_data: { mime_type: "image/jpeg", data: jpeg.toString("base64") } }] : [])] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: maxTokens * 4 },
      }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    const body = await response?.json().catch(() => ({})) as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | undefined;
    const reply = body?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    try {
      return { value: JSON.parse(reply.replace(/^\s*```(?:json)?|```\s*$/g, "")), costUsd: 0 };
    } catch {
      // The free tier rate-limits: wait and try again rather than lose the score.
      if (attempt < 6) { await new Promise((resolve) => setTimeout(resolve, 10_000 * attempt)); continue; }
      throw new Error(`Judge returned no JSON (${response ? `HTTP ${response.status}` : "timeout"}).`);
    }
  }
}

async function openRouterJSON(content: unknown[], maxTokens: number): Promise<{ value: unknown; costUsd: number }> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json", "X-Title": "AdBrain eval" },
      body: JSON.stringify({
        model: settings.judgeModel, temperature: 0, max_tokens: maxTokens, usage: { include: true },
        response_format: { type: "json_object" }, messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number } };
    const costUsd = body.usage?.cost ?? textCost([{ model: settings.judgeModel, usage: { promptTokens: body.usage?.prompt_tokens ?? 0, completionTokens: body.usage?.completion_tokens ?? 0 } }]);
    spentUsd += costUsd;
    const text = body.choices?.[0]?.message?.content ?? "";
    try {
      return { value: JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, "")), costUsd };
    } catch {
      if (!response.ok && attempt < 3) { await new Promise((resolve) => setTimeout(resolve, 5_000 * attempt)); continue; }
      if (attempt >= 2) throw new Error(`Judge returned no JSON (HTTP ${response.status}).`);
    }
  }
}

/** Mean absolute error of the judge's copy score against the gold labels, normalised to 0..1. */
async function calibrateJudge() {
  const rows = readFileSync(join(ROOT, "evals/creative/fixtures.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  let error = 0;
  for (const row of rows) {
    const { value } = await judgeJSON(`Grade this local-business ad's copy from 1 to 5.\n${COPY_RUBRIC}\nReturn only JSON: {"copy": 1-5}\n\nBrief: ${row.brief}\nHeadline: ${row.headline}\nBody: ${row.primary_text}\nCTA: ${row.cta}`, null, 800);
    error += Math.abs(Number((value as { copy?: number }).copy) - row.gold_score) / 4;
  }
  return { model: settings.judgeModel, cases: rows.length, mae: Number((error / rows.length).toFixed(3)) };
}

async function judge(item: EvalCase, ad: AdResult, png: Uint8Array): Promise<JudgeScore> {
  const jpeg = await sharp(Buffer.from(png)).resize(768).jpeg({ quality: 82 }).toBuffer();
  const brand = item.brand;
  const facts = [brand.description, ...(brand.usps ?? []), ...(brand.offers ?? []), ...item.sourceFacts].filter(Boolean).map((fact) => `- ${fact}`).join("\n");
  const { value } = await judgeJSON(`${JUDGE_RUBRIC}\n\nBusiness: ${brand.name} (${(brand.locations ?? []).join(", ")})\nFacts:\n${facts}\n\nBrief: ${item.brief}\n\nHeadline: ${ad.headline}\nPost text:\n${ad.primaryText}\nCTA: ${ad.cta}`, jpeg, 1500);
  return judgeSchema.parse(value);
}

async function main() {
  await loadPrices();
  const { generateVariants, CreativeValidationError } = await import("@/lib/creative/generate");
  const { renderCompositeAd } = await import("@/lib/creative/render");
  const { languagePromptName } = await import("@/lib/languages");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = option("out") ?? join("/tmp/adbrain-eval", stamp);
  mkdirSync(outDir, { recursive: true });
  const judging = flag("judge") || (settings.judgeByDefault && !flag("no-judge"));
  const judgeCalibration = judging ? await calibrateJudge() : null;
  if (judgeCalibration) console.log(`judge ${judgeCalibration.model}: MAE ${judgeCalibration.mae} on ${judgeCalibration.cases} gold ads${judgeCalibration.mae > 0.15 ? " (above 0.15: do not trust its scores)" : ""}`);

  const results: CaseResult[] = [];
  for (const item of cases.flatMap((entry) => Array.from({ length: REPEAT }, () => entry))) {
    if (spentUsd + 0.3 > CAP_USD) { console.log(`stopping before ${item.id}: $${spentUsd.toFixed(2)} spent, cap $${CAP_USD}`); break; }
    const ads: { ad: AdResult; png: Uint8Array }[] = [];
    const failures: CaseResult["failures"] = [];
    let failedCost = 0;
    const started = Date.now();
    await generateVariants({
      brand: item.brand, brief: item.brief, count: 3, language: languagePromptName(item.language),
      format: "portrait", sourceFacts: item.sourceFacts,
      onVariant: async (variant) => {
        const png = await renderCompositeAd({ ...variant.design, backgroundUrl: variant.imageUrl });
        const answered = variant.llmUsage.filter((entry) => entry.status !== "error");
        const costUsd = textCost(variant.llmUsage) + (variant.imageUsage.estimatedCostUsd ?? 0);
        ads.push({ png, ad: {
          angle: variant.angleId, headline: variant.headline, primaryText: variant.primaryText, cta: variant.cta,
          textModels: variant.llmUsage.map((entry) => entry.model), attempts: answered.length,
          firstTry: answered.length === 1 && !variant.llmUsage.some((entry) => entry.validation),
          rejectedRules: variant.llmUsage.flatMap((entry) => entry.validation?.rules ?? []),
          offerInFold: offerInFold(variant.primaryText, item.offerTerms),
          scriptOk: textScript(variant.primaryText) === expectedScript(item.language),
          costUsd: Number(costUsd.toFixed(5)),
        } });
      },
      onFailure: async (angle, error) => {
        const usage = error instanceof CreativeValidationError ? error.usage : [];
        failedCost += textCost(usage);
        failures.push({
          angle: angle.id,
          stage: error instanceof CreativeValidationError ? error.stage : "image",
          rules: usage.flatMap((entry) => entry.validation?.rules ?? []),
          issues: (error instanceof CreativeValidationError ? error.issues : [error instanceof Error ? error.message : String(error)]).map((issue) => issue.slice(0, 200)),
        });
      },
    });
    const wallMs = Date.now() - started;
    const costUsd = ads.reduce((sum, { ad }) => sum + ad.costUsd, 0) + failedCost;
    spentUsd += costUsd;
    for (const [index, { ad, png }] of ads.entries()) {
      await sharp(Buffer.from(png)).resize(720).webp({ quality: 80 }).toFile(join(outDir, `${item.id}-${results.length + 1}-${index + 1}.webp`));
      if (judging) ad.judge = await judge(item, ad, png);
    }
    results.push({ id: item.id, language: item.language, saved: ads.length, expected: 3, failures, ads: ads.map(({ ad }) => ad), costUsd: Number(costUsd.toFixed(5)), wallMs });
    const scores = ads.map(({ ad }) => ad.judge ? `${ad.judge.copy}/${ad.judge.image}` : "-").join(" ");
    console.log(`${item.id}: ${ads.length}/3 in ${(wallMs / 1000).toFixed(0)} s, $${costUsd.toFixed(3)}, judge copy/image ${scores}${failures.length ? `, failed ${failures.map((failure) => `${failure.angle}:${failure.rules.join("+") || failure.stage}`).join(", ")}` : ""}`);
  }

  const summary = summarize(results);
  const report = {
    version: 1, ranAt: new Date().toISOString(), commit: execSync("git rev-parse --short HEAD").toString().trim(),
    settings: { ...settings, repeat: REPEAT }, judgeCalibration, spentUsd: Number(spentUsd.toFixed(4)), summary, cases: results,
  };
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${JSON.stringify(summary, null, 2)}\nspent $${spentUsd.toFixed(3)} (cap $${CAP_USD}); report and ads in ${outDir}`);

  if (flag("write-baseline")) {
    const expected = settings.gateCases ?? allCases.map((item) => item.id);
    if (option("cases") || results.length < expected.length * REPEAT) throw new Error("A baseline needs every gate case, every repeat; run without --cases and under the cap.");
    const limitedRun = inconclusive(summary);
    if (limitedRun) throw new Error(`Not a baseline: ${limitedRun}.`);
    writeFileSync(BASELINE, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`baseline written to ${BASELINE}`);
    return;
  }
  if (!existsSync(BASELINE)) {
    console.log(`\nNo baseline at ${settings.baseline} yet: record one with --write-baseline.`);
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as typeof report;
  const ids = new Set(results.map((result) => result.id));
  const before = only ? summarize(baseline.cases.filter((result) => ids.has(result.id))) : baseline.summary;
  const { verdict, regressions } = compareSummaries(before, summary, { deterministic: settings.deterministic });
  console.log(`\nvs baseline ${baseline.commit} (${baseline.settings.textModel}, ${baseline.settings.imageModel}): ${verdict.toUpperCase()}`);
  for (const line of regressions) console.log(`  worse: ${line}`);
  if (verdict === "fail") process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
