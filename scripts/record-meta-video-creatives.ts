/**
 * #749: records Meta's validate_only answer for an owner's video ad (`videoStorySpec`, `video_data`) on the two
 * core destinations, WhatsApp and the instant lead form, so test:core can prove the payload is one Meta accepted.
 *
 * Safety: ads are only ever validated, never created, so nothing can deliver or spend. The parents an ad needs
 * (a PAUSED campaign and ad set from the recorded launch tape, then the creative) exist only for the recording
 * and are deleted in `finally`. No video is uploaded: it reuses a ready video already in the account.
 *
 *   ADBRAIN_ALLOW_META_WRITES=1 npx tsx --env-file=<.env.local> scripts/record-meta-video-creatives.ts
 */
import "./lib/meta-write-gate";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MetaClient, whatsappWelcomeMessage } from "@/lib/meta/client";
import { videoStorySpec, type VideoCreativeInput } from "@/lib/meta/media";

const GRAPH = "https://graph.facebook.com/v26.0/";
const VALIDATE = JSON.stringify(["validate_only"]);
const token = process.env.META_SYSTEM_USER_TOKEN!;
const account = `act_${(process.env.META_AD_ACCOUNT_ID ?? "").replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;
if (!token || !pageId || account === "act_") throw new Error("Needs META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID and META_PAGE_ID.");

const FIXTURES = join(process.cwd(), "tests/core/fixtures/meta");
type LaunchExchange = { destination: string; kind: string; form: Record<string, string> };
const launch = JSON.parse(readFileSync(join(FIXTURES, "launch-validate.json"), "utf8")) as {
  inputs: { creative: { headline: string; message: string; description: string }; whatsappGreeting: { autofill: string; greeting: string }; phone: string };
  tape: LaunchExchange[];
};
const PLACEHOLDER_THUMBNAIL = "https://scontent.example/video-thumbnail.jpg";
const DESTINATIONS = ["instant_form", "whatsapp"] as const;

type Exchange = { destination: string; kind: string; form: Record<string, string>; status: number; body: unknown };
const tape: Exchange[] = [];
const scrubs: [string, string][] = [[account, "act_ACCOUNT"], [pageId, "PAGE"]];
const scrub = <T>(value: T): T => JSON.parse(scrubs.reduce((text, [real, label]) => text.split(real).join(label), JSON.stringify(value)));

async function graph(method: string, path: string, form?: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(form ? { body: new URLSearchParams(form) } : {}),
  });
  const body = await res.json() as Record<string, unknown>;
  delete (body.error as Record<string, unknown> | undefined)?.fbtrace_id;
  return { status: res.status, body };
}

/** The launch tape's PAUSED form for `kind`, with its placeholders back to this account's real values. */
function launchForm(destination: string, kind: string, real: Record<string, string>): Record<string, string> {
  const form = launch.tape.find((exchange) => exchange.destination === destination && exchange.kind === kind)!.form;
  const text = Object.entries(real).reduce((json, [label, value]) => json.split(label).join(value), JSON.stringify(form));
  const filled = JSON.parse(text) as Record<string, string>;
  if (filled.status !== "PAUSED") throw new Error(`Refusing a ${kind} that isn't PAUSED.`);
  return { ...filled, name: "AdBrain #749 video validate (PAUSED, deleted after)" };
}

async function readyVideo(meta: MetaClient): Promise<{ id: string; thumbnailUrl: string }> {
  const list = await graph("GET", `${account}/advideos?fields=id&limit=25`);
  for (const { id } of (list.body.data as { id: string }[] | undefined) ?? []) {
    const state = await meta.readAdVideo(id);
    if (state.status === "ready" && state.thumbnailUrl) return { id, thumbnailUrl: state.thumbnailUrl };
  }
  throw new Error("The account needs a ready video (scripts/record-meta-ad-video.ts uploads one).");
}

