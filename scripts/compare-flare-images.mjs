import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const output = fileURLToPath(new URL("../.creative-evals/flare-comparison-2026-09-13/", import.meta.url));
const model = "openai/gpt-image-2.5-flare";
const key = (process.env.OPENROUTER_API_KEYS ?? "").split(",")[0].trim();
const generate = process.argv.includes("--generate-three");
assert.ok(key, "Existing OpenRouter key required.");
await mkdir(output, { recursive: true, mode: 0o700 });

async function usage() {
  const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200);
  const { data } = await response.json();
  return { used: data.usage, remaining: data.limit_remaining, limit: data.limit };
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, "Image download failed.");
  const bytes = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(bytes).metadata();
  assert.ok(metadata.width && metadata.height);
  return bytes;
}

if (!generate) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: login } = await client.auth.signInWithPassword({ email: process.env.DEMO_USER_EMAIL ?? "demo@adbrain.vanshul.com", password: process.env.DEMO_USER_PASSWORD });
  assert.equal(login, null, "Demo sign-in failed.");
  const { data, error } = await client.from("creatives").select("id,headline,angle,image_url,generation").order("created_at", { ascending: false }).limit(60);
  assert.equal(error, null);
  const angles = new Set();
  const selected = data.filter((creative) => {
    if (creative.generation?.image?.model !== "openai/gpt-image-2" || !creative.generation.imagePrompt || angles.has(creative.angle)) return false;
    angles.add(creative.angle);
    return true;
  }).slice(0, 3);
  assert.equal(selected.length, 3, "Three distinct historical angles are required.");
  const discovery = await fetch(`https://openrouter.ai/api/v1/images/models/${model}/endpoints`);
  assert.equal(discovery.status, 200);
  const { endpoints } = await discovery.json();
  const endpoint = endpoints.find((entry) => entry.provider_tag === "openai");
  assert.ok(endpoint?.supported_parameters.quality.values.includes("medium"));
  const samples = [];
  for (const [index, creative] of selected.entries()) {
    const objectPath = decodeURIComponent(new URL(creative.image_url).pathname.split("/object/public/creatives/")[1]);
    assert.ok(objectPath);
    const folder = objectPath.slice(0, objectPath.lastIndexOf("/"));
    const filename = objectPath.slice(objectPath.lastIndexOf("/") + 1);
    const prefix = filename.split("-ad-")[0];
    const { data: files, error: listError } = await client.storage.from("creatives").list(folder, { limit: 100 });
    assert.equal(listError, null);
    const sources = files.filter((file) => file.name.startsWith(`${prefix}-`) && !file.name.includes("-ad-"));
    assert.equal(sources.length, 1, "Source photo must be unambiguous.");
    const sourceUrl = client.storage.from("creatives").getPublicUrl(`${folder}/${sources[0].name}`).data.publicUrl;
    await writeFile(`${output}${index + 1}-old.png`, await sharp(await download(sourceUrl)).png().toBuffer(), { mode: 0o600 });
    const oldImage = creative.generation.image;
    const target = oldImage.width / oldImage.height;
    const ratios = endpoint.supported_parameters.aspect_ratio.values.filter((ratio) => /^\d+:\d+$/.test(ratio));
    const distance = (ratio) => { const [width, height] = ratio.split(":").map(Number); return Math.abs(Math.log(width / height / target)); };
    const aspectRatio = ratios.sort((left, right) => distance(left) - distance(right))[0];
    const references = creative.generation.referenceImages ?? [];
    assert.ok(references.length <= endpoint.supported_parameters.input_references.max);
    for (const reference of references) await download(reference);
    samples.push({ id: creative.id, headline: creative.headline, angle: creative.angle, oldImage, sourceUrl, request: { model, prompt: creative.generation.imagePrompt, quality: "medium", aspect_ratio: aspectRatio, n: 1, provider: { only: ["openai"], allow_fallbacks: false }, ...(references.length ? { input_references: references.map((url) => ({ type: "image_url", image_url: { url } })) } : {}) } });
  }
  await writeFile(`${output}plan.json`, JSON.stringify({ model, preparedAt: new Date().toISOString(), samples }, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ mode: "prepare-only", budget: await usage(), samples: samples.map(({ id, headline, angle, oldImage, request }) => ({ id, headline, angle, oldImage, aspectRatio: request.aspect_ratio, references: request.input_references?.length ?? 0 })), output }, null, 2));
} else {
  const plan = JSON.parse(await readFile(`${output}plan.json`, "utf8"));
  assert.equal(plan.model, model);
  assert.equal(plan.samples.length, 3);
  const before = await usage();
  assert.ok(before.remaining >= 0.5, "Insufficient key headroom.");
  await writeFile(`${output}submitted-once.json`, JSON.stringify({ startedAt: new Date().toISOString(), before, count: 3 }), { flag: "wx", mode: 0o600 });
  const report = { model, before, samples: [] };
  const save = () => writeFile(`${output}report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  try {
    for (const [index, sample] of plan.samples.entries()) {
      const current = await usage();
      const receiptSpend = report.samples.reduce((total, sample) => total + (sample.usage?.cost ?? 0), 0);
      const observedSpend = Math.max(current.used - before.used, receiptSpend);
      assert.ok(observedSpend < 0.35 && Math.min(current.remaining, before.remaining - receiptSpend) >= 0.15, "Stop-before-next-request budget threshold reached.");
      assert.equal(sample.request.model, model);
      assert.equal(sample.request.n, 1);
      const result = { id: sample.id, headline: sample.headline, oldImage: sample.oldImage, state: "submitted" };
      report.samples.push(result);
      await save();
      const started = Date.now();
      const response = await fetch("https://openrouter.ai/api/v1/images", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://adbrain.vanshul.com", "X-Title": "AdBrain matched Flare evaluation" }, body: JSON.stringify(sample.request), signal: AbortSignal.timeout(180_000) });
      result.elapsedMs = Date.now() - started;
      result.httpStatus = response.status;
      const payload = await response.json();
      result.usage = payload.usage;
      await save();
      assert.equal(response.status, 200, "Generation failed; no retry authorized.");
      assert.equal(payload.data?.length, 1);
      const bytes = Buffer.from(payload.data[0].b64_json, "base64");
      const metadata = await sharp(bytes).metadata();
      result.dimensions = { width: metadata.width, height: metadata.height };
      assert.ok(metadata.width && metadata.height);
      assert.ok(Number.isFinite(payload.usage?.cost));
      await writeFile(`${output}${index + 1}-flare.png`, await sharp(bytes).png().toBuffer(), { mode: 0o600 });
      const oldPanel = await sharp(`${output}${index + 1}-old.png`).resize(600, 800, { fit: "contain", background: "#eeeeee" }).png().toBuffer();
      const newPanel = await sharp(bytes).resize(600, 800, { fit: "contain", background: "#eeeeee" }).png().toBuffer();
      await sharp({ create: { width: 1220, height: 800, channels: 3, background: "#ffffff" } }).composite([{ input: oldPanel, left: 0, top: 0 }, { input: newPanel, left: 620, top: 0 }]).png().toFile(`${output}${index + 1}-comparison.png`);
      result.state = "complete";
      await save();
      console.log(JSON.stringify({ sample: index + 1, ...result }));
    }
  } catch (error) {
    report.error = String(error).slice(0, 500);
    throw error;
  } finally {
    report.after = await usage();
    await save();
    console.log(JSON.stringify({ before, after: report.after, output }));
  }
}