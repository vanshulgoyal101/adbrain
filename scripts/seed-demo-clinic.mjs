#!/usr/bin/env node
/**
 * Seed the Cedar Ridge Chiropractic demo clinic.
 *
 * AdBrain is single-business-per-user (`getPrimaryBusiness()` returns the
 * oldest business), so the clinic is seeded under its OWN auth user — adding it
 * to an existing account would leave that account's first business winning.
 *
 * Everything except user creation runs through an RLS-scoped signed-in client,
 * the same way Solaride was seeded, so the policies are exercised rather than
 * bypassed.
 *
 * Idempotent: re-running updates the same rows (matched on owner + name) and
 * re-uses already-uploaded assets.
 *
 *   npm run seed:demo-clinic -- --dry-run
 *   npm run seed:demo-clinic
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");

// ── env ────────────────────────────────────────────────────────────────
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.DEMO_USER_EMAIL;
const PASSWORD = process.env.DEMO_USER_PASSWORD;

function requireEnv() {
  const missing = Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    DEMO_USER_EMAIL: EMAIL,
    DEMO_USER_PASSWORD: PASSWORD,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`Missing env: ${missing.join(", ")}\nSee .env.example.`);
    process.exit(1);
  }
}

// ── the clinic ─────────────────────────────────────────────────────────
const BUSINESS = {
  name: "Cedar Ridge Chiropractic",
  vertical: "chiropractic clinic",
  website: null,
  description:
    "A family chiropractic clinic in Austin, Texas offering spinal adjustments, posture care, and sports injury rehab. Same-day appointments for new patients.",
  brand_voice:
    "Warm, professional, plain-spoken. No hype, no exclamation marks, no medical promises.",
  primary_color: "#0F766E",
  secondary_color: "#134E4A",
  font: null,
  languages: ["English"],
  locations: ["Austin, Texas", "Round Rock", "Cedar Park"],
  target_audience:
    "Adults 30-60 with desk jobs, weekend athletes, and new parents in the Austin area.",
  usps: [
    "Same-day appointments for new patients",
    "Board-certified chiropractors with 15+ years combined experience",
    "Insurance accepted, plus transparent cash pricing",
    "Digital posture scan included on your first visit",
    "Evening and Saturday hours",
  ],
  offers: ["$49 new-patient exam and consultation", "Free 15-minute spine check"],
  phone: "+1 512 555 0134",
  email: "hello@cedarridgechiro.com",
  address: "2100 Cedar Ridge Drive, Suite 210, Austin, TX 78745",
};

const INSTRUCTION_TITLE = "Healthcare ad policy (Meta) — required reading";
const INSTRUCTION_CONTENT = `# Healthcare ad rules for Cedar Ridge Chiropractic

These are hard constraints. Meta rejects health ads that break them, and the
clinic is legally accountable for claims.

## Never describe the reader
Meta's personal-attributes policy forbids implying you know something about the
viewer's health. Describe the SERVICE, not the reader.

- Wrong: "Do you suffer from back pain?"
- Wrong: "Your back pain is holding you back."
- Right: "Back pain relief in Austin."
- Right: "Chiropractic care for desk workers."

## Never promise outcomes
Do not use, in any form: cure, heal, guaranteed, pain-free, miracle,
permanent fix, risk-free. No claims about treating specific diseases or
conditions. No "results guaranteed" language.

## Imagery
No before/after body imagery. No implied medical outcomes. No X-rays or spine
diagrams presented as evidence. Show a calm, clean, professional clinic.

## Pricing
Always state the offer's conditions with the price. "$49 new-patient exam and
consultation" — never a bare "$49" or "from $49".

## Tone
Reassuring and factual. This is healthcare, not a flash sale. No exclamation
marks. Prefer specific, verifiable facts (same-day appointments, Saturday hours,
insurance accepted) over adjectives.

## Calls to action
Prefer "Book an appointment", "Call the clinic", or "Message us". Avoid urgency
pressure ("act now", "limited time") — it reads as untrustworthy for healthcare.
`;

// ── logo ───────────────────────────────────────────────────────────────
/** Calm teal wordmark — no clip-art spine graphics. */
function logoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
  <rect width="1200" height="400" fill="#FFFFFF"/>
  <g transform="translate(80 110)">
    <rect x="0" y="0" width="180" height="180" rx="40" fill="#0F766E"/>
    <g stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" fill="none">
      <path d="M90 42 C 62 74, 62 106, 90 138 C 118 106, 118 74, 90 42 Z"/>
      <line x1="90" y1="138" x2="90" y2="150"/>
    </g>
  </g>
  <text x="300" y="200" font-family="Georgia, 'Times New Roman', serif" font-size="86" fill="#134E4A">Cedar Ridge</text>
  <text x="300" y="272" font-family="Helvetica, Arial, sans-serif" font-size="46" letter-spacing="6" fill="#0F766E">CHIROPRACTIC</text>