async function main() {
  const meta = new MetaClient({ adAccountId: account, pageId, accessToken: token });
  const video = await readyVideo(meta);
  scrubs.push([video.id, "VIDEO"], [video.thumbnailUrl, PLACEHOLDER_THUMBNAIL]);
  const leadForm = (await meta.listLeadForms())[0];
  if (!leadForm) throw new Error("The Page needs a lead form.");
  scrubs.push([leadForm.id, "LEAD_FORM"]);
  const numbers = await meta.whatsappNumbers();
  const phone = numbers.page ?? numbers.business[0];
  if (!phone) throw new Error("The Page needs a WhatsApp number.");
  scrubs.push([phone, launch.inputs.phone], [phone.slice(1), launch.inputs.phone.slice(1)]);

  const created: string[] = [];
  try {
    for (const destination of DESTINATIONS) {
      const campaign = await graph("POST", `${account}/campaigns`, launchForm(destination, "campaigns", { PAGE: pageId, [launch.inputs.phone]: phone }));
      if (typeof campaign.body.id !== "string") throw new Error(`campaign ${campaign.status} ${JSON.stringify(campaign.body)}`);
      created.push(campaign.body.id);
      scrubs.push([campaign.body.id, "CAMPAIGN"]);
      const adSet = await graph("POST", `${account}/adsets`, launchForm(destination, "adsets", { PAGE: pageId, [launch.inputs.phone]: phone, CAMPAIGN: campaign.body.id }));
      if (typeof adSet.body.id !== "string") throw new Error(`adset ${adSet.status} ${JSON.stringify(adSet.body)}`);
      created.push(adSet.body.id);
      scrubs.push([adSet.body.id, "ADSET"]);

      const words = {
        pageId, videoId: video.id, thumbnailUrl: video.thumbnailUrl,
        message: launch.inputs.creative.message, headline: launch.inputs.creative.headline, description: launch.inputs.creative.description,
      };
      const input: VideoCreativeInput = destination === "whatsapp"
        ? { ...words, destination, welcomeMessage: whatsappWelcomeMessage(launch.inputs.whatsappGreeting) }
        : { ...words, destination, leadFormId: leadForm.id };
      const form = { name: launch.inputs.creative.headline, object_story_spec: JSON.stringify(videoStorySpec(input)) };
      const validated = await graph("POST", `${account}/adcreatives`, { ...form, execution_options: VALIDATE });
      tape.push({ destination, kind: "adcreatives", form, status: validated.status, body: validated.body });
      console.log(destination, "adcreatives", validated.status, JSON.stringify(validated.body).slice(0, 300));
      if (destination === "whatsapp") {
        // Control: the image creative's WhatsApp button (with `link`) on video_data, which Meta refuses.
        const spec = videoStorySpec(input);
        (spec.video_data.call_to_action as { value: Record<string, string> }).value.link = `https://wa.me/${phone.slice(1)}`;
        const control = { ...form, object_story_spec: JSON.stringify(spec) };
        const refused = await graph("POST", `${account}/adcreatives`, { ...control, execution_options: VALIDATE });
        tape.push({ destination, kind: "control-adcreatives-whatsapp-link", form: control, status: refused.status, body: refused.body });
        console.log("control", refused.status, JSON.stringify(refused.body).slice(0, 160));
      }
      if (validated.status !== 200) continue;
      const creative = await graph("POST", `${account}/adcreatives`, form);
      if (typeof creative.body.id !== "string") throw new Error(`creative ${creative.status} ${JSON.stringify(creative.body)}`);
      created.push(creative.body.id);
      scrubs.push([creative.body.id, "CREATIVE"]);

      const adForm = { name: launch.inputs.creative.headline, adset_id: adSet.body.id, status: "PAUSED", creative: JSON.stringify({ creative_id: creative.body.id }) };
      const ad = await graph("POST", `${account}/ads`, { ...adForm, execution_options: VALIDATE });
      tape.push({ destination, kind: "ads", form: adForm, status: ad.status, body: ad.body });
      console.log(destination, "ads", ad.status, JSON.stringify(ad.body).slice(0, 300));
    }
  } finally {
    // Newest first (creative, ad set, campaign), each on its own so one failure can't strand the rest.
    const left: string[] = [];
    for (const id of [...created].reverse()) {
      const deleted = await graph("DELETE", id).catch((error: unknown) => ({ status: 0, body: { error: String(error) } as Record<string, unknown> }));
      if (deleted.status !== 200 || deleted.body.success !== true) left.push(id);
    }
    console.log(`deleted ${created.length - left.length}/${created.length}`);
    if (left.length) throw new Error(`Delete these by hand in Ads Manager (all PAUSED, no ads): ${left.join(", ")}`);
  }
  writeFileSync(join(FIXTURES, "video-creative-validate.json"),
    `${JSON.stringify(scrub({ recordedAt: new Date().toISOString(), tape }), null, 2)}\n`);
  console.log(`video-creative-validate: ${tape.length} validated objects`);
}

main().catch((error) => { console.error(error); process.exit(1); });
