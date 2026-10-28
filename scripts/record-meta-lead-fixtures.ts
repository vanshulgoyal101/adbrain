/**
 * Records real Graph lead-form and lead pages for the test:core lead sync
 * fixture (#165). Read-only: no Meta writes.
 *
 *   npx tsx --env-file=.env.local scripts/record-meta-lead-fixtures.ts
 *
 * Uses META_SYSTEM_USER_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID. Tokens are
 * stripped and every lead field value is replaced with Meta's test-lead
 * placeholder, so no personal data reaches the repository.
 */
import "./lib/meta-write-gate";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { metaClientFromEnv } from "./lib/meta-env";

type Exchange = { method: string; path: string; status: number; body: unknown };

const GRAPH = "https://graph.facebook.com/v26.0/";
const tape: Exchange[] = [];
const realFetch = globalThis.fetch;

function scrub(value: unknown, key = ""): unknown {
  if (key === "access_token") return "REDACTED";
  if (key === "field_data" && Array.isArray(value)) {
    return value.map((field: { name?: string }) => ({
      name: field.name,
      values: [`<test lead: dummy data for ${field.name}>`],
    }));
  }
  if (typeof value === "string") return value.replace(/access_token=[^&"\s]+/g, "access_token=REDACTED");
  if (Array.isArray(value)) return value.map(item => scrub(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, scrub(item, name)]));
  }
  return value;
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith(GRAPH)) return realFetch(input, init);
  if ((init?.method ?? "GET") !== "GET") throw new Error("Lead recorder is read-only.");
  const response = await realFetch(input, init);
  const body = await response.clone().json().catch(() => null);
  const parsed = new URL(url);
  parsed.searchParams.delete("access_token");
  tape.push({ method: "GET", path: parsed.pathname.replace("/v26.0/", "") + parsed.search, status: response.status, body: scrub(body) });
  return response;
};

async function main() {
  const meta = metaClientFromEnv();
  if (!meta) throw new Error("Meta env credentials are missing.");
  const forms = await meta.listLeadFormsPage();
  let leads = 0;
  for (const form of forms.data) leads += (await meta.listLeadsForFormPage(form.id)).data.length;
  writeFileSync(join(process.cwd(), "tests/core/fixtures/meta/leads.json"), `${JSON.stringify(tape, null, 2)}\n`);
  console.log(`leads: ${tape.length} exchanges, ${forms.data.length} forms, ${leads} leads`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