</svg>`;
}

// ── clinic photos (same free provider the app uses) ─────────────────────
const PHOTO_PROMPTS = [
  "Professional advertising photograph of a calm, modern chiropractic clinic treatment room, adjustment table, clean neutral walls with soft teal accents, warm natural light through a window, potted plant, no people, no text, photorealistic, shot on a DSLR, commercial quality",
  "Professional advertising photograph of a bright welcoming medical clinic reception area, light wood front desk, comfortable waiting chairs, subtle teal accents, plants, warm natural light, no people, no text, photorealistic, shot on a DSLR, commercial quality",
];

function pollinationsUrl(prompt, seed) {
  const params = new URLSearchParams({
    width: "1024",
    height: "1024",
    seed: String(seed),
    model: process.env.POLLINATIONS_MODEL || "flux",
    nologo: "true",
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
}

async function fetchImage(url, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 1000) return buf;
      }
      console.warn(`   image attempt ${i} failed (HTTP ${res.status})`);
    } catch (err) {
      console.warn(`   image attempt ${i} failed (${err.message})`);
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, 4000 * i));
  }
  return null;
}

// ── user ───────────────────────────────────────────────────────────────
/**
 * Ensure the demo user exists and can sign in. Uses the Admin API — users
 * INSERTed via raw SQL get NULL token columns and GoTrue login then fails.
 */
async function ensureUser() {
  if (!SERVICE_KEY) {
    console.log("• No SUPABASE_SERVICE_ROLE_KEY — assuming the demo user exists.");
    return;
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users?.find((u) => u.email === EMAIL);
  if (existing) {
    console.log(`• Demo user exists (${EMAIL}) — ensuring password + confirmation.`);
    if (!DRY) {
      await admin.auth.admin.updateUserById(existing.id, {
        password: PASSWORD,
        email_confirm: true,
      });
    }
    return;
  }
  console.log(`• Creating demo user ${EMAIL}`);
  if (DRY) return;
  const { error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser: ${error.message}`);
}

// ── main ───────────────────────────────────────────────────────────────
async function main() {
  requireEnv();
  console.log(DRY ? "DRY RUN — nothing will be written.\n" : "Seeding demo clinic…\n");

  await ensureUser();

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signInError) {
    // On a dry run the user may not exist yet — report the plan instead.
    if (DRY) {
      console.log(`• Would sign in as ${EMAIL} (not created yet)`);
      console.log(`• Would insert business ${BUSINESS.name}`);
      console.log(`   usps: ${BUSINESS.usps.length}, offers: ${BUSINESS.offers.length}`);
      console.log(`• Would seed instruction "${INSTRUCTION_TITLE}"`);
      console.log(`• Would upload logo + ${PHOTO_PROMPTS.length} clinic photos`);
      return;
    }
    throw new Error(`Demo user cannot sign in: ${signInError.message}`);
  }
  const ownerId = session.user.id;
  console.log(`• Signed in as ${EMAIL}`);

  // Business — idempotent on (owner_id, name).
  const { data: found } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", BUSINESS.name)
    .maybeSingle();

  let businessId = found?.id ?? null;
  if (DRY) {
    console.log(`• Would ${businessId ? "update" : "insert"} business ${BUSINESS.name}`);
    console.log(`   usps: ${BUSINESS.usps.length}, offers: ${BUSINESS.offers.length}`);
    console.log(`• Would seed instruction "${INSTRUCTION_TITLE}"`);
    console.log(`• Would upload logo + ${PHOTO_PROMPTS.length} clinic photos`);
    return;
  }

  if (businessId) {
    const { error } = await supabase
      .from("businesses")
      .update(BUSINESS)
      .eq("id", businessId);
    if (error) throw new Error(`update business: ${error.message}`);
    console.log(`• Updated business ${businessId}`);
  } else {
    const { data, error } = await supabase
      .from("businesses")
      .insert({ ...BUSINESS, owner_id: ownerId })
      .select("id")
      .single();
    if (error) throw new Error(`insert business: ${error.message}`);
    businessId = data.id;
    console.log(`• Created business ${businessId}`);
  }

  // Instruction file — idempotent on (business_id, title).
  const { data: instr } = await supabase
    .from("ad_instructions")
    .select("id")
    .eq("business_id", businessId)
    .eq("title", INSTRUCTION_TITLE)
    .maybeSingle();
  if (instr) {
    await supabase
      .from("ad_instructions")
      .update({ content: INSTRUCTION_CONTENT, is_active: true })
      .eq("id", instr.id);
    console.log("• Updated ad instructions");
  } else {
    await supabase.from("ad_instructions").insert({
      business_id: businessId,
      title: INSTRUCTION_TITLE,
      content: INSTRUCTION_CONTENT,
      is_active: true,
    });
    console.log("• Created ad instructions");
  }

  // Assets. Stable paths keep re-runs from piling up duplicates.
  const uploaded = [];
  const put = async (path, bytes, contentType) => {
    const { error } = await supabase.storage
      .from("brand-assets")
      .upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`upload ${path}: ${error.message}`);
    return supabase.storage.from("brand-assets").getPublicUrl(path).data.publicUrl;
  };

  const logoPng = await sharp(Buffer.from(logoSvg()), { density: 300 })
    .resize(1200)
    .png()
    .toBuffer();
  const logoUrl = await put(`${businessId}/logo.png`, logoPng, "image/png");
  uploaded.push(["logo", logoUrl]);
  console.log("• Uploaded logo");

  for (let i = 0; i < PHOTO_PROMPTS.length; i++) {
    const bytes = await fetchImage(pollinationsUrl(PHOTO_PROMPTS[i], 4200 + i));
    if (!bytes) {
      console.warn(`• Skipped clinic photo ${i + 1} (provider unavailable)`);
      continue;
    }
    const url = await put(`${businessId}/clinic-${i + 1}.jpg`, bytes, "image/jpeg");
    uploaded.push(["product_photo", url]);
    console.log(`• Uploaded clinic photo ${i + 1}`);
  }

  // Register the assets so they show in the Brand Brain UI.
  for (const [type, url] of uploaded) {
    const { data: existing } = await supabase
      .from("brand_assets")
      .select("id")
      .eq("business_id", businessId)
      .eq("url", url)
      .maybeSingle();
    if (!existing) {
      await supabase
        .from("brand_assets")
        .insert({ business_id: businessId, type, url });
    }
  }

  await supabase.from("businesses").update({ logo_url: logoUrl }).eq("id", businessId);

  console.log(`\nDone. Sign in at /login as ${EMAIL}`);
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  process.exit(1);
});
