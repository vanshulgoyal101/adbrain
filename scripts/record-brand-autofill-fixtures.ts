/**
 * Records a real website page and the real brand-extraction reply for the test:core Brand autofill
 * case (#650). Fetches one public page through the route's SSRF-safe fetch and asks the configured
 * budget providers (free tiers) once; writes no data. Scripts, styles and SVGs are dropped from the
 * saved page: the route removes them before reading, and the script checks the text and phone match.
 *
 *   npx tsx --env-file=.env.local scripts/record-brand-autofill-fixtures.ts [url]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "node-html-parser";
import { BRAND_EXTRACTION, extractPhone, extractWebsiteText } from "@/lib/brand/autofill";
import { completeJSON } from "@/lib/llm";
import type { CompletionResult, ProviderAttempt } from "@/lib/llm/types";
import { fetchPublicUrlText, parsePublicUrl } from "@/lib/security/ssrf";
import { buildBrandExtractionMessages, type BrandExtraction } from "@/lib/templates/ads";

async function main() {
  const url = parsePublicUrl(process.argv[2] ?? "https://solaride.in");
  if (!url) throw new Error("That URL is not allowed.");
  const html = await fetchPublicUrlText(url.toString(), {
    headers: { "User-Agent": "AdBrainBot/1.0 (+https://adbrain.vanshul.com)" },
    timeoutMs: 10_000,
  });
  const root = parse(html);
  root.querySelectorAll("script, style, noscript, svg").forEach((node) => node.remove());
  const page = root.toString();
  const text = extractWebsiteText(html);
  if (extractWebsiteText(page) !== text || extractPhone(page) !== extractPhone(html)) {
    throw new Error("The saved page would read differently from the fetched one.");
  }
  const attempts: ProviderAttempt[] = [];
  const extraction = await completeJSON<BrandExtraction>(buildBrandExtractionMessages(text, url.toString()), {
    ...BRAND_EXTRACTION, onAttempt: (attempt) => attempts.push(attempt),
  });
  const completion = (extraction as unknown as { __completion: CompletionResult }).__completion;
  const dir = join(process.cwd(), "tests/core/fixtures/brand");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "autofill-solaride.json"), `${JSON.stringify({
    recordedAt: new Date().toISOString(), url: url.toString(), page,
    reply: { provider: completion.provider, model: completion.model, content: completion.text, usage: completion.usage },
    attempts,
  }, null, 2)}\n`);
  console.log(`${page.length} chars saved (${html.length} fetched), ${text.length} chars of text, phone ${extractPhone(html) ?? "none"}`);
  console.log(attempts.map((attempt) => `${attempt.provider} ${attempt.model} ${attempt.status}${attempt.failure ? ` ${attempt.failure}` : ""}`).join("\n"));
  console.log(JSON.stringify(extraction, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
