/**
 * #775: records Meta's answers for editing a launched ad's words, read-only plus validate_only:
 * the ad and its creative as Meta stores them, Meta accepting the edited creative, and Meta accepting
 * the ad pointed at a creative. Nothing is created or changed (no real POST is sent).
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-ad-edit.ts <paused ad id>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { editedCreativeForm } from "@/lib/meta/client";

const GRAPH = "https://graph.facebook.com/v21.0/";
const token = process.env.META_SYSTEM_USER_TOKEN!;
const account = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const adId = process.argv[2];
if (!token || !adId) throw new Error("Needs META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID and a paused ad id.");

/** The edit the core test replays. */
export const EDIT = { message: "Book your free solar site survey this week. Our Mohali team replies on WhatsApp within the hour." };
const VALIDATE = JSON.stringify(["validate_only"]);

async function call(method: "GET" | "POST", path: string, form?: Record<string, string>) {
  const response = await fetch(`${GRAPH}${path}${method === "GET" ? `${path.includes("?") ? "&" : "?"}access_token=${token}` : ""}`, {
    method, ...(form ? { body: new URLSearchParams({ ...form, access_token: token }) } : {}),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function main() {
  const fields = "id,account_id,creative{id,name,object_story_spec,asset_feed_spec}";
  const ad = await call("GET", `${adId}?fields=${fields}`);
  const adBody = ad.body as { creative: { id: string; name?: string; object_story_spec?: Record<string, unknown>; asset_feed_spec?: Record<string, unknown> } };
  const status = await call("GET", `${adId}?fields=status`);
  if ((status.body as { status?: string }).status !== "PAUSED") throw new Error("Record against a PAUSED ad only.");
  const form = editedCreativeForm(adBody.creative, EDIT);
  const creative = await call("POST", `${account}/adcreatives`, { ...form, execution_options: VALIDATE });
  // The swap is validated against the ad's current creative: the edited one isn't created here.
  const swap = await call("POST", adId, { creative: JSON.stringify({ creative_id: adBody.creative.id }), execution_options: VALIDATE });
  const scrub = (value: unknown) => JSON.parse(JSON.stringify(value).split(account).join("act_ACCOUNT").split(adId).join("AD"));
  const tape = scrub({ recordedAt: new Date().toISOString(), edit: EDIT, ad: ad.body, form, validated: { creative, swap } });
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/ad-edit.json"), `${JSON.stringify(tape, null, 2)}\n`);
  console.log("ad-edit:", creative.status, JSON.stringify(creative.body), swap.status, JSON.stringify(swap.body));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
