#!/usr/bin/env node
// Judge-accuracy eval: score hand-labeled ad creatives with a judge LLM and
// report mean absolute error vs the gold labels. Pass criterion: MAE <= 0.15.
// Usage: GOOGLE_AI_API_KEYS=key node scripts/eval-creative.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const KEY = (process.env.GOOGLE_AI_API_KEYS ?? "").split(",")[0]?.trim();
const MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
if (!KEY) {
  console.error("Set GOOGLE_AI_API_KEYS to run the creative eval.");
  process.exit(1);
}

const RUBRIC = `You are grading a local-business ad creative on a 1-5 scale.
5 = specific, on-brand, clear CTA, no clichés, sounds human.
1 = generic AI slop, clichés, shouting, vague.
Return ONLY JSON: {"score": <1-5>}.`;

async function judge(row) {
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${RUBRIC}\n\nBrief: ${row.brief}\nHeadline: ${row.headline}\nBody: ${row.primary_text}\nCTA: ${row.cta}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
      maxOutputTokens: 3200,
    },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return Number(JSON.parse(text).score);
}

const rows = readFileSync(join(__dir, "../evals/creative/fixtures.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

let sumErr = 0;
for (const row of rows) {
  const score = await judge(row);
  const err = Math.abs(score - row.gold_score) / 4; // normalise 1-5 -> 0..1
  sumErr += err;
  console.log(
    `gold=${row.gold_score} judge=${score} err=${err.toFixed(3)}  "${row.headline.slice(0, 40)}"`,
  );
}
const mae = sumErr / rows.length;
console.log(`\nMAE = ${mae.toFixed(3)}  (${mae <= 0.15 ? "PASS" : "FAIL"}, threshold 0.15)`);
process.exit(mae <= 0.15 ? 0 : 1);
