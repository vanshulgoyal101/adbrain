import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const CONFIRMATION = "MIGRATE_META_CREDENTIALS";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function keyFromEnv() {
  const key = Buffer.from(required("META_TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("META_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
  return key;
}

function bytea(value) {
  return `\\x${value.toString("hex")}`;
}

function encryptToken(token, tokenId, businessId, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`v1:${tokenId}:${businessId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    ciphertext: bytea(ciphertext),
    nonce: bytea(nonce),
    auth_tag: bytea(cipher.getAuthTag()),
  };
}

function unknownCapabilities() {
  return {
    canReadInsights: { state: "unknown", blockers: [] },
    canReadLeads: { state: "unknown", blockers: [] },
    canCreatePaused: { state: "unknown", blockers: [] },
    canActivate: { state: "unknown", blockers: [] },
  };
}

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const key = keyFromEnv();

const { data: legacyRows, error: legacyError } = await supabase
  .from("meta_credentials")
  .select("business_id, ad_account_id, page_id, access_token, token_type, token_expires_at")
  .order("business_id", { ascending: true });
if (legacyError) throw new Error("Could not read legacy Meta credentials.");

const rows = legacyRows ?? [];
const businessIds = rows.map((row) => row.business_id).filter(Boolean);
const { data: businesses, error: businessesError } = businessIds.length
  ? await supabase.from("businesses").select("id, owner_id").in("id", businessIds)
  : { data: [], error: null };
if (businessesError) throw new Error("Could not verify legacy Meta business owners.");
const owners = new Map((businesses ?? []).map((business) => [business.id, business.owner_id]));
const usable = rows.filter((row) => row.access_token && row.business_id && owners.has(row.business_id));
const skipped = rows.length - usable.length;
console.log(`Legacy Meta rows=${rows.length}; usable=${usable.length}; skipped=${skipped}; mode=${APPLY ? "apply" : "dry-run"}`);

if (!APPLY) {
  console.log("Dry run only. Re-run with --apply and META_CREDENTIAL_MIGRATION_CONFIRM=MIGRATE_META_CREDENTIALS after reviewing the count.");
  process.exit(0);
}
if (process.env.META_CREDENTIAL_MIGRATION_CONFIRM !== CONFIRMATION) {
  throw new Error("Refusing to apply without META_CREDENTIAL_MIGRATION_CONFIRM=MIGRATE_META_CREDENTIALS.");
}

let migrated = 0;
let alreadyMigrated = 0;
for (const row of usable) {
  const { data: existing, error: existingError } = await supabase
    .from("meta_connections")
    .select("token_id")
    .eq("business_id", row.business_id)
    .maybeSingle();
  if (existingError) throw new Error("Could not inspect existing Meta connection metadata.");
  if (existing?.token_id) {
    alreadyMigrated += 1;
    continue;
  }

  const tokenId = randomUUID();
  const encrypted = encryptToken(row.access_token, tokenId, row.business_id, key);
  const { error: tokenError } = await supabase.rpc("meta_token_insert", {
    p_id: tokenId,
    p_business_id: row.business_id,
    p_authorized_by: owners.get(row.business_id),
    p_subject_id: `legacy:${row.business_id}`,
    p_token_kind: row.token_type === "system_user" ? "business_system_user" : "user",
    p_ciphertext: encrypted.ciphertext,
    p_nonce: encrypted.nonce,
    p_auth_tag: encrypted.auth_tag,
    p_key_id: "meta-token-v1",
    p_format_version: "v1",
    p_granted_scopes: [],
    p_granted_assets: [],
    p_expires_at: row.token_expires_at,
    p_validated_at: null,
  });
  if (tokenError) throw new Error("Could not write encrypted Meta token.");

  const { error: connectionError } = await supabase.from("meta_connections").upsert({
    business_id: row.business_id,
    token_id: tokenId,
    ad_account_id: row.ad_account_id,
    page_id: row.page_id,
    authorization_status: "reauth_required",
    capabilities: unknownCapabilities(),
    selection_reason: "legacy_migrated_unverified",
    generation: 0,
    last_checked_at: null,
  }, { onConflict: "business_id" });
  if (connectionError) {
    await supabase.rpc("meta_token_delete", {
      p_token_id: tokenId,
      p_business_id: row.business_id,
    });
    throw new Error("Could not write migrated Meta connection metadata.");
  }
  migrated += 1;
}

console.log(`Migrated=${migrated}; already_migrated=${alreadyMigrated}; skipped=${skipped}.`);
console.log("Legacy table was not dropped. Verify decryptability, tenant isolation, and counts before the separate drop step.");