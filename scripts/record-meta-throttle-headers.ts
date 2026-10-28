/**
 * #1838: records, read-only, the usage headers Meta sends with an Ads Insights read (one GET), so the throttle core test
 * parses the real shapes. Ids are scrubbed. The code-17 error body is Meta's documented one: AdBrain doesn't provoke
 * a real throttle on a live account to record it.
 *
 *   npx tsx --env-file=<.env.local> scripts/record-meta-throttle-headers.ts
 */
import "./lib/meta-write-gate";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const GRAPH = "https://graph.facebook.com/v26.0/";
const token = process.env.META_SYSTEM_USER_TOKEN;
const account = process.env.META_AD_ACCOUNT_ID?.replace(/^act_/, "");
if (!token || !account) throw new Error("Needs META_SYSTEM_USER_TOKEN and META_AD_ACCOUNT_ID.");

const HEADERS = ["x-business-use-case-usage", "x-ad-account-usage", "x-app-usage", "x-fb-ads-insights-throttle"];
const scrub = (text: string) => text.replaceAll(account, "9000000000000001").replace(/"\d{12,20}"\s*:/g, '"900000000000002":');

async function main() {
  const response = await fetch(`${GRAPH}act_${account}/insights?fields=spend&date_preset=last_7d&access_token=${token}`);
  await response.body?.cancel();
  if (!response.ok) throw new Error(`insights → ${response.status}`);
  const headers = Object.fromEntries(HEADERS.flatMap((name) => {
    const value = response.headers.get(name);
    return value ? [[name, scrub(value)]] : [];
  }));
  const fixture = {
    note: "#1838: usage headers recorded read-only from one Ads Insights GET (ids scrubbed); error17 is Meta's documented body for a code-17 throttle (not provoked live).",
    recordedAt: new Date().toISOString(),
    headers,
    error17: { error: { message: "(#17) User request limit reached", type: "OAuthException", is_transient: true, code: 17, error_subcode: 2446079, fbtrace_id: "AbCdEf123" } },
    error4: { error: { message: "(#4) Application request limit reached", type: "OAuthException", is_transient: true, code: 4, fbtrace_id: "AbCdEf456" } },
  };
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/throttle.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`throttle: ${Object.keys(headers).join(", ") || "no usage headers"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
