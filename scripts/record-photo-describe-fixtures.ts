/**
 * #780: records real vision answers for Create's photo notes, and one real Haiku concept written for a described
 * photo, under production's settings. Three images: a price sign, a cake photo with no text (cropped from
 * public/ideas/bakery-2.webp) and a Hindi sign. About $0.005 in total; writes no data. Writes
 * tests/core/fixtures/openrouter/photo-describe.json.
 *
 *   CREATIVE_PROVIDER_ORDER=openrouter OPENROUTER_MODEL=anthropic/claude-haiku-5.5 \
 *     npx tsx --env-file=../../adbrain/.env.local scripts/record-photo-describe-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { buildConceptMessages, creativeConceptSchema, validateConcept, conceptValidationRules } from "@/lib/creative/concept";
import { getEnv } from "@/lib/env";
import { complete, VISION_MODEL } from "@/lib/llm";
import { buildDescribeMessages, DESCRIBE_OPTIONS, describeReplySchema, photoNotes } from "@/lib/media/describe";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import run4 from "../tests/core/fixtures/create/cedar-ridge-run4.json";

const sign = (lines: string[], background: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">
  <rect width="900" height="600" fill="${background}"/><rect x="40" y="40" width="820" height="520" fill="none" stroke="#f5f0e6" stroke-width="8"/>
  ${lines.map((line, index) => `<text x="450" y="${200 + index * 130}" font-family="Kohinoor Devanagari, Arial Unicode MS, Arial" font-size="84" fill="#f5f0e6" text-anchor="middle">${line}</text>`).join("")}
</svg>`)).jpeg({ quality: 88 }).toBuffer();

async function main() {
  const env = getEnv();
  const photos = [
    { id: "price-sign", made: "SVG chalkboard sign", bytes: await sign(["Haircut ₹149", "Beard trim ₹99", "Open 9am-9pm"], "#233a2e") },
    { id: "no-text", made: "public/ideas/bakery-2.webp, bottom 570 px (the cake)", bytes: await sharp("public/ideas/bakery-2.webp").extract({ left: 0, top: 330, width: 720, height: 570 }).jpeg({ quality: 88 }).toBuffer() },
    { id: "hindi-sign", made: "SVG shop sign in Hindi", bytes: await sign(["ताज़ा समोसे", "₹20 प्लेट"], "#7a2e1d") },
  ];
  const describes = [];
  for (const photo of photos) {
    const started = Date.now();
    const reply = await complete(buildDescribeMessages({ data: new Uint8Array(photo.bytes), mediaType: "image/jpeg" }), { ...DESCRIBE_OPTIONS, json: true });
    const notes = photoNotes(describeReplySchema.parse(JSON.parse(reply.text.replace(/^```json\s*|```\s*$/g, ""))));
    console.log(photo.id, reply.provider, reply.model, Date.now() - started, "ms", JSON.stringify(notes));
    describes.push({ id: photo.id, made: photo.made, model: reply.model, content: reply.text,
      usage: { prompt: reply.usage?.promptTokens ?? 0, completion: reply.usage?.completionTokens ?? 0 }, latencyMs: Date.now() - started });
  }

  // The price sign's notes on a Brand that never mentions a haircut price: the words must fit the photo, not quote ₹149.
  const priced = describes[0];
  const notes = photoNotes(describeReplySchema.parse(JSON.parse(priced.content.replace(/^```json\s*|```\s*$/g, ""))));
  const angle = AD_ANGLES[0];
  const input = { brand: run4.brand as BrandContext, brief: run4.brief, angle, ownerPhoto: "https://example.test/photo.jpg", ownerPhotoNotes: notes };
  const started = Date.now();
  const reply = await complete(buildConceptMessages(input), {
    routing: "creative", json: true, responseSchema: creativeConceptSchema, temperature: 0.8,
    maxTokens: env.CREATIVE_MAX_TOKENS, reasoningEffort: env.CREATIVE_REASONING_EFFORT, cache: false,
  });
  const result = validateConcept(JSON.parse(reply.text.replace(/^```json\s*|```\s*$/g, "")), input);
  const rules = result.success ? [] : conceptValidationRules(result.issues);
  console.log("concept", reply.model, Date.now() - started, "ms", rules.join(",") || "valid", "|", reply.text.slice(0, 300));

  const fixture = {
    recordedAt: new Date().toISOString(),
    visionModel: VISION_MODEL,
    describes,
    concept: { photo: priced.id, angleName: angle.name, model: reply.model, content: reply.text,
      usage: { prompt: reply.usage?.promptTokens ?? 0, completion: reply.usage?.completionTokens ?? 0 }, rulesAtRecording: rules },
  };
  writeFileSync(join(process.cwd(), "tests/core/fixtures/openrouter/photo-describe.json"), `${JSON.stringify(fixture, null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
