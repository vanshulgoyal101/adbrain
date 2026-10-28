// Reconcile a campaign operation stuck in `needs_reconciliation` (#734): what does Meta hold for it?
//   node scripts/reconcile-operation.mjs <operation id> | --key <12-hex key from the alert issue> [--apply]
// Read-only by default: reads the operation (Management API, read-only) and each external id in Meta
// (GET only, META_SYSTEM_USER_TOKEN from the owner's .env.local, so only accounts that system user
// can see), plus the ad account's campaigns created in the operation's window that weren't checkpointed.
// --apply closes the row as `failed` only when nothing in Meta can spend (every campaign, ad set and ad
// is DELETED, ARCHIVED or gone). A PAUSED or ACTIVE tree is printed for the Launch owner and never touched.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { readOnlyQuery } from "./lib/prod-query.mjs";

const GRAPH = "https://graph.facebook.com/v26.0";
const GONE = new Set(["DELETED", "ARCHIVED"]);
const SPENDING_TYPES = new Set(["campaign", "adset", "ad"]);
const ENV_PATH = "/Users/vanshulgoyal/Development/copilot/adbrain/.env.local";

export const operationKey = (id) => createHash("sha256").update(id).digest("hex").slice(0, 12);

/**
 * Objects are `{id, type, status, name?, error?, missing?}`. Only campaigns, ad sets and ads can
 * spend; lead forms, Pages (`other`) and image hashes are reusable and never block closing. An
 * object we couldn't type or read blocks closing (fail closed).
 * Verdicts: `unreadable` (Meta refused one, so we don't know), `active` (something can deliver now),
 * `paused` (a PAUSED tree to import or delete by hand), `nothing_live` (safe to close as failed).
 */
export function classify(objects) {
  const spending = objects.filter((o) => SPENDING_TYPES.has(o.type) || o.error || (o.type === "unknown" && !o.missing));
  if (spending.some((o) => (o.error || o.type === "unknown") && !o.missing)) return "unreadable";
  const live = spending.filter((o) => !o.missing && !GONE.has(o.status));
  if (live.some((o) => o.status === "ACTIVE")) return "active";
  if (live.length) return "paused";
  return "nothing_live";
}

async function env() {
  return parseEnv(await readFile(ENV_PATH, "utf8"));
}

async function graph(token, path, params = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, body };
}

const FIELDS = { campaign: "name,status,effective_status,created_time", adset: "name,status,effective_status,campaign_id", ad: "name,status,effective_status,adset_id" };
// Graph gives a business token no `metadata`, so each type is told apart by a field only it has. A
// probe counts only when that field comes back: some nodes (lead forms) silently ignore unknown fields.
const PROBES = [["ad", FIELDS.ad, "adset_id"], ["adset", `${FIELDS.adset},billing_event`, "billing_event"], ["campaign", `${FIELDS.campaign},objective`, "objective"], ["other", "id,name", "id"]];

/** Graph's answer to a probe: this type (`ok`), not this type, gone (#100/33), or an error. */
export function probeResult({ ok, body }, keyField) {
  if (ok) return body?.[keyField] !== undefined ? "ok" : "wrong_type";
  const error = body?.error ?? {};
  if (error.code === 100 && error.error_subcode === 33) return "missing";
  if (error.code === 100 && /nonexisting field/i.test(error.message ?? "")) return "wrong_type";
  return "error";
}

async function readObject(token, id) {
  for (const [type, fields, keyField] of PROBES) {
    const read = await graph(token, id, { fields });
    const result = probeResult(read, keyField);
    if (result === "wrong_type") continue;
    if (result === "missing") return { id, type: "unknown", missing: true };
    if (result === "error") return { id, type: "unknown", error: `${read.body?.error?.code ?? "?"}/${read.body?.error?.error_subcode ?? "-"}` };
    return { id, type, status: read.body.status, effective: read.body.effective_status, name: read.body.name };
  }
  return { id, type: "unknown", error: "untyped" };
}

