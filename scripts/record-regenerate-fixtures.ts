/**
 * Records real Regenerate concept replies for test:core (#281). Rebuilds the route's input for
 * one saved ad (Brand, brief, saved source facts, current and recent copy) and runs Create's
 * concept loop; image requests are refused, so only text is paid. Reads read-only; writes no data.
 *
 *   OPENROUTER_MODEL=anthropic/claude-haiku-5.5 CREATIVE_PROVIDER_ORDER=openrouter \
 *     npx tsx --env-file=.env.local scripts/record-regenerate-fixtures.ts <creative-id> [runs]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { conceptValidationRules, validateConcept } from "@/lib/creative/concept";
import { CreativeImageError, CreativeValidationError, generateOneVariant } from "@/lib/creative/generate";
import { savedGenerationSettings } from "@/lib/creative/receipt";
import { creativeReferences, recentCreativeCopy } from "@/lib/creative/references";
import { parseJSON } from "@/lib/llm";
import { preferenceContext } from "@/lib/preferences/store";
import { AD_ANGLES, getAngleByName, type BrandContext } from "@/lib/templates/ads";
import type { Database } from "@/lib/types";

const TEXT_URLS = ["https://openrouter.ai/api/v1/chat/completions", "https://api.groq.com/", "https://generativelanguage.googleapis.com/"];
const IMAGE_URLS = ["https://openrouter.ai/api/v1/images", "https://fal.run/", "https://api.openai.com/", "https://image.pollinations.ai/"];

async function main() {
  const [creativeId, runsArg] = process.argv.slice(2);
  if (!creativeId) throw new Error("Pass a creative ID.");
  const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: creative, error } = await supabase.from("creatives")
    .select("business_id, angle, brief, headline, primary_text, generation").eq("id", creativeId).single();
  if (error) throw error;
  const { data: brand, error: brandError } = await supabase.from("businesses")
    .select("name, vertical, description, brand_voice, target_audience, usps, offers, languages, locations")
    .eq("id", creative.business_id).single();
  if (brandError) throw brandError;
  const { data: rules } = await supabase.from("ad_instructions")
    .select("title, content, is_active").eq("business_id", creative.business_id).order("created_at", { ascending: true });
  const instructions = (rules ?? []).filter((rule) => rule.is_active)
    .map((rule) => `## ${rule.title}\n${rule.content}`).join("\n\n").slice(0, 6000);
  const [referenceImages, recent] = await Promise.all([
    creativeReferences(supabase, creative.business_id),
    recentCreativeCopy(supabase, creative.business_id),
  ]);
  const settings = savedGenerationSettings(creative.generation);
  const advisoryPreferences = await preferenceContext(creative.business_id, "creative", [creative.brief, instructions].filter(Boolean).join("\n"));
  const angle = getAngleByName(creative.angle ?? "") ?? AD_ANGLES[0];
  const recentCopy = [{ headline: creative.headline ?? "", primary_text: creative.primary_text ?? "" }, ...recent].slice(0, 12);
  const input = {
    brand: brand as BrandContext, brief: creative.brief, angle, instructions,
    language: settings.language ?? undefined, format: settings.format, referenceImages,
    recentCopy, advisoryPreferences, sourceFacts: settings.sourceFacts,
  };

  const replies: { run: number; attempt: number; provider: string; model: string; content: string; rulesOnMain: string[] }[] = [];
  const realFetch = globalThis.fetch;
  let run = 0;
  let attempt = 0;
  globalThis.fetch = async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    if (IMAGE_URLS.some((prefix) => url.startsWith(prefix))) throw new Error("Recorder: images are not generated.");
    const response = await realFetch(request, init);
    if (!TEXT_URLS.some((prefix) => url.startsWith(prefix))) return response;
    const body = await response.clone().json().catch(() => null) as { model?: string; choices?: { message?: { content?: string } }[] } | null;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      let value: unknown;
      try { value = parseJSON<unknown>(content); } catch { value = undefined; }
      const result = value === undefined ? null : validateConcept(value, input);
      replies.push({
        run, attempt: ++attempt, provider: new URL(url).hostname, model: body?.model ?? "unknown", content,
        rulesOnMain: result === null ? ["invalid-json"] : result.success ? [] : conceptValidationRules(result.issues),
      });
    }
    return response;
  };

  for (; run < Number(runsArg ?? 3); run++) {
    attempt = 0;
    const outcome = await generateOneVariant(input.brand, input.brief, angle, instructions, input.language, input.format,
      referenceImages, undefined, recentCopy, advisoryPreferences, input.sourceFacts)
      .then(() => "saved", (err: unknown) => err instanceof CreativeImageError ? "concept passed (image refused)"
        : err instanceof CreativeValidationError ? `rejected: ${err.issues.join(" | ")}` : `failed: ${err instanceof Error ? err.message : err}`);
    console.log(`run ${run}: ${outcome}`);
  }
  globalThis.fetch = realFetch;

  writeFileSync(join(process.cwd(), "tests/core/fixtures/create/solaride-regenerate.json"), `${JSON.stringify({
    recordedAt: new Date().toISOString(),
    brand, brief: creative.brief, angle: angle.name, instructions, language: input.language ?? null, format: input.format,
    referenceImageCount: referenceImages.length, sourceFacts: input.sourceFacts, recentCopy, replies,
  }, null, 2)}\n`);
  console.log(replies.map((reply) => `${reply.run}#${reply.attempt} ${reply.rulesOnMain.join(",") || "valid"} ${reply.model}`).join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
