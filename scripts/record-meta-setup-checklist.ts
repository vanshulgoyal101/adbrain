/**
 * #1016: records the real Graph reads behind Settings' Meta setup checklist (`MetaClient.setupReads`)
 * on the internal Solaride account, for test:core. GETs only: any other method is refused before it
 * leaves the process. Tokens are dropped and WhatsApp numbers keep only their last 4 digits.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-setup-checklist.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MetaClient } from "@/lib/meta/client";

const token = process.env.META_SYSTEM_USER_TOKEN!;
const adAccountId = `act_${process.env.META_AD_ACCOUNT_ID!.replace(/^act_/, "")}`;
const pageId = process.env.META_PAGE_ID!;
if (!token || !pageId) throw new Error("Needs META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID and META_PAGE_ID.");

type Exchange = { path: string; status: number; body: unknown };
const tape: Exchange[] = [];
const realFetch = globalThis.fetch;
// Any +91 number keeps only its last 4 digits.
const redact = (text: string) => text.replace(/\+91[\d\s-]{10,14}/g, (number) => `+91 99999 9${number.replace(/\D/g, "").slice(-4)}`);

globalThis.fetch = async (input, init) => {
  if ((init?.method ?? "GET") !== "GET") throw new Error(`Recorder refuses ${init?.method}.`);
  const url = new URL(String(input));
  const response = await realFetch(input, init);
  const text = await response.text();
  url.searchParams.delete("access_token");
  const path = decodeURIComponent(url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search);
  const body = JSON.parse(redact(text).replace(/"access_token":"[^"]+"/g, "\"access_token\":\"page-token\""));
  tape.push({ path, status: response.status, body });
  console.log(response.status, path, JSON.stringify(body).slice(0, 200));
  return new Response(text, { status: response.status, headers: response.headers });
};

async function main() {
  const reads = await new MetaClient({ adAccountId, pageId, accessToken: token }).setupReads();
  console.log("reads:", reads);
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/setup-checklist.json"), `${JSON.stringify({ recordedAt: new Date().toISOString(), adAccountId, pageId, reads, tape }, null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
