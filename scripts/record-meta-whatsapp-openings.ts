/**
 * #840: records Meta's validate_only answers for every WhatsApp opening AdBrain sends (pre-typed
 * message, the same with a Call now button, ice breakers), in both creative shapes we launch: the
 * 9:16 placement creative (asset_feed_spec) and the single image (link_data). Starts from a PAUSED
 * ad's creative as Meta stores it. Nothing is created.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-whatsapp-openings.ts <paused placement ad id>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { whatsappWelcomeMessage, type WhatsAppOpening } from "@/lib/meta/client";

const GRAPH = "https://graph.facebook.com/v21.0/";
const token = process.env.META_SYSTEM_USER_TOKEN!;
const account = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const adId = process.argv[2];
if (!token || !adId) throw new Error("Needs META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID and a paused ad id.");

/** Solaride's template from #840 (owner, Oct 26), and B1's three questions (#680). */
export const OPENINGS: Record<string, WhatsAppOpening> = {
  prefill: { greeting: "Hi! Thanks for messaging Solaride. Send this message and we'll reply here.", autofill: "Hi! I'd like a free solar site survey." },
  call: { greeting: "Hi! Thanks for messaging Solaride. This is your first step in getting free electricity.", autofill: "Can I get more info on this", callButton: true },
  ice_breakers: { greeting: "Hi! Thanks for messaging Solaride.", autofill: "", iceBreakers: ["Free site survey", "Price for my home", "Call me back"] },
};

async function call(method: "GET" | "POST", path: string, form?: Record<string, string>) {
  const response = await fetch(`${GRAPH}${path}${method === "GET" ? `${path.includes("?") ? "&" : "?"}access_token=${token}` : ""}`, {
    method, ...(form ? { body: new URLSearchParams({ ...form, access_token: token }) } : {}),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function main() {
  const ad = (await call("GET", `${adId}?fields=status,creative{name,object_story_spec,asset_feed_spec}`)).body as {
    status: string; creative: { name: string; object_story_spec: Record<string, unknown>; asset_feed_spec: { images: { hash: string }[]; bodies: { text: string }[]; titles: { text: string }[]; link_urls: { website_url: string }[]; additional_data?: Record<string, unknown> } };
  };
  if (ad.status !== "PAUSED" || !ad.creative.asset_feed_spec) throw new Error("Record against a PAUSED placement ad only.");
  const feed = ad.creative.asset_feed_spec;
  const tape: { opening: string; shape: string; welcome: string; status: number; body: unknown }[] = [];
  for (const [opening, texts] of Object.entries(OPENINGS)) {
    const welcome = whatsappWelcomeMessage(texts);
    const placement = { name: ad.creative.name, object_story_spec: JSON.stringify(ad.creative.object_story_spec),
      asset_feed_spec: JSON.stringify({ ...feed, additional_data: { ...feed.additional_data, page_welcome_message: welcome } }) };
    const single = { name: ad.creative.name, object_story_spec: JSON.stringify({
      page_id: ad.creative.object_story_spec.page_id,
      link_data: { image_hash: feed.images[0].hash, message: feed.bodies[0].text, name: feed.titles[0].text, link: feed.link_urls[0].website_url,
        page_welcome_message: welcome, call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP", link: feed.link_urls[0].website_url } } },
    }) };
    for (const [shape, form] of [["placement", placement], ["single", single]] as const) {
      const answer = await call("POST", `${account}/adcreatives`, { ...form, execution_options: JSON.stringify(["validate_only"]) });
      tape.push({ opening, shape, welcome, ...answer });
      console.log(opening, shape, answer.status, JSON.stringify(answer.body).slice(0, 200));
    }
  }
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/whatsapp-openings.json"), `${JSON.stringify({ recordedAt: new Date().toISOString(), openings: OPENINGS, tape }, null, 2)}\n`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
