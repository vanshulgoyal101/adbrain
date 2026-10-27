import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { policyFindings } from "@/lib/creative/policy-rules";

// #941 rule 8 (Analyst, Oct 26): zero-cost, result-or-refund and timed-result promises. Every new hit forces a
// repair (~10 s, #713), so the rule must stay quiet on what Create's models really write: every recorded
// concept reply in the Create fixtures (Haiku, Groq, Hindi/Hinglish Solaride, eval runs) is scanned here.
const dir = join(__dirname, "fixtures/create");
const RULE8 = /zero-cost|result-or-refund|timed result/;

function copies(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    const json = node.replace(/^```json\s*|\s*```\s*$/g, "");
    if (json.startsWith("{") && json.includes("primary_text")) {
      try { copies(JSON.parse(json), out); } catch { /* a truncated recording, not a concept */ }
    }
  } else if (Array.isArray(node)) node.forEach((item) => copies(item, out));
  else if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record.primary_text === "string") {
      out.push([record.headline, record.primary_text, record.supportingText, record.description].filter((v) => typeof v === "string").join("\n"));
    }
    Object.values(record).forEach((value) => copies(value, out));
  }
  return out;
}

const recorded = readdirSync(dir).filter((file) => file.endsWith(".json"))
  .flatMap((file) => copies(JSON.parse(readFileSync(join(dir, file), "utf8"))).map((copy) => ({ file, copy })));

describe("core: rule-8 promises on recorded Create replies (#941)", () => {
  it("finds no zero-cost, refund or timed-result promise in any recorded reply", () => {
    expect(recorded.length, "recorded replies").toBeGreaterThan(40);
    const hits = recorded.flatMap(({ file, copy }) =>
      ["solar energy", "chiropractic clinic"].flatMap((vertical) => policyFindings(copy, { vertical })).filter((finding) => RULE8.test(finding.fix)).map((finding) => `${file}: ${finding.detail}`));
    expect(hits).toEqual([]);
  });

  it("refuses a recorded reply once it adds such a promise", () => {
    const solar = recorded.find(({ file }) => file === "solaride-hindi.json")!;
    for (const promise of ["Zero investment rooftop solar.", "No savings, no fee.", "Results in 7 days."]) {
      expect(policyFindings(`${promise}\n${solar.copy}`, { vertical: "solar energy" }).map((finding) => finding.rule), promise).toContain("exaggerated-result");
    }
  });
});
