import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const origin = "https://adbrain.vanshul.com";
const model = "openai/gpt-image-2.5-flare";
const baselineId = "2eed374b-3a92-459a-877b-ded8b1c08c20";
const output = fileURLToPath(new URL("../.creative-evals/flare-2026-09-12/", import.meta.url));
const key = (process.env.OPENROUTER_API_KEYS ?? "").split(",")[0].trim();
const password = process.env.DEMO_USER_PASSWORD;
const reviewOnly = process.argv.includes("--review-only");
assert.ok(key && password, "Existing OpenRouter and demo credentials are required.");
assert.ok(reviewOnly || process.argv.includes("--authorized-one-image"), "Explicit paid-test authorization is required.");

async function keyUsage() {
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, "Key usage lookup failed.");
  const { data } = await response.json();
  return { usage: data.usage, limit: data.limit, remaining: data.limit_remaining };
}

await mkdir(output, { recursive: true, mode: 0o700 });
const report = reviewOnly ? JSON.parse(await readFile(`${output}report.json`, "utf8")) : { origin, model, baselineId, startedAt: new Date().toISOString(), generationId: crypto.randomUUID() };
assert.equal(report.model, model);
const save = () => writeFile(`${output}report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(30_000);
  let logins = 0;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      if (url.origin === origin && /^\/api\/(meta|cron|scheduler|campaigns)/.test(url.pathname)) return route.abort();
      return route.continue();
    }
    if (url.origin === process.env.NEXT_PUBLIC_SUPABASE_URL && url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password" && logins++ === 0) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(process.env.DEMO_USER_EMAIL ?? "demo@adbrain.vanshul.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  const authPromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/auth/v1/token" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in with password", exact: true }).click();
  const authResponse = await authPromise;
  assert.equal(authResponse.status(), 200, "Demo sign-in failed; credentials are not logged.");
  const session = await authResponse.json();
  await page.waitForURL((url) => url.origin === origin && !url.pathname.startsWith("/login"), { waitUntil: "load", timeout: 60_000 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: baseline, error } = await supabase.from("creatives").select("id,business_id,brief,generation").eq("id", baselineId).single();
  assert.equal(error, null, "Owner-scoped baseline lookup failed.");
  if (!reviewOnly) {
  report.baselineImage = baseline.generation.image;
  report.before = await keyUsage();
  assert.ok(report.before.remaining >= 0.5, "Less than $0.50 remains on the API key.");
  report.request = { businessId: baseline.business_id, brief: baseline.brief, count: 1, format: baseline.generation.format, language: baseline.generation.language, generationId: report.generationId };
  await writeFile(`${output}submitted-once.json`, JSON.stringify({ ...report, state: "submission-reserved" }), { flag: "wx", mode: 0o600 });
  await save();
  const started = Date.now();
  console.log("Submitting exactly one production creative request; count=1; no interview or retry.");
  try {
    const response = await context.request.post(`${origin}/api/creatives/generate`, { data: report.request, timeout: 310_000, maxRetries: 0 });
    report.httpStatus = response.status();
    report.result = await response.json();
  } catch (error) {
    report.transportError = String(error).slice(0, 400);
  }
  report.elapsedMs = Date.now() - started;
  report.after = await keyUsage();
  report.keyUsageDelta = report.after.usage - report.before.usage;
  await save();
  }
  const { data: saved, error: savedError } = await supabase.from("creatives").select("id,headline,status,image_url,generation").eq("business_id", baseline.business_id).eq("variant_group", report.generationId);
  assert.equal(savedError, null, "Owner-scoped persistence lookup failed.");
  report.saved = saved;
  await save();
  assert.equal(saved.length, 1, "Expected exactly one saved draft; do not repeat paid submission.");
  const creative = saved[0];
  assert.equal(creative.status, "draft");
  assert.equal(creative.generation.image.model, model, "Production did not use Flare.");
  assert.ok(Number.isFinite(creative.generation.image.estimatedCostUsd), "Image charge is missing.");
  const imageResponse = await context.request.get(creative.image_url);
  assert.equal(imageResponse.status(), 200);
  const image = await imageResponse.body();
  const metadata = await sharp(image).metadata();
  assert.ok(metadata.width > 0 && metadata.height > 0);
  await writeFile(`${output}creative.${metadata.format}`, image, { mode: 0o600 });
  report.outputImage = { width: metadata.width, height: metadata.height, bytes: image.length };
  report.creativeUrl = `${origin}/studio?creative=${creative.id}`;
  await save();
  await page.goto(report.creativeUrl, { waitUntil: "domcontentloaded" });
  await page.getByText(creative.headline, { exact: true }).first().waitFor();
  await page.locator("main img").evaluateAll((images) => images.forEach((image) => { image.loading = "eager"; }));
  await page.waitForFunction((imageUrl) => Array.from(document.querySelectorAll("main img")).some((image) => image.src === imageUrl && image.complete && image.naturalWidth > 0), creative.image_url, { timeout: 45_000 });
  report.studioImageLoaded = true;
  await page.screenshot({ path: `${output}studio.png`, fullPage: true });
  report.passed = true;
  console.log(JSON.stringify({ model, creativeId: creative.id, image: creative.generation.image, baselineImage: report.baselineImage, elapsedMs: report.elapsedMs, before: report.before, after: report.after, keyUsageDelta: report.keyUsageDelta, creativeUrl: report.creativeUrl, output }, null, 2));
} catch (error) {
  report.error = String(error).slice(0, 600);
  throw error;
} finally {
  await save();
  await browser.close();
}