async function children(token, campaignId) {
  const out = [];
  for (const [edge, type] of [["adsets", "adset"], ["ads", "ad"]]) {
    const read = await graph(token, `${campaignId}/${edge}`, { fields: FIELDS[type], limit: "100" });
    if (!read.ok) { out.push({ id: `${campaignId}/${edge}`, type, error: "read" }); continue; }
    for (const row of read.body.data ?? []) out.push({ id: row.id, type, status: row.status, effective: row.effective_status, name: row.name });
  }
  return out;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { key: { type: "string" }, apply: { type: "boolean", default: false } } });
  const target = positionals[0];
  if (!values.key && !/^[0-9a-f-]{36}$/.test(target ?? "")) throw new Error("Usage: reconcile-operation.mjs <operation id> | --key <12 hex> [--apply]");
  if (values.key && !/^[0-9a-f]{12}$/.test(values.key)) throw new Error("--key is the 12-hex key from the alert issue.");

  const rows = await readOnlyQuery(`select o.id, o.business_id, o.state, o.external_ids, o.sanitized_error,
  to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
  to_char(o.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at, c.ad_account_id
from public.campaign_operations o left join public.meta_connections c on c.business_id = o.business_id
where o.state = 'needs_reconciliation'${values.key ? "" : ` and o.id = '${target}'`}`);
  const operation = rows.find((row) => (values.key ? operationKey(row.id) === values.key : row.id === target));
  if (!operation) throw new Error("No operation in needs_reconciliation matches.");
  console.log(`Operation ${operation.id} (key ${operationKey(operation.id)}), ${operation.state}, created ${operation.created_at}, last error: ${(operation.sanitized_error ?? "").slice(0, 120)}`);

  const token = (await env()).META_SYSTEM_USER_TOKEN;
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN is unavailable.");
  const objects = [];
  for (const id of operation.external_ids ?? []) {
    if (!/^\d+$/.test(id)) { objects.push({ id, type: "image_hash" }); continue; }
    const object = await readObject(token, id);
    objects.push(object);
    if (object.type === "campaign" && !object.missing && !object.error) objects.push(...await children(token, id));
  }
  // A campaign Meta made but the operation never checkpointed: created in the operation's window.
  if (!objects.some((o) => o.type === "campaign") && operation.ad_account_id) {
    const from = Date.parse(operation.created_at) / 1000 - 60;
    const to = Date.parse(operation.updated_at) / 1000 + 300;
    const read = await graph(token, `act_${String(operation.ad_account_id).replace(/^act_/, "")}/campaigns`, {
      fields: FIELDS.campaign, limit: "100", filtering: JSON.stringify([{ field: "created_time", operator: "IN_RANGE", value: [from, to] }]),
    });
    if (!read.ok) objects.push({ id: "account-campaign-search", type: "campaign", error: "read" });
    for (const row of read.body?.data ?? []) {
      objects.push({ id: row.id, type: "campaign", status: row.status, effective: row.effective_status, name: row.name, unchecked: true });
      objects.push(...await children(token, row.id));
    }
  }
  const unique = [...new Map(objects.map((o) => [o.id, o])).values()];
  for (const o of unique) {
    console.log(`  ${o.type.padEnd(10)} ${o.id} ${o.missing ? "GONE" : o.error ? `UNREADABLE (${o.error})` : `${o.status ?? ""}${o.effective && o.effective !== o.status ? `/${o.effective}` : ""}`}${o.unchecked ? " (found by search, not checkpointed)" : ""}${o.name ? ` "${o.name}"` : ""}`);
  }
  const verdict = classify(unique);
  console.log(`Verdict: ${verdict}`);
  if (verdict === "active") console.log("Something can deliver now: pause it in Ads Manager first (money), then hand the tree to the Launch owner.");
  if (verdict === "paused") console.log("A PAUSED tree exists: the Launch owner imports it into campaigns or deletes it in Ads Manager, then reruns this.");
  if (verdict === "unreadable") console.log("Meta refused a read with the system-user token: reconcile with the business's own connection.");
  if (!values.apply) { console.log(verdict === "nothing_live" ? "Dry run: rerun with --apply to close it as failed." : "Dry run: nothing to apply."); return; }
  if (verdict !== "nothing_live") throw new Error(`Not applying: verdict ${verdict}.`);

  const e = await env();
  const outcome = `Reconciled ${new Date().toISOString().slice(0, 10)} (#734): nothing live in Meta (${unique.filter((o) => SPENDING_TYPES.has(o.type)).map((o) => `${o.type} ${o.missing ? "gone" : o.status}`).join(", ") || "no objects"}).`;
  const url = `${e.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/campaign_operations?id=eq.${operation.id}&state=eq.needs_reconciliation`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { apikey: e.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ state: "failed", phase: "complete", lease_until: null, sanitized_error: outcome.slice(0, 240), updated_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(20_000),
  });
  const updated = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(updated) || updated.length !== 1) throw new Error(`Close failed (HTTP ${response.status}); the row is unchanged unless it already moved.`);
  console.log(`Closed: state ${updated[0].state}, phase ${updated[0].phase}. ${outcome}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main().catch((error) => { console.error(error.message); process.exit(1); });
}
