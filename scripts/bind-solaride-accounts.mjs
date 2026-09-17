import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { verifyMetaCapabilities } from "../src/lib/meta/capability-verification.ts";

const apply = process.argv.includes("--apply");
const target = "kmzuxrvfrwwpwmoovwcp";
const owners = [
  { email: "demo@adbrain.vanshul.com", businessId: "816aaafb-7ebc-4ad7-bbda-001beff172f8", ownerId: "144e4745-7e6d-4fb9-a1fd-7edec31a335f" },
  { email: "vanshulg101@gmail.com", businessId: "ea6ea561-5d0d-428c-b3bf-d75ae67eca60", ownerId: "da0771ca-c07f-4e86-b6da-023aaf517d74" },
];
const production = parseEnv(readFileSync(process.env.PRODUCTION_ENV_FILE, "utf8"));
const key = Buffer.from(production.META_TOKEN_ENCRYPTION_KEY ?? "", "base64");
assert.equal(key.length, 32, "Existing production encryption key required");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${target}.supabase.co`);
const token = process.env.META_SYSTEM_USER_TOKEN;
assert.ok(token && process.env.SUPABASE_ACCESS_TOKEN);

async function graph(path, parameters, authorization = token) {
  const url = new URL(`https://graph.facebook.com/v21.0/${path}`);
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${authorization}` }, signal: AbortSignal.timeout(15_000) });
  assert.ok(response.ok, `Meta verification failed: ${path}, HTTP ${response.status}`);
  return response.json();
}

async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${target}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Database request failed: HTTP ${response.status}; inspect state before retrying`);
  return response.json();
}

const account = await graph("act_2398686420592052", { fields: "id,name,account_status,currency,timezone_name,business" });
const page = await graph("885223068001054", { fields: "id,name" });
const { data: inspection } = await graph("debug_token", { input_token: token }, `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`);
assert.equal(account.business?.id, "1158100643072508");
assert.equal(account.account_status, 1);
assert.equal(account.currency, "INR");
assert.equal(inspection.is_valid, true);
assert.equal(inspection.app_id, process.env.META_APP_ID);
assert.equal(inspection.type, "SYSTEM_USER");
for (const expiry of [inspection.expires_at, inspection.data_access_expires_at]) {
  assert.ok(!expiry || expiry * 1000 > Date.now(), "Meta authorization expired");
}
const selected = { adAccountId: account.id, pageId: page.id, currency: account.currency, timezoneName: account.timezone_name };
const capabilities = await verifyMetaCapabilities(token, selected);
const businessIds = owners.map(owner => `'${owner.businessId}'`).join(",");
const before = await query(`select b.id, b.owner_id, u.email, c.authorization_status, c.token_id is not null as has_token from public.businesses b join auth.users u on u.id=b.owner_id left join public.meta_connections c on c.business_id=b.id where b.id in (${businessIds}) order by u.email`);
assert.equal(before.length, owners.length);
for (const owner of owners) {
  const row = before.find(row => row.id === owner.businessId);
  assert.equal(row?.owner_id, owner.ownerId);
  assert.equal(row?.email, owner.email);
  assert.equal(row?.authorization_status, null, "Refusing to overwrite an existing connection");
}
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", target, owners: owners.map(owner => owner.email), account: { id: account.id, name: account.name }, page, capabilities }, null, 2));
if (!apply) process.exit(0);
assert.equal(process.env.META_BINDING_CONFIRM, "BIND_TWO_SOLARIDE_ACCOUNTS");

const rows = owners.map(owner => {
  const tokenId = randomUUID();
  const nonce = randomBytes(12);
  const aad = Buffer.from(`v1:${tokenId}:${owner.businessId}`);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  assert.equal(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(), token);
  return { ...owner, tokenId, ciphertext: `\\x${ciphertext.toString("hex")}`, nonce: `\\x${nonce.toString("hex")}`, tag: `\\x${tag.toString("hex")}` };
});
const payload = JSON.stringify({ rows, account, page, capabilities, inspection: { subject: inspection.user_id, scopes: inspection.scopes, expiresAt: inspection.expires_at ? new Date(inspection.expires_at * 1000).toISOString() : null, dataExpiresAt: inspection.data_access_expires_at ? new Date(inspection.data_access_expires_at * 1000).toISOString() : null } });
const delimiter = `$payload_${randomUUID().replaceAll("-", "")}$`;
assert.ok(!payload.includes(delimiter));
await query(`begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
do $repair$
declare payload jsonb := ${delimiter}${payload}${delimiter}::jsonb; entry jsonb;
begin
  perform 1 from public.businesses where id in (${businessIds}) order by id for update;
  for entry in select value from jsonb_array_elements(payload->'rows') loop
    if not exists (select 1 from public.businesses b join auth.users u on u.id=b.owner_id where b.id=(entry->>'businessId')::uuid and b.owner_id=(entry->>'ownerId')::uuid and u.email=entry->>'email') then
      raise exception 'Owner binding changed';
    end if;
    if exists (select 1 from public.meta_connections where business_id=(entry->>'businessId')::uuid) then
      raise exception 'Connection exists; refusing overwrite';
    end if;
    insert into private.meta_tokens (id,business_id,authorized_by,subject_id,token_kind,ciphertext,nonce,auth_tag,key_id,format_version,granted_scopes,granted_assets,expires_at,data_access_expires_at,validated_at)
    values ((entry->>'tokenId')::uuid,(entry->>'businessId')::uuid,(entry->>'ownerId')::uuid,payload->'inspection'->>'subject','business_system_user',(entry->>'ciphertext')::bytea,(entry->>'nonce')::bytea,(entry->>'tag')::bytea,'meta-token-v1','v1',array(select jsonb_array_elements_text(payload->'inspection'->'scopes')),jsonb_build_array(payload->'account'->>'id',payload->'page'->>'id'),(payload->'inspection'->>'expiresAt')::timestamptz,(payload->'inspection'->>'dataExpiresAt')::timestamptz,now());
    insert into public.meta_connections (business_id,token_id,meta_business_id,ad_account_id,page_id,account_name,page_name,currency,timezone_name,authorization_status,capabilities,selection_reason,generation,last_checked_at)
    values ((entry->>'businessId')::uuid,(entry->>'tokenId')::uuid,payload->'account'->'business'->>'id',payload->'account'->>'id',payload->'page'->>'id',payload->'account'->>'name',payload->'page'->>'name',payload->'account'->>'currency',payload->'account'->>'timezone_name','connected',payload->'capabilities','owner_authorized_system_user_binding',1,now());
  end loop;
end $repair$;
commit;`, false);
const after = await query(`select business_id,ad_account_id,page_id,authorization_status,generation from public.meta_connections where business_id in (${businessIds})`);
assert.equal(after.length, 2);
for (const row of after) {
  assert.equal(row.authorization_status, "connected");
  assert.equal(row.ad_account_id, account.id);
  assert.equal(row.page_id, page.id);
}
console.log("Both explicit Solaride bindings committed; no campaigns changed.");