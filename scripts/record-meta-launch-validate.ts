/**
 * #419: records Meta's validate_only answer for every object AdBrain's real launch code
 * (`MetaClient.createLeadCampaign`) sends, for lead-form and WhatsApp campaigns, so
 * test:core can prove today's payloads are ones Meta accepted.
 *
 * Safety: ads are only ever validated, never created, so nothing can deliver or spend.
 * The parents an ad needs (a PAUSED campaign, a PAUSED ad set, a creative) exist only
 * for the recording and are deleted in `finally`. No image is uploaded: the launch code
 * gets an existing image hash from the account.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-launch-validate.ts
 */
import "./lib/meta-write-gate";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MetaClient, type AdDestination } from "@/lib/meta/client";

const GRAPH = "https://graph.facebook.com/v26.0/";
const VALIDATE = JSON.stringify(["validate_only"]);
const token = process.env.META_SYSTEM_USER_TOKEN!;
const account = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;
if (!token || !pageId) throw new Error("Needs META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID and META_PAGE_ID.");

/** Saved in the fixture; tests/core/launch-validate.test.ts replays the launch with them. */
const LAUNCH_INPUTS = {
  name: "AdBrain #419 validate (PAUSED, deleted after)",
  dailyBudgetRupees: 280,
  link: "https://adbrain.vanshul.com",
  ageMin: 25,
  ageMax: 55,
  gender: "all" as const,
  location: { cities: [{ key: "1021145" }, { key: "2676092" }, { key: "1035473" }] },
  creative: { headline: "Rooftop solar in 7 days", message: "Cut your power bill with rooftop solar.\nFree site visit.", description: "Free site visit in Tricity", cta: "Get Quote" },
  whatsappGreeting: { autofill: "Hi, I'd like a solar quote.", greeting: "Hi! Thanks for reaching out to Solaride." },
  // #741: Advantage+ with interest suggestions takes the out-of-area exclusions only at create (#499).
  interests: [{ id: "6003437140731", name: "Solar energy" }],
};
const PLACEHOLDER_PHONE = "+910000000000";

type Exchange = { destination: AdDestination; kind: string; form: Record<string, string>; status: number; body: unknown };
const tape: Exchange[] = [];
const scrubs: [string, string][] = [[account, "act_ACCOUNT"], [pageId, "PAGE"]];
const scrub = <T>(value: T): T => JSON.parse(scrubs.reduce((text, [real, label]) => text.split(real).join(label), JSON.stringify(value)));
const created: { kind: string; id: string }[] = [];
/** #741: Meta's answer to the service-area read (region and country of each included place). */
let geoMeta: { path: string; status: number; body: unknown } | null = null;

const realFetch = globalThis.fetch;
let destination: AdDestination = "instant_form";
let hashes: string[] = [];
let imageUploads = 0;

async function graphPost(path: string, form: Record<string, string>) {
  const res = await realFetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, access_token: token }),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href.startsWith(GRAPH) && (init?.method ?? "GET") === "GET" && url.searchParams.get("type") === "adgeolocationmeta") {
    const res = await realFetch(input, init);
    const body = await res.clone().json();
    url.searchParams.delete("access_token");
    geoMeta = { path: url.pathname.replace("/v26.0/", "") + url.search, status: res.status, body };
    return res;
  }
  if (!url.href.startsWith(GRAPH) || (init?.method ?? "GET") !== "POST") return realFetch(input, init);
  const path = url.pathname.replace("/v26.0/", "");
  const kind = path.split("/").pop()!;
  const form = Object.fromEntries([...(init!.body as URLSearchParams)].filter(([key]) => key !== "access_token"));
  if (kind === "adimages") {
    const hash = hashes[imageUploads++ % hashes.length];
    return Response.json({ images: { image: { hash } } });
  }
  if (!["campaigns", "adsets", "adcreatives", "ads"].includes(kind) || path !== `${account}/${kind}`) {
    throw new Error(`Refusing an unexpected POST: ${path}`);
  }
  if ((kind === "campaigns" || kind === "adsets" || kind === "ads") && form.status !== "PAUSED") {
    throw new Error(`Refusing a ${kind} POST that isn't PAUSED.`);
  }
  const validated = await graphPost(path, { ...form, execution_options: VALIDATE });
  tape.push({ destination, kind, form, status: validated.status, body: validated.body });
  console.log(destination, kind, validated.status, JSON.stringify(validated.body).slice(0, 240));
  if (validated.status !== 200) return Response.json(validated.body, { status: validated.status });
  // Ads stop at validation. Parents are created briefly so the next object can be validated.
  if (kind === "ads") return Response.json({ id: "AD" });
  const real = await graphPost(path, form);
  if (real.status !== 200 || typeof real.body.id !== "string") return Response.json(real.body, { status: real.status });
  created.push({ kind, id: real.body.id });
  scrubs.push([real.body.id, { campaigns: "CAMPAIGN", adsets: "ADSET", adcreatives: "CREATIVE" }[kind]!]);
  return Response.json({ id: real.body.id });
};

async function main() {
  const meta = new MetaClient({ adAccountId: account, pageId, accessToken: token });
  const images = await realFetch(`${GRAPH}${account}/adimages?fields=hash&limit=2&access_token=${encodeURIComponent(token)}`).then(r => r.json()) as { data?: { hash: string }[] };
  hashes = (images.data ?? []).map((image) => image.hash);
  if (hashes.length < 2) throw new Error("The account needs two existing images to reuse.");
  scrubs.push([hashes[0], "FEED_HASH"], [hashes[1], "STORY_HASH"]);
  const leadForm = (await meta.listLeadForms())[0];
  if (!leadForm) throw new Error("The Page needs a lead form.");
  scrubs.push([leadForm.id, "LEAD_FORM"]);
  const numbers = await meta.whatsappNumbers();
  const phone = numbers.page ?? numbers.business[0];
  if (!phone) throw new Error("The Page needs a WhatsApp number.");
  scrubs.push([phone, PLACEHOLDER_PHONE], [phone.slice(1), PLACEHOLDER_PHONE.slice(1)]);

  // No 9:16 image: production launches without one while #333's placement creative is off
  // (create-service.ts `storiesEnabled`). #447 adds it here when it turns stories back on.
  const base = {
    ...LAUNCH_INPUTS,
    creatives: [{ imageUrl: "https://adbrain.vanshul.com/solar-example.jpg", ...LAUNCH_INPUTS.creative }],
  };
  try {
    destination = "instant_form";
    imageUploads = 0;
    await meta.createLeadCampaign({ ...base, destination, leadFormId: leadForm.id });
    destination = "whatsapp";
    imageUploads = 0;
    await meta.createLeadCampaign({ ...base, destination, whatsappNumber: phone, boundWhatsAppNumbers: [phone] });
  } finally {
    for (const object of [...created].reverse().filter((o) => o.kind !== "adsets")) {
      const res = await realFetch(`${GRAPH}${object.id}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
      console.log("delete", object.kind, res.status);
    }
  }
  const file = join(process.cwd(), "tests/core/fixtures/meta/launch-validate.json");
  writeFileSync(file, `${JSON.stringify(scrub({ recordedAt: new Date().toISOString(), inputs: { ...LAUNCH_INPUTS, phone: PLACEHOLDER_PHONE }, geoMeta, tape }), null, 2)}\n`);
  console.log(`launch-validate: ${tape.length} validated objects`);
}

main().catch((error) => { console.error(error); process.exit(1); });
