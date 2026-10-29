import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { applyMigration } from "./database-migrations.mjs";
import { appendedMigrations, buildSchema, readBaseSchema } from "./build-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const operatorPaymentMigration = await readFile(join(root, "db/migrations/20260926_production_payment_policy_v2.sql"), "utf8");
const customerAllowanceMigration = await readFile(join(root, "db/migrations/20260926_customer_ad_allowance.sql"), "utf8");
const creativeIntentMigration = await readFile(join(root, "db/migrations/20260927_creative_generation_intents.sql"), "utf8");
const creativeReconcileMigration = await readFile(join(root, "db/migrations/20260930_creative_generation_reconcile.sql"), "utf8");
const creativeSettleMigration = await readFile(join(root, "db/migrations/20261021_creative_generation_settle_holds.sql"), "utf8");
const configurablePaymentMigration = await readFile(join(root, "db/migrations/20260927_configurable_payment_quotes.sql"), "utf8");
const webhookHealthMigration = await readFile(join(root, "db/migrations/20261022_payment_webhook_health.sql"), "utf8");
const cappedBoundMigration = await readFile(join(root, "db/migrations/20261023_capped_reservation_bound.sql"), "utf8");
const customAmountMigration = await readFile(join(root, "db/migrations/20261023_custom_payment_amount.sql"), "utf8");
const paymentTermsV2Migration = await readFile(join(root, "db/migrations/20261028_payment_terms_v2.sql"), "utf8");
const metaCostMigration = await readFile(join(root, "db/migrations/20261023_meta_cost_observation.sql"), "utf8");
const metaSettleMigration = await readFile(join(root, "db/migrations/20261023_meta_cost_settle.sql"), "utf8");
const operatorFundedMigration = await readFile(join(root, "db/migrations/20261023_operator_funded_businesses.sql"), "utf8");
const manualEnquiryMigration = await readFile(join(root, "db/migrations/20261024_manual_whatsapp_enquiries.sql"), "utf8");
const schedulerMigration = await readFile(join(root, "db/migrations/20261024_scheduler_pg_cron.sql"), "utf8");
const advisorsMigration = await readFile(join(root, "db/migrations/20261024_security_advisors.sql"), "utf8");
const managedAccountsMigration = await readFile(join(root, "db/migrations/20261025_managed_meta_accounts.sql"), "utf8");
const provisionLeaseMigration = await readFile(join(root, "db/migrations/20261025_managed_provision_lease.sql"), "utf8");
const managedSpendCapsMigration = await readFile(join(root, "db/migrations/20261025_managed_spend_caps.sql"), "utf8");
const whatsappBindingsMigration = await readFile(join(root, "db/migrations/20261025_whatsapp_number_bindings.sql"), "utf8");
const learningsMigration = await readFile(join(root, "db/migrations/20261026_campaign_learnings.sql"), "utf8");
const editOperationsMigration = await readFile(join(root, "db/migrations/20261026_campaign_edit_operations.sql"), "utf8");
const editAdCreativeMigration = await readFile(join(root, "db/migrations/20261026_campaign_edit_operations_ad_creative.sql"), "utf8");
const adResultsMigration = await readFile(join(root, "db/migrations/20261026_campaign_ads_ad_results.sql"), "utf8");
const ownerAlertsMigration = await readFile(join(root, "db/migrations/20261027_owner_whatsapp_alerts.sql"), "utf8");
const ownerAlertSendsMigration = await readFile(join(root, "db/migrations/20261027_owner_whatsapp_alerts_sends.sql"), "utf8");
const planPeriodsMigration = await readFile(join(root, "db/migrations/20261029_plan_periods.sql"), "utf8");
const leadCustomerMigration = await readFile(join(root, "db/migrations/20261026_lead_customer_status.sql"), "utf8");
const leadFirstContactedMigration = await readFile(join(root, "db/migrations/20261027_lead_first_contacted.sql"), "utf8");
const tokenSearchPathMigration = await readFile(join(root, "db/migrations/20261026_meta_token_search_path.sql"), "utf8");
const tokenPurgeMigration = await readFile(join(root, "db/migrations/20261029_meta_token_purge.sql"), "utf8");
const whatsappTemplateMigration = await readFile(join(root, "db/migrations/20261026_business_whatsapp_template.sql"), "utf8");
const metaDeletionMigration = await readFile(join(root, "db/migrations/20261026_meta_deletion_requests.sql"), "utf8");
const hardeningMigration = await readFile(join(root, "db/migrations/20261026_legacy_credentials_bucket_limits.sql"), "utf8");
const reauthMigration = await readFile(join(root, "db/migrations/20261026_meta_connection_reauth.sql"), "utf8");
const leadCampaignLinkMigration = await readFile(join(root, "db/migrations/20261026_lead_campaign_link.sql"), "utf8");
const leadEraseMigration = await readFile(join(root, "db/migrations/20261029_lead_erase.sql"), "utf8");
const leadSharedPageMigration = await readFile(join(root, "db/migrations/20261028_lead_sync_shared_page.sql"), "utf8");
const managedWhatsAppMigration = await readFile(join(root, "db/migrations/20261025_managed_whatsapp_page_link.sql"), "utf8");
const productRollupMigration = await readFile(join(root, "db/migrations/20260928_product_event_rollups.sql"), "utf8");
const bin = process.env.META_TEST_PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const directory = await mkdtemp(join(tmpdir(), "adbrain-pg-"));
const cluster = join(directory, "data");
const failures = [];
let started = false;

const bootstrap = `
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1] $$;
`;

function client(database = "postgres") {
  return new pg.Client({ host: directory, port: 5432, database, user: userInfo().username });
}

async function check(label, run) {
  try {
    await run();
    console.log(`PASS ${label}`);
  } catch (error) {
    failures.push(label);
    console.error(`FAIL ${label}: ${error.message}`);
  }
}

async function verifyRollback() {
  const fallback = "ce89976815a58cc17ac580130fdc1798ef62910e";
  const candidate = "273cbf80422f8c89b851dfc2fcfa85bff878104f";
  const baseline = "6291dc2d2691bfc8a235b2aa1b103f119b26b83e";
  const source = (revision, path) => execFileSync("git", ["show", `${revision}:${path}`], { cwd: root, encoding: "utf8" });
  const migrations = [
    ["20260926_campaign_integrity.sql", "f982ef1782a0166cbd4ebae7f696ce0a748bc1e744132d539fe385e4cf6717cf"],
    ["20260926_draft_authority.sql", "0d8e5fff0eaa7e1a728fec0087eac513c0cd7cf609dd4522097e720b1d18ebd2"],
    ["20260926_trusted_campaign_writes.sql", "c0cbe8418fd608dba782ccbe384fdb3205150d682236ccd221ef8f6892038306"],
    ["20260926_validate_campaign_integrity.sql", "8d6149ba4d4f3fcf4c13d6369c518fe24832d6b8a03425a0cfd1257521b27224"],
    ["20260926_lead_sync_progress.sql", "e769403c7cc39e7dff7ad11c8a9224a1c0a64535314bd435ace6ed0a54d5c7c5"],
    ["20260926_lead_follow_up.sql", "92fe5ec785017b262614fee5a49446898a852170c79268ca58bd77fca48271af"],
  ];
  const admin = client();
  await admin.connect();
  try { await admin.query("create database rollback_compatibility"); }
  finally { await admin.end(); }
  const db = client("rollback_compatibility");
  await db.connect();
  try {
    await db.query(bootstrap);
    const schema = source(baseline, "db/schema.sql");
    console.log(`Rollback fallback ${fallback}; baseline schema SHA256 ${createHash("sha256").update(schema).digest("hex")}`);
    await db.query(schema);
    for (const [name, checksum] of migrations) {
      const sql = source(candidate, `db/migrations/${name}`);
      assert.equal(createHash("sha256").update(sql).digest("hex"), checksum, name);
      assert.equal(await applyMigration(db, name, sql), "applied");
      assert.equal(await applyMigration(db, name, sql), "already_applied");
      console.log(`PASS rollback: applied immutable ${name} ${checksum}`);
    }
    await check("rollback: post-revocation grants keep old main writes denied", async () => {
      const { rows } = await db.query(`select
        has_table_privilege('authenticated','public.campaigns','UPDATE') as campaign_write,
        has_table_privilege('authenticated','public.campaign_results','INSERT') as result_write,
        has_table_privilege('authenticated','public.campaign_drafts','UPDATE') as draft_write,
        has_table_privilege('service_role','public.campaigns','UPDATE') as trusted_write`);
      assert.deepEqual(rows, [{ campaign_write: false, result_write: false, draft_write: false, trusted_write: true }]);
    });
    for (const path of ["src/lib/campaign/trusted-write.ts", "src/lib/audit.ts", "src/app/api/campaign-drafts/[id]/route.ts"]) {
      assert.equal(source(fallback, path), source(candidate, path), path);
    }
    const ownerId = randomUUID();
    const otherOwnerId = randomUUID();
    const businessId = randomUUID();
    const otherBusinessId = randomUUID();
    const campaignId = randomUUID();
    const otherCampaignId = randomUUID();
    const draftId = randomUUID();
    await db.query("insert into auth.users(id,email) values ($1,'fallback@example.invalid'),($2,'other@example.invalid')", [ownerId, otherOwnerId]);
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Fallback'),($3,$4,'Other')", [businessId, ownerId, otherBusinessId, otherOwnerId]);
    await db.query("insert into public.campaigns(id,business_id,daily_budget) values ($1,$2,200)", [otherCampaignId, otherBusinessId]);
    await db.query("insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id,page_id) values ($1,1,'connected','act_fixture','page_fixture')", [businessId]);
    const session = client("rollback_compatibility");
    await session.connect();
    try {
      await check("rollback: scoped service campaign/result writes and integrity constraints", async () => {
        await session.query("set role service_role");
        const owner = async userId => session.query("select id from public.businesses where id=$1 and owner_id=$2", [businessId, userId]);
        assert.equal((await owner(ownerId)).rowCount, 1);
        assert.equal((await owner(otherOwnerId)).rowCount, 0);
        await session.query("insert into public.campaigns(id,business_id,objective,daily_budget) values ($1,$2,'leads',200) returning *", [campaignId, businessId]);
        assert.equal((await session.query("update public.campaigns set status='paused',business_id=$1 where business_id=$1 and id=$2 returning *", [businessId, campaignId])).rowCount, 1);
        assert.equal((await session.query("update public.campaigns set status='paused',business_id=$1 where business_id=$1 and id=$2 returning *", [businessId, otherCampaignId])).rowCount, 0);
        const membership = async id => session.query("select id from public.campaigns where business_id=$1 and id=$2", [businessId, id]);
        assert.equal((await membership(campaignId)).rowCount, 1);
        assert.equal((await membership(otherCampaignId)).rowCount, 0);
        assert.equal((await session.query("insert into public.campaign_results(campaign_id,spend,impressions) values ($1,10,100) returning *", [campaignId])).rowCount, 1);
        await assert.rejects(session.query("insert into public.campaign_results(campaign_id,spend) values ($1,-1)", [campaignId]), { code: "23514" });
      });
      await check("rollback: owner and wrong-owner reads, browser and anonymous mutation denials", async () => {
        await session.query("set role authenticated");
        await session.query("select set_config('request.jwt.claim.sub',$1,false)", [ownerId]);
        assert.equal((await session.query("select * from public.campaigns where business_id=$1", [businessId])).rowCount, 1);
        assert.equal((await session.query("select * from public.campaign_results where campaign_id=$1", [campaignId])).rowCount, 1);
        await assert.rejects(session.query("update public.campaigns set status='active' where id=$1", [campaignId]), { code: "42501" });
        await assert.rejects(session.query("insert into public.campaign_results(campaign_id,spend) values ($1,1)", [campaignId]), { code: "42501" });
        await session.query("select set_config('request.jwt.claim.sub',$1,false)", [otherOwnerId]);
        assert.equal((await session.query("select * from public.campaigns where business_id=$1", [businessId])).rowCount, 0);
        assert.equal((await session.query("select * from public.campaign_results where campaign_id=$1", [campaignId])).rowCount, 0);
        await session.query("set role anon");
        await assert.rejects(session.query("select * from public.campaigns"), { code: "42501" });
      });
      await check("rollback: fallback draft RPC arguments preserve owner and version fences", async () => {
        await session.query("set role authenticated");
        await session.query("select set_config('request.jwt.claim.sub',$1,false)", [ownerId]);
        await session.query("insert into public.campaign_drafts(id,business_id,owner_id,input) values ($1,$2,$3,'{}')", [draftId, businessId, ownerId]);
        const update = async version => session.query("select * from public.update_campaign_draft_if_version($1,$2,$3,$4,'{}',now())", [draftId, businessId, ownerId, version]);
        assert.equal(Number((await update(1)).rows[0].version), 2);
        assert.equal((await update(1)).rowCount, 0);
        await assert.rejects(session.query("update public.campaign_drafts set version=99 where id=$1", [draftId]), { code: "42501" });
        await session.query("select set_config('request.jwt.claim.sub',$1,false)", [otherOwnerId]);
        assert.equal((await session.query("select * from public.campaign_drafts where id=$1 and owner_id=$2", [draftId, ownerId])).rowCount, 0);
        await assert.rejects(update(2), { code: "42501" });
        assert.equal((await session.query("select * from public.delete_campaign_draft_if_version($1,2)", [draftId])).rowCount, 0);
        await session.query("select set_config('request.jwt.claim.sub',$1,false)", [ownerId]);
        assert.equal((await session.query("select * from public.delete_campaign_draft_if_version($1,1)", [draftId])).rowCount, 0);
        assert.equal((await session.query("select * from public.delete_campaign_draft_if_version($1,2)", [draftId])).rowCount, 1);
      });
      await check("rollback: fallback audit RPC derives trusted identity and denies spoofing", async () => {
        const append = actor => session.query("select public.append_verified_audit_event($1,$2,'campaign.refresh','campaign',null,null,null,'{}') as id", [businessId, actor]);
        await session.query("set role service_role");
        const eventId = (await append(ownerId)).rows[0].id;
        const { rows } = await session.query("select actor_id,actor_label,authority from public.audit_log where id=$1", [eventId]);
        assert.deepEqual(rows, [{ actor_id: ownerId, actor_label: "fallback@example.invalid", authority: "server" }]);
        await assert.rejects(append(otherOwnerId), { code: "42501" });
        await assert.rejects(append(null), { code: "23514" });
        for (const role of ["service_role", "authenticated", "anon"]) {
          await session.query(`set role ${role}`);
          await assert.rejects(session.query("insert into public.audit_log(action,entity_type) values ('forged','campaign')"), { code: "42501" });
          if (role !== "service_role") await assert.rejects(append(ownerId), { code: "42501" });
        }
      });
      await check("rollback: legacy lead query/import preserves follow-up and unfinished sync evidence", async () => {
        await session.query("set role service_role");
        const run = (await session.query("select * from public.lead_sync_start($1,$2,null,1,'act_fixture','page_fixture')", [businessId, ownerId])).rows[0];
        await session.query("set role authenticated");
        await session.query("select set_config('request.jwt.claim.sub',$1,false)", [ownerId]);
        await session.query("insert into public.leads(business_id,campaign_id,meta_lead_id,full_name,workflow_status,follow_up_note,field_data) values ($1,$2,'retained','Original','qualified','Keep this note','{\"source\":\"fixture\"}')", [businessId, campaignId]);
        const before = (await session.query("select * from public.leads where business_id=$1 order by created_time desc nulls last limit 200", [businessId])).rows[0];
        const legacyImport = (business, metaId) => session.query("insert into public.leads(business_id,meta_lead_id,full_name,field_data) values ($1,$2,'Incoming','{}') on conflict(business_id,meta_lead_id) do nothing returning *", [business, metaId]);
        assert.equal((await legacyImport(businessId, "retained")).rowCount, 0);
        assert.deepEqual((await session.query("select * from public.leads where id=$1", [before.id])).rows[0], before);
        const inserted = (await legacyImport(businessId, "new")).rows[0];
        assert.equal(inserted.workflow_status, "new");
        assert.equal(inserted.follow_up_note, "");
        await assert.rejects(legacyImport(otherBusinessId, "foreign"), { code: "42501" });
        await assert.rejects(session.query("insert into public.leads(business_id,campaign_id,meta_lead_id) values ($1,$2,'foreign-campaign')", [businessId, otherCampaignId]), { code: "23503" });
        await session.query("select set_config('request.jwt.claim.sub',$1,false)", [otherOwnerId]);
        assert.equal((await session.query("select * from public.leads where business_id=$1 order by created_time desc nulls last limit 200", [businessId])).rowCount, 0);
        await session.query("set role service_role");
        assert.deepEqual((await session.query("select * from public.lead_sync_runs where id=$1", [run.id])).rows[0], run);
        assert.equal((await session.query("delete from public.campaigns where business_id=$1 and id=$2 returning id", [businessId, otherCampaignId])).rowCount, 0);
        assert.equal((await session.query("delete from public.campaigns where business_id=$1 and id=$2 returning id", [businessId, campaignId])).rowCount, 1);
        const retained = (await session.query("select business_id,campaign_id,workflow_status,follow_up_note from public.leads where id=$1", [before.id])).rows[0];
        assert.deepEqual(retained, { business_id: businessId, campaign_id: null, workflow_status: "qualified", follow_up_note: "Keep this note" });
      });
    } finally { await session.end(); }
  } finally { await db.end(); }
}

async function verifyProductAnalytics(db, database) {
  const service = async (sql) => {
    const session = client(database);
    await session.connect();
    try { await session.query("set role service_role"); return (await session.query(sql)).rows; }
    finally { await session.end(); }
  };
  const insert = (age, count, name = 'analytics.fixture', environment = 'production') => db.query(`
    insert into public.product_events(event_id,request_id,version,created_at,kind,name,outcome,duration_ms,attributes)
    select gen_random_uuid(),gen_random_uuid(),1,
      (date_trunc('day',now() at time zone 'UTC') - $1::integer * interval '1 day' + interval '1 hour') at time zone 'UTC',
      'workflow',$3,'success',case when sequence%3=0 then null else sequence*100 end,
      jsonb_build_object('environment',$4::text,'route','/api/creatives/generate','provider','synthetic','model','fixture',
        'inputTokens',20,'outputTokens',10,'totalTokens',30,'estimatedCostUsd',0.25,'count',2,'failedCount',1)
    from generate_series(1,$2::integer) sequence`,[age,count,name,environment]);
  await check(`${database}: retention preserves aggregate metrics once and keeps recent raw events`,async () => {
    await db.query("delete from public.product_events");
    await insert(91,3);
    await insert(1,1);
    await insert(91,1,'analytics.fixture','preview');
    assert.equal((await service("select public.prune_product_events() as count"))[0].count,4);
    const rows = await service("select * from public.product_event_daily where name='analytics.fixture' order by environment");
    const production = rows.find(row => row.environment==='production');
    assert.equal(rows.length,2);
    assert.equal(Number(production.event_count),3);
    assert.equal(Number(production.timed_event_count),2);
    assert.equal(Number(production.duration_sum_ms),300);
    assert.equal(production.duration_max_ms,200);
    assert.equal(Number(production.input_tokens),60);
    assert.equal(Number(production.output_tokens),30);
    assert.equal(Number(production.total_tokens),90);
    assert.equal(Number(production.estimated_cost_usd),0.75);
    assert.equal(Number(production.item_count),6);
    assert.equal(Number(production.failed_item_count),3);
    assert.equal((await db.query("select count(*)::int as count from public.product_events")).rows[0].count,1);
    assert.equal((await service("select public.prune_product_events() as count"))[0].count,0);
    assert.deepEqual(await service("select * from public.product_event_daily where name='analytics.fixture' order by environment"),rows);
    await insert(91,1);
    await service("select public.prune_product_events()");
    assert.equal(Number((await service("select event_count from public.product_event_daily where name='analytics.fixture' and environment='production'"))[0].event_count),4);
    const columns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='product_event_daily'")).rows.map(row=>row.column_name);
    assert.ok(!columns.some(name=>['user_id','business_id','request_id','event_id','attributes'].includes(name)));
  });
  await check(`${database}: rollup failure rolls back raw deletion`,async () => {
    await insert(91,1,'analytics.rollback');
    await db.query("begin");
    try {
      await db.query("alter table public.product_event_daily add constraint analytics_failure_probe check(name<>'analytics.rollback') not valid");
      await db.query("savepoint retention_probe");
      await assert.rejects(db.query("select public.prune_product_events()"),{code:'23514'});
      await db.query("rollback to savepoint retention_probe");
      assert.equal((await db.query("select count(*)::int as count from public.product_events where name='analytics.rollback'")).rows[0].count,1);
    } finally { await db.query("rollback"); }
    await service("select public.prune_product_events()");
  });
  await check(`${database}: bounded concurrent cleanup does not double count`,async () => {
    await insert(92,10005,'analytics.volume');
    const results = await Promise.all([service("select public.prune_product_events() as count"),service("select public.prune_product_events() as count")]);
    assert.ok(results.every(rows=>rows[0].count<=10000));
    await service("select public.prune_product_events()");
    assert.equal(Number((await service("select sum(event_count) as count from public.product_event_daily where name='analytics.volume'"))[0].count),10005);
    assert.equal((await db.query("select count(*)::int as count from public.product_events where name='analytics.volume'")).rows[0].count,0);
  });
  await check(`${database}: two-year expiry drops obsolete raw and aggregate data`,async () => {
    await insert(800,1,'analytics.expired');
    await db.query("update public.product_event_daily set day=(now() at time zone 'UTC')::date-800 where name='analytics.volume'");
    await service("select public.prune_product_events()");
    assert.equal((await service("select count(*)::int as count from public.product_event_daily where name in ('analytics.expired','analytics.volume')"))[0].count,0);
  });
  await check(`${database}: browsers cannot access rollups and services cannot forge them`,async () => {
    for (const role of ['anon','authenticated','service_role']) {
      const session = client(database);
      await session.connect();
      try {
        await session.query(`set role ${role}`);
        await assert.rejects(session.query("delete from public.product_event_daily"),{code:'42501'});
        if (role!=='service_role') {
          await assert.rejects(session.query("select * from public.product_event_daily"),{code:'42501'});
          await assert.rejects(session.query("select public.prune_product_events()"),{code:'42501'});
        }
      } finally { await session.end(); }
    }
  });
}

async function verifyConfigurablePayments(db, database) {
  const owner = randomUUID();
  const business = randomUUID();
  await db.query("insert into auth.users(id) values ($1)", [owner]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Synthetic pricing')", [business, owner]);
  const legacyPolicy = JSON.parse(operatorPaymentMigration.split("$policy$")[1]);
  const service = async (sql, values) => {
    const session = client(database);
    await session.connect();
    try { await session.query("set role service_role"); return (await session.query(sql, values)).rows[0]?.result; }
    finally { await session.end(); }
  };
  const quote = async (amount, verification = false) => (await db.query("select private.production_payment_quote($1,$2) as quote", [amount,verification])).rows[0].quote;
  // #1235: new checkouts use the v2 terms; v1 (priced and fixed) stays valid for existing orders.
  const terms = async (value, verification = null) => (await db.query("select private.production_payment_priced_policy_v2($1,$2) as policy", [value,verification])).rows[0].policy;
  const termsV1 = async (value, verification = null) => (await db.query("select private.production_payment_priced_policy($1,$2) as policy", [value,verification])).rows[0].policy;
  const claim = (value, policy, requestKey = randomUUID(), businessId = business, userId = owner) => {
    const text = JSON.stringify(policy);
    return service("select public.production_payment_order_claim($1,$2,$3,$4,'acc_pricing','rzp_live_pricing',$5,$6,$7,null) as result",
      [businessId,userId,requestKey,randomUUID(),value,text,createHash("sha256").update(text).digest("hex")]);
  };
  const complete = async (order, suffix) => {
    await service("select public.production_payment_order_result($1,'acc_pricing','rzp_live_pricing',$2) as result", [order.id,`order_${suffix}`]);
    return service("select public.production_payment_observe($1,'acc_pricing','rzp_live_pricing',$2,true,0,false,$3) as result", [order.id,`pay_${suffix}`,'c'.repeat(64)]);
  };
  const verification = { businessId: business, userId: owner, expiresAt: new Date(Date.now()+3_600_000).toISOString() };
  const verificationQuote = await quote(1000,true);
  const verificationPolicy = await terms(verificationQuote,verification);
  let testOrder;
  let annualOrder;
  await check(`${database}: SQL quotes and consent match the actual TypeScript policy`,async () => {
    const environment = { NODE_ENV:'production',VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',
      PAYMENTS_LIVE_ENABLED:'true',PAYMENTS_LIVE_COLLECTION_ENABLED:'true',RAZORPAY_LIVE_KEY_ID:'rzp_live_fixture',
      RAZORPAY_LIVE_KEY_SECRET:'synthetic-key-only',RAZORPAY_LIVE_WEBHOOK_SECRET:'synthetic-webhook-only',RAZORPAY_LIVE_ACCOUNT_ID:'acc_fixture',
      PAYMENTS_LIVE_WEBHOOK_ID:randomUUID(),VERCEL_PROJECT_ID:'prj_fixture',PAYMENTS_LIVE_PROJECT_ID:'prj_fixture',
      NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',PAYMENTS_LIVE_SUPABASE_URL:'https://fixture.supabase.co' };
    for (const [amount,scope,chosen] of [[100,null],[1005,null],[50000,null],[999999,null],[1000000,null],[1000,verification],[125000,null,true],[50005,null,true]]) {
      const settings = { ...environment,PAYMENTS_LIVE_AMOUNT_PAISE:chosen ? '1000000' : String(amount),...(scope ? {
        PAYMENTS_LIVE_VERIFICATION_ENABLED:'true',PAYMENTS_LIVE_VERIFICATION_AMOUNT_PAISE:String(amount),
        PAYMENTS_LIVE_VERIFICATION_BUSINESS_ID:business,PAYMENTS_LIVE_VERIFICATION_USER_ID:owner,PAYMENTS_LIVE_VERIFICATION_EXPIRES_AT:scope.expiresAt } : {}) };
      const actual = JSON.parse(execFileSync(process.execPath,['--import','tsx','-e',
        'const {getProductionCollectionPolicy}=require("./src/lib/payments/production-config.ts"); const {hash,...policy}=getProductionCollectionPolicy(JSON.parse(process.argv[1]),Date.now(),JSON.parse(process.argv[2])); process.stdout.write(JSON.stringify(policy));',
        JSON.stringify(settings),JSON.stringify({businessId:business,userId:owner,...(chosen ? {annualAmountPaise:amount} : {})})],{cwd:root,encoding:'utf8'}));
      assert.deepEqual(actual,await terms(await quote(amount,Boolean(scope)),scope));
      assert.equal((await db.query("select private.production_payment_contract_valid($1,$2,$3) as valid",[amount,actual.quote,actual])).rows[0].valid,true);
    }
  });
  await check(`${database}: v2 terms name no split, and v1 terms still validate for old orders (#1235)`, async () => {
    const value = await quote(125000);
    const [v2, v1] = [await terms(value), await termsV1(value)];
    assert.equal(v2.version, 'operator-managed-priced-v2');
    assert.match(v2.serviceScope, /^₹1,250 for 12 months/);
    assert.doesNotMatch(`${v2.serviceScope} ${v2.refundTerms}`, /allocat|20%|80%|service fee|INR 250/i);
    const valid = async (policy) => (await db.query("select private.production_payment_contract_valid($1,$2,$3) as valid",[125000,value,policy])).rows[0].valid;
    assert.equal(await valid(v2), true);
    assert.equal(await valid(v1), true);
    assert.equal(await valid({ ...v2, refundTerms: v1.refundTerms }), false);
    assert.equal(await valid({ ...v1, version: 'operator-managed-priced-v2' }), false);
  });
  await check(`${database}: exact verification quote and single concurrent order`, async () => {
    const results = await Promise.all([claim(verificationQuote,verificationPolicy),claim(verificationQuote,verificationPolicy)]);
    assert.equal(results.filter(result => result.claimed).length,1);
    assert.equal(new Set(results.map(result => result.order.id)).size,1);
    testOrder = results[0].order;
    assert.equal(testOrder.amount_paise,1000);
    assert.equal(testOrder.purpose,'verification');
    assert.equal(testOrder.quote.serviceAllocationPaise,0);
    assert.equal(testOrder.quote.metaAllocationPaise,0);
  });
  await check(`${database}: verification preserves normal checkout and credits no allowance`, async () => {
    annualOrder = (await claim(await quote(1000000),legacyPolicy)).order;
    assert.notEqual(annualOrder.id,testOrder.id);
    const captured = await complete(testOrder,'verification');
    assert.equal(captured.state,'captured');
    assert.equal(captured.captured_paise,1000);
    const balance = await service("select public.customer_ad_balance($1,$2,'acc_pricing') as result", [business,owner]);
    assert.equal(balance.capturedPaise,1000);
    assert.equal(balance.serviceAllocationPaise,0);
    assert.equal(balance.advertisingAllocationPaise,0);
    assert.equal(balance.remainingPaise,0);
    assert.equal((await claim(verificationQuote,verificationPolicy)).claimed,false);
    assert.equal((await db.query("select count(*)::int as count from private.production_payment_orders where business_id=$1 and purpose='verification'",[business])).rows[0].count,1);
  });
  await check(`${database}: partial verification refunds are visible without fictional ad allocation`,async () => {
    const observe = () => service("select public.production_payment_observe($1,'acc_pricing','rzp_live_pricing','pay_verification',true,250,false,$2,'rfnd_partial',250,'processed') as result",[testOrder.id,'e'.repeat(64)]);
    assert.equal((await observe()).state,'partially_refunded');
    assert.equal((await observe()).refunded_paise,250);
    const balance = await service("select public.customer_ad_balance($1,$2,'acc_pricing') as result",[business,owner]);
    assert.equal(balance.refundedPaise,250);
    assert.equal(balance.held,false);
    assert.equal(balance.serviceAllocationPaise,0);
    assert.equal(balance.advertisingAllocationPaise,0);
    assert.equal((await db.query("select count(*)::int as count from private.production_payment_effects where order_id=$1 and kind='refund'",[testOrder.id])).rows[0].count,1);
  });
  await check(`${database}: policy scope, expiry and forged amounts fail closed`, async () => {
    for (const changed of [
      { ...verification, userId: randomUUID() },
      { ...verification, businessId: randomUUID() },
      { ...verification, expiresAt: new Date(Date.now()-60_000).toISOString() },
      { ...verification, expiresAt: new Date(Date.now()+90_000_000).toISOString() },
    ]) await assert.rejects(claim(verificationQuote,await terms(verificationQuote,changed)),{code:'23514'});
    await assert.rejects(claim({ ...verificationQuote, metaAllocationPaise:800000 },verificationPolicy),{code:'23514'});
    await assert.rejects(claim(verificationQuote,{ ...verificationPolicy, serviceScope:'Annual service for a verification charge' }),{code:'23514'});
  });
  await check(`${database}: saved order identity and capture effects cannot be repriced`, async () => {
    await assert.rejects(db.query("update private.production_payment_orders set amount_paise=2000 where id=$1",[testOrder.id]),{code:'23514'});
    await assert.rejects(db.query("update private.production_payment_effects set amount_paise=1000000 where order_id=$1 and kind='capture'",[testOrder.id]),{code:'23514'});
    const captured = await complete(annualOrder,'annual');
    assert.equal(captured.captured_paise,1000000);
    const balance = await service("select public.customer_ad_balance($1,$2,'acc_pricing') as result",[business,owner]);
    assert.equal(balance.capturedPaise,1001000);
    assert.equal(balance.serviceAllocationPaise,200000);
    assert.equal(balance.advertisingAllocationPaise,800000);
    assert.equal(balance.remainingPaise,800000);
    assert.equal(balance.held,false);
  });
  await check(`${database}: configurable annual allocations conserve paise and bound earning`, async () => {
    const other = randomUUID();
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Synthetic revised price')",[other,owner]);
    const value = await quote(50005);
    const payment = (await claim(value,await terms(value),randomUUID(),other)).order;
    await complete(payment,'revised');
    await db.query("insert into private.production_payment_operators(user_id,approval_reference,can_refund,expires_at) values ($1,$2,true,clock_timestamp()+interval '1 hour')",[owner,randomUUID()]);
    await service("select public.customer_ad_refund_allocation($1,$2,'acc_pricing',$3,0,0,10001,$4) as result",[other,owner,payment.id,randomUUID()]);
    await assert.rejects(service("select public.customer_ad_refund_allocation($1,$2,'acc_pricing',$3,0,0,200000,$4) as result",[other,owner,payment.id,randomUUID()]),{code:'23514'});
    const balance = await service("select public.customer_ad_balance($1,$2,'acc_pricing') as result",[other,owner]);
    assert.equal(balance.serviceAllocationPaise,10001);
    assert.equal(balance.advertisingAllocationPaise,40004);
    assert.equal(balance.serviceEarnedPaise,10001);
    await service("select public.production_payment_observe($1,'acc_pricing','rzp_live_pricing','pay_revised',true,33,false,$2,'rfnd_revised',33,'processed') as result",[payment.id,'e'.repeat(64)]);
    assert.equal((await service("select public.customer_ad_balance($1,$2,'acc_pricing') as result",[other,owner])).held,true);
    await service("select public.customer_ad_refund_allocation($1,$2,'acc_pricing',$3,0,33,10001,$4) as result",[other,owner,payment.id,randomUUID()]);
    const adjusted = await service("select public.customer_ad_balance($1,$2,'acc_pricing') as result",[other,owner]);
    assert.equal(adjusted.held,false);
    assert.equal(adjusted.remainingPaise,39971);
  });
  const shop = async name => {
    const id = randomUUID();
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,$3)",[id,owner,name]);
    return id;
  };
  const claimFor = async (amount,businessId,key = randomUUID()) => {
    const value = await quote(amount);
    return claim(value,await terms(value),key,businessId);
  };
  const ready = (order,suffix) => service("select public.production_payment_order_result($1,'acc_pricing','rzp_live_pricing',$2) as result",[order.id,`order_${suffix.replace(/\W|_/g,'')}`]);
  const capture = (order,suffix) => service("select public.production_payment_observe($1,'acc_pricing','rzp_live_pricing',$2,true,0,false,$3) as result",[order.id,`pay_${suffix.replace(/\W|_/g,'')}`,'c'.repeat(64)]);
  const stateOf = async order => (await db.query("select state,captured_paise::int as captured_paise,superseded_at is not null as superseded from private.production_payment_orders where id=$1",[order.id])).rows[0];
  const balanceOf = businessId => service("select public.customer_ad_balance($1,$2,'acc_pricing') as result",[businessId,owner]);
  await check(`${database}: customer-chosen annual amounts stay inside INR 500 to INR 10,000 and split exactly (#212)`, async () => {
    for (const amount of [100,49999]) await assert.rejects(claimFor(amount,await shop('Synthetic below minimum')),{code:'23514'});
    await assert.rejects(claim({ ...await quote(1000000),totalPaise:1000001 },legacyPolicy,randomUUID(),await shop('Synthetic above maximum')),{code:'23514'});
    for (const amount of [50000,50005,1000000]) {
      const order = (await claimFor(amount,await shop('Synthetic bounds'))).order;
      assert.equal(order.amount_paise,amount);
      assert.equal(order.quote.serviceAllocationPaise,Math.floor(amount/5));
      assert.equal(order.quote.serviceAllocationPaise+order.quote.metaAllocationPaise,amount);
    }
  });
  await check(`${database}: an unpaid order is replaced and kept, and a duplicate request reuses it (#212)`, async () => {
    const business = await shop('Synthetic replace');
    const [keyA,keyB] = [randomUUID(),randomUUID()];
    const first = await claimFor(100000,business,keyA);
    assert.equal(first.claimed,true);
    assert.equal(first.order.state,'creating');
    await assert.rejects(claimFor(250000,business),{code:'23514'});
    assert.equal((await ready(first.order,'replace_a')).state,'created');
    const duplicate = await claimFor(100000,business);
    assert.equal(duplicate.claimed,false);
    assert.equal(duplicate.order.id,first.order.id);
    const second = await claimFor(250000,business,keyB);
    assert.equal(second.claimed,true);
    assert.notEqual(second.order.id,first.order.id);
    assert.deepEqual(await stateOf(first.order),{ state:'superseded',captured_paise:0,superseded:true });
    assert.equal((await db.query("select count(*)::int as count from private.production_payment_orders where business_id=$1 and purpose='annual'",[business])).rows[0].count,2);
    assert.equal((await db.query("select count(*)::int as count from private.production_payment_orders where business_id=$1 and purpose='annual' and captured_paise=0 and superseded_at is null",[business])).rows[0].count,1);
    assert.equal((await claimFor(250000,business,keyB)).order.id,second.order.id);
    const replayed = await claimFor(100000,business,keyA);
    assert.equal(replayed.claimed,false);
    assert.equal(replayed.order.state,'superseded');
    const sameBusiness = await shop('Synthetic double click');
    const duplicates = await Promise.all([claimFor(125000,sameBusiness),claimFor(125000,sameBusiness)]);
    assert.equal(duplicates.filter(result => result.claimed).length,1);
    assert.equal(duplicates[0].order.id,duplicates[1].order.id);
  });
  await check(`${database}: an order that is paid, held or has unprocessed events is never replaced (#212)`, async () => {
    const business = await shop('Synthetic unreplaceable');
    const open = (await claimFor(100000,business)).order;
    await ready(open,'hold_a');
    for (const column of ['review_required','refund_hold']) {
      await db.query(`update private.production_payment_orders set ${column}=true where id=$1`,[open.id]);
      await assert.rejects(claimFor(200000,business),{code:'23514'});
      await db.query(`update private.production_payment_orders set ${column}=false where id=$1`,[open.id]);
    }
    await service("select public.production_payment_event_receive('acc_pricing','rzp_live_pricing',$1,'evt_replace_pending',$2,'pay_replacepending','order_holda',null,'pending') as result",[randomUUID(),'a'.repeat(64)]);
    await assert.rejects(claimFor(200000,business),{code:'23514'});
    await db.query("update private.production_payment_events set processed_at=clock_timestamp() where event_id='evt_replace_pending'");
    assert.equal((await claimFor(200000,business)).claimed,true);
    assert.equal((await stateOf(open)).state,'superseded');
    const next = (await claimFor(200000,business)).order;
    await ready(next,'hold_n');
    const paid = (await claimFor(300000,business)).order;
    assert.equal((await stateOf(next)).state,'superseded');
    await ready(paid,'hold_b');
    await capture(paid,'hold_b');
    const topUp = await claimFor(300000,business);
    assert.equal(topUp.claimed,true);
    assert.notEqual(topUp.order.id,paid.id);
    assert.equal((await stateOf(paid)).state,'captured');
    await db.query("delete from private.production_payment_events where event_id='evt_replace_pending'");
  });
  await check(`${database}: paid top-ups add up, including the same amount twice, and a duplicate capture counts once (#212)`, async () => {
    const business = await shop('Synthetic top-ups');
    const payments = [];
    for (const [index,amount] of [250000,100000,100000].entries()) {
      const order = (await claimFor(amount,business)).order;
      await ready(order,`topup_${index}`);
      assert.equal((await capture(order,`topup_${index}`)).state,'captured');
      payments.push(order);
    }
    assert.equal(new Set(payments.map(order => order.id)).size,3);
    await capture(payments[2],'topup_2');
    const balance = await balanceOf(business);
    assert.equal(balance.capturedPaise,450000);
    assert.equal(balance.serviceAllocationPaise,90000);
    assert.equal(balance.advertisingAllocationPaise,360000);
    assert.equal(balance.remainingPaise,360000);
    assert.equal(balance.held,false);
    assert.equal((await db.query("select count(*)::int as count from private.production_payment_effects where order_id=$1 and kind='capture'",[payments[2].id])).rows[0].count,1);
    assert.equal((await db.query("select count(*)::int as count from private.production_payment_orders where business_id=$1 and superseded_at is not null",[business])).rows[0].count,0);
  });
  await check(`${database}: a late payment on a replaced order is credited exactly once (#212)`, async () => {
    const business = await shop('Synthetic late payment');
    const replaced = (await claimFor(100000,business)).order;
    await ready(replaced,'late_a');
    const current = (await claimFor(150000,business)).order;
    assert.equal((await stateOf(replaced)).state,'superseded');
    assert.equal((await balanceOf(business)).advertisingAllocationPaise,0);
    const late = await capture(replaced,'late_a');
    assert.equal(late.state,'captured');
    assert.equal(late.captured_paise,100000);
    await capture(replaced,'late_a');
    const balance = await balanceOf(business);
    assert.equal(balance.capturedPaise,100000);
    assert.equal(balance.advertisingAllocationPaise,80000);
    assert.equal(balance.held,false);
    assert.equal((await db.query("select count(*)::int as count from private.production_payment_effects where order_id=$1 and kind='capture'",[replaced.id])).rows[0].count,1);
    assert.equal((await stateOf(current)).state,'creating');
    await ready(current,'late_b');
    assert.equal((await claimFor(200000,business)).claimed,true);
    assert.equal((await stateOf(replaced)).state,'captured');
  });
  await check(`${database}: expired saved verification can still capture and refund its own amount`, async () => {
    const other = randomUUID();
    const order = randomUUID();
    const value = await quote(1000,true);
    const policy = await terms(value,{ ...verification,businessId:other,expiresAt:new Date(Date.now()-60_000).toISOString() });
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Synthetic expired verification')",[other,owner]);
    await db.query("insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,amount_paise,quote,terms,terms_hash) values ($1,$2,$3,$4,'acc_pricing','rzp_live_pricing',1000,$5,$6,$7)",[order,other,owner,randomUUID(),value,policy,'d'.repeat(64)]);
    await complete({id:order},'expired');
    const refunded = await service("select public.production_payment_observe($1,'acc_pricing','rzp_live_pricing','pay_expired',true,1000,false,$2,'rfnd_expired',1000,'processed') as result",[order,'e'.repeat(64)]);
    assert.equal(refunded.state,'refunded');
    assert.equal(refunded.refunded_paise,1000);
    const balance = await service("select public.customer_ad_balance($1,$2,'acc_pricing') as result",[other,owner]);
    assert.equal(balance.advertisingAllocationPaise,0);
    assert.equal(balance.held,false);
    const invalid = await service("select public.production_payment_observe($1,'acc_pricing','rzp_live_pricing','pay_expired',true,1001,false,$2,'rfnd_excess',1001,'processed') as result",[order,'e'.repeat(64)]);
    assert.equal(invalid.state,'review_required');
    assert.equal(invalid.refunded_paise,1000);
    assert.equal((await service("select public.customer_ad_balance($1,$2,'acc_pricing') as result",[other,owner])).held,true);
  });
  await check(`${database}: webhook health counts captures without a capture event (#178)`, async () => {
    const health = () => service("select public.production_payment_webhook_health('acc_pricing') as result");
    const recent = await health();
    assert.equal(recent.capturedWithoutEvent,0,'fresh captures are inside the grace period');
    await db.query("update private.production_payment_orders set updated_at=clock_timestamp()-interval '1 hour' where account_id='acc_pricing'");
    const captured = (await db.query("select count(*)::int as count from private.production_payment_orders where account_id='acc_pricing' and captured_paise>0")).rows[0].count;
    assert.ok(captured > 0);
    assert.equal((await health()).capturedWithoutEvent,captured);
    const receive = eventId => service("select public.production_payment_event_receive('acc_pricing','rzp_live_pricing',$1,$2,$3,'pay_verification','order_verification',null,'capture') as result",[randomUUID(),eventId,'a'.repeat(64)]);
    await receive('evt_health');
    await receive('evt_health');
    const after = await health();
    assert.equal(after.capturedWithoutEvent,captured-1);
    assert.equal(after.events7d,1,'a duplicate delivery is stored once');
    assert.equal(after.unprocessed,0,'unprocessed counts only events older than an hour');
    assert.equal((await service("select public.production_payment_webhook_health('acc_other') as result")).events7d,0);
  });
  await check(`${database}: pricing objects remain inaccessible to browser roles`, async () => {
    for (const role of ['anon','authenticated']) {
      const session = client(database);
      await session.connect();
      try {
        await session.query(`set role ${role}`);
        await assert.rejects(session.query("select * from private.production_payment_orders"),{code:'42501'});
        await assert.rejects(session.query("select public.production_payment_orders_list($1,$2)",[business,owner]),{code:'42501'});
        await assert.rejects(session.query("select public.production_payment_webhook_health('acc_pricing')"),{code:'42501'});
      } finally { await session.end(); }
    }
  });
}

async function verifyCustomerAllowance(db, database) {
  const owner = randomUUID();
  const business = randomUUID();
  const order = randomUUID();
  const campaignIds = [randomUUID(), randomUUID()];
  const quote = { version: "inr-annual-total-v1", merchantDisplay: "Vanshul Goyal", currency: "INR", totalPaise: 1000000,
    serviceAllocationPaise: 200000, metaAllocationPaise: 800000, additionalCustomerTaxPaise: 0,
    metaTaxTreatment: "included-in-meta-allocation", gatewayFees: "absorbed-by-adbrain", automaticRenewal: false };
  await db.query("insert into auth.users(id) values ($1)", [owner]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Synthetic allowance')", [business, owner]);
  await db.query("insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id,page_id) values ($1,1,'connected','act_123','123')", [business]);
  await db.query("insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,quote,terms,terms_hash,provider_order_id) values ($1,$2,$3,$4,'acc_fixture','rzp_live_fixture',$5,$6,$7,'order_allowance')", [order,business,owner,randomUUID(),quote,{version:'operator-managed-v1',fundingMode:'operator_managed'},'a'.repeat(64)]);
  for (const campaignId of campaignIds) await db.query("insert into public.campaigns(id,business_id,status,daily_budget,meta_campaign_id,meta_ad_account_id,meta_page_id,meta_connection_generation) values ($1,$2,'paused',200,$3,'act_123','123',1)", [campaignId,business,`meta_${campaignId}`]);
  await db.query("insert into private.production_payment_operators(user_id,approval_reference,can_refund,expires_at) values ($1,$2,true,now()+interval '1 hour')", [owner,randomUUID()]);
  const service = async (sql, values) => {
    const session = client(database);
    await session.connect();
    try { await session.query("set role service_role"); return (await session.query(sql, values)).rows[0]?.result; }
    finally { await session.end(); }
  };
  const balance = (user = owner, account = 'acc_fixture') => service("select public.customer_ad_balance($1,$2,$3) as result",[business,user,account]);
  const reserve = (campaignId, account = 'act_123') => service("select public.customer_ad_reserve($1,$2,'acc_fixture',$3,$4,1,20000,$5) as result",[business,owner,campaignId,account,'b'.repeat(64)]);
  const observedAt = new Date().toISOString();
  const costs = (campaignId, media = 0, tax = 0, reference = randomUUID(), asOf = observedAt, final = false, reservationId = null) => service(
    "select public.customer_ad_reconcile_costs($1,$2,'acc_fixture',$3,'act_123',1,$4,$5,1800,$6,$7,$8,$9)", [business,owner,campaignId,media,tax,asOf,reference,final,reservationId]);
  await check(`${database}: no credit before verified capture and tenant/merchant isolation`, async () => {
    assert.equal((await balance()).remainingPaise,0);
    await assert.rejects(balance(randomUUID()), {code:'42501'});
    assert.equal((await balance(owner,'acc_other')).remainingPaise,0);
    await assert.rejects(reserve(campaignIds[0]), {code:'23514'});
    for (let repeat=0; repeat<2; repeat++) await service("select public.production_payment_observe($1,'acc_fixture','rzp_live_fixture','pay_allowance',true,0,false,$2)",[order,'c'.repeat(64)]);
    assert.equal((await balance()).capturedPaise,1000000);
    assert.equal((await balance()).serviceEarnedPaise,0);
    assert.equal((await balance()).remainingPaise,800000);
  });
  await check(`${database}: current costs and account binding required before concurrent reservations`, async () => {
    await assert.rejects(reserve(campaignIds[0]), {code:'23514'});
    for (const campaignId of campaignIds) await costs(campaignId);
    await assert.rejects(reserve(campaignIds[0],'act_999'), {code:'23514'});
    const results = await Promise.allSettled(campaignIds.map(campaignId=>reserve(campaignId)));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal((await balance()).reservedPaise,800000);
    assert.equal((await balance()).remainingPaise,0);
  });
  const reservation = (await db.query("select * from private.customer_ad_reservations where business_id=$1",[business])).rows[0];
  await check(`${database}: active campaign cannot change provider identity without a new cap`, async () => {
    await db.query("update public.campaigns set status='active' where id=$1",[reservation.campaign_id]);
    try {
      await assert.rejects(db.query("update public.campaigns set meta_campaign_id='meta_rebound' where id=$1",[reservation.campaign_id]), {code:'23514'});
    } finally {
      await db.query("update public.campaigns set status='paused',meta_campaign_id=$2 where id=$1",[reservation.campaign_id,`meta_${reservation.campaign_id}`]);
    }
  });
  await check(`${database}: paused reservation keeps its provider campaign identity`, async () => {
    assert.equal(reservation.meta_campaign_id,`meta_${reservation.campaign_id}`);
    await assert.rejects(db.query("update public.campaigns set meta_campaign_id='meta_rebound' where id=$1",[reservation.campaign_id]), {code:'23514'});
  });
  await check(`${database}: uncertain activation and refunds cannot free or double-use funds`, async () => {
    assert.equal(Number(reservation.media_limit_paise),677966);
    await assert.rejects(reserve(reservation.campaign_id), {code:'23514'});
    await assert.rejects(service("select public.production_payment_refund_claim($1,'acc_fixture','rzp_live_fixture',$2,$3,$4,10000,$5,$6,'Synthetic refund')",[order,owner,randomUUID(),randomUUID(),'a'.repeat(64),randomUUID()]), {code:'23514'});
    await assert.rejects(costs(reservation.campaign_id,0,0,randomUUID(),observedAt,true,reservation.id), {code:'23514'});
    await assert.rejects(db.query("update public.campaigns set status='active',daily_budget=10000 where id=$1",[reservation.campaign_id]), {code:'23514'});
    await db.query("update public.campaigns set status='paused' where id=$1",[reservation.campaign_id]);
    await service("select public.customer_ad_activation_result($1,$2,'acc_fixture',$3,$4,'paused')",[business,owner,reservation.campaign_id,reservation.id]);
    await assert.rejects(costs(reservation.campaign_id,0,0,randomUUID(),'now',true,reservation.id), {code:'23514'});
    assert.equal((await db.query("select activation_in_flight from private.customer_ad_reservations where id=$1",[reservation.id])).rows[0].activation_in_flight,true);
    await service("select public.customer_ad_activation_result($1,$2,'acc_fixture',$3,$4,'uncertain')",[business,owner,reservation.campaign_id,reservation.id]);
  });
  await check(`${database}: cumulative media/tax snapshots deduplicate without dropping late liability`, async () => {
    const reference=randomUUID();
    await costs(reservation.campaign_id,10000,1800,reference);
    await costs(reservation.campaign_id,10000,1800,reference);
    await costs(reservation.campaign_id,10000,1800);
    const current=await balance();
    assert.equal(current.mediaCostPaise,10000);
    assert.equal(current.taxCostPaise,1800);
    assert.equal(current.reservedPaise,788200);
    assert.equal(current.remainingPaise,0);
    await assert.rejects(costs(reservation.campaign_id,10001,1800,reference), {code:'23514'});
  });
  await check(`${database}: reconciled pause permits explicit refund allocation, not automatic service earnings`, async () => {
    await service("select public.customer_ad_activation_result($1,$2,'acc_fixture',$3,$4,'paused')",[business,owner,reservation.campaign_id,reservation.id]);
    await assert.rejects(costs(reservation.campaign_id,10000,1800,randomUUID(),observedAt,true,reservation.id), {code:'23514'});
    for (const campaignId of campaignIds) await costs(campaignId,campaignId===reservation.campaign_id?10000:0,campaignId===reservation.campaign_id?1800:0,randomUUID(),'now',true,campaignId===reservation.campaign_id?reservation.id:null);
    assert.equal((await balance()).reservedPaise,0);
    assert.equal((await balance()).remainingPaise,788200);
    const operation=await service("select public.production_payment_refund_claim($1,'acc_fixture','rzp_live_fixture',$2,$3,$4,10000,$5,$6,'Synthetic reconciled refund') as result",[order,owner,randomUUID(),randomUUID(),'a'.repeat(64),randomUUID()]);
    await service("select public.production_payment_refund_result($1,'acc_fixture','rzp_live_fixture','rfnd_allowance')",[operation.refund.id]);
    await service("select public.production_payment_observe($1,'acc_fixture','rzp_live_fixture','pay_allowance',true,10000,false,$2,'rfnd_allowance',10000,'processed')",[order,'d'.repeat(64)]);
    await service("select public.production_payment_refund_observed($1,'acc_fixture','rfnd_allowance',10000,'processed')",[operation.refund.id]);
    assert.equal((await balance()).held,true);
    const allocation=()=>service("select public.customer_ad_refund_allocation($1,$2,'acc_fixture',$3,0,10000,0,$4)",[business,owner,order,reference]);
    const reference=randomUUID();
    await allocation();
    await allocation();
    assert.equal((await balance()).held,false);
    assert.equal((await balance()).remainingPaise,778200);
    assert.equal((await balance()).serviceEarnedPaise,0);
  });
  await check(`${database}: refund initiation and new reservation have one atomic winner`, async () => {
    const results=await Promise.allSettled([
      reserve(reservation.campaign_id),
      service("select public.production_payment_refund_claim($1,'acc_fixture','rzp_live_fixture',$2,$3,$4,10000,$5,$6,'Synthetic concurrent refund')",[order,owner,randomUUID(),randomUUID(),'a'.repeat(64),randomUUID()]),
    ]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  });
  await check(`${database}: a decreasing fresh snapshot holds rather than restoring credit`, async () => {
    await costs(reservation.campaign_id,9000,1700,randomUUID(),new Date().toISOString());
    assert.equal((await balance()).held,true);
    assert.equal((await balance()).mediaCostPaise,10000);
  });
  await check(`${database}: browser and direct service mutations remain denied`, async () => {
    await assert.rejects(service("update private.customer_ad_reservations set ceiling_paise=1"), {code:'42501'});
    await db.query("set role authenticated");
    try { await assert.rejects(db.query("select public.customer_ad_balance($1,$2,'acc_fixture')",[business,owner]),{code:'42501'}); }
    finally { await db.query("reset role"); }
  });
}

async function verifyCappedRunBound(db, database) {
  const service = async (sql, values) => {
    const session = client(database);
    await session.connect();
    try { await session.query("set role service_role"); return (await session.query(sql, values)).rows[0]?.result; }
    finally { await session.end(); }
  };
  const quote = { version: "inr-annual-total-v1", merchantDisplay: "Vanshul Goyal", currency: "INR", totalPaise: 1000000,
    serviceAllocationPaise: 200000, metaAllocationPaise: 800000, additionalCustomerTaxPaise: 0,
    metaTaxTreatment: "included-in-meta-allocation", gatewayFees: "absorbed-by-adbrain", automaticRenewal: false };
  const account = "acc_capped";
  // Replaying older payment migrations restores a pre-priced funding check; reinstate the current one.
  await db.query("alter table private.production_payment_orders drop constraint if exists production_payment_funding_mode_check");
  await db.query(configurablePaymentMigration.match(/alter table private\.production_payment_orders add constraint production_payment_funding_mode_check[\s\S]*?\) is true\);/)[0]);
  const fixture = async (dailyRupees, amountPaise = 1000000, { operator = true } = {}) => {
    const owner = randomUUID(), business = randomUUID(), order = randomUUID(), campaign = randomUUID();
    await db.query("insert into auth.users(id) values ($1)", [owner]);
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Synthetic capped run')", [business,owner]);
    await db.query("insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id,page_id) values ($1,1,'connected','act_123','123')", [business]);
    const contract = amountPaise === 1000000 ? { quote, terms: {version:'operator-managed-v1',fundingMode:'operator_managed'} }
      : (await db.query("select q as quote, private.production_payment_priced_policy(q,null) as terms from private.production_payment_quote($1::bigint,false) q",[amountPaise])).rows[0];
    const pay = async (paid = order) => {
      await db.query("insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,quote,terms,terms_hash,provider_order_id,amount_paise) values ($1,$2,$3,$4,$5,'rzp_live_fixture',$6,$7,$8,$9,$10)",
        [paid,business,owner,randomUUID(),account,contract.quote,contract.terms,'a'.repeat(64),`order_${paid.replaceAll("-","")}`,amountPaise]);
      await service("select public.production_payment_observe($1,$2,'rzp_live_fixture',$3,true,0,false,$4)",[paid,account,`pay_${paid.replaceAll("-","")}`,paid.replaceAll("-","").padEnd(64,'f')]);
    };
    await pay();
    await db.query("insert into public.campaigns(id,business_id,status,daily_budget,meta_campaign_id,meta_ad_account_id,meta_page_id,meta_connection_generation) values ($1,$2,'paused',$3,$4,'act_123','123',1)", [campaign,business,dailyRupees,`meta_${campaign}`]);
    await db.query("insert into private.production_payment_operators(user_id,approval_reference,can_refund,expires_at) values ($1,$2,true,now()+interval '1 hour')", [owner,randomUUID()]);
    const run = {
      balance: () => service("select public.customer_ad_balance($1,$2,$3) as result",[business,owner,account]),
      costs: (media, tax) => service("select public.customer_ad_reconcile_costs($1,$2,$3,$4,'act_123',1,$5,$6,1800,$7,$8,false,null)",
        [business,owner,account,campaign,media,tax,new Date().toISOString(),randomUUID()]),
      reserve: (cap = null) => service("select public.customer_ad_reserve($1,$2,$3,$4,'act_123',1,$5,$6,false,$7) as result",[business,owner,account,campaign,dailyRupees*100,'e'.repeat(64),cap]),
      result: (reservationId, state) => service("select public.customer_ad_activation_result($1,$2,$3,$4,$5,$6)",[business,owner,account,campaign,reservationId,state]),
      activate: async (reservationId) => { await run.result(reservationId,'active'); await db.query("update public.campaigns set status='active' where id=$1",[campaign]); },
      age: () => db.query("update private.customer_ad_costs set observed_at=clock_timestamp()-interval '20 minutes' where campaign_id=$1",[campaign]),
      bound: async () => (await db.query("select bounded_media_paise from private.customer_ad_reservations where campaign_id=$1",[campaign])).rows[0].bounded_media_paise,
      hold: (held) => db.query("update private.customer_ad_costs set held=$2 where campaign_id=$1",[campaign,held]),
      pause: async (reservationId) => { await db.query("update public.campaigns set status='paused' where id=$1",[campaign]); await run.result(reservationId,'paused'); },
      observe: (media, user = owner, adAccount = 'act_123', generation = 1) => service("select public.customer_ad_observe_costs($1,$2,$3,$4,$5,$6,$7) as result",
        [business,user,account,campaign,adAccount,generation,media]),
      final: (reservationId, media, tax) => service("select public.customer_ad_reconcile_costs($1,$2,$3,$4,'act_123',1,$5,$6,1800,$7,$8,true,$9)",
        [business,owner,account,campaign,media,tax,new Date().toISOString(),randomUUID(),reservationId]),
      cost: async () => (await db.query("select media_paise::int as media, tax_paise::int as tax, tax_rate_bps as rate, held, finalized from private.customer_ad_costs where campaign_id=$1",[campaign])).rows[0],
      evidence: async () => (await db.query("select actor_id, input from private.customer_ad_cost_evidence where campaign_id=$1 and input->>'source'='meta' order by created_at desc limit 1",[campaign])).rows[0],
      settle: async (reservationId, media) => (await service("select public.customer_ad_settle_costs($1,$2,$3,$4,'act_123',1,$5,$6) as result",
        [business,owner,account,campaign,reservationId,media])).finalized,
      // Moves the pause and every recorded read back in time, as if `minutes` had passed.
      rewind: async (minutes) => {
        await db.query("update private.customer_ad_reservations set updated_at=updated_at-make_interval(mins=>$2) where campaign_id=$1",[campaign,minutes]);
        await db.query("update private.customer_ad_cost_evidence set created_at=created_at-make_interval(mins=>$2) where campaign_id=$1",[campaign,minutes]);
      },
      state: async () => (await db.query("select state from private.customer_ad_reservations where campaign_id=$1",[campaign])).rows[0]?.state,
      pay: () => pay(randomUUID()),
      business, owner, campaign,
    };
    if (!operator) { await db.query("delete from private.production_payment_operators where user_id=$1",[owner]); return run; }
    await run.costs(0,0);
    return run;
  };
  // ₹1,000/day: 7 days + GST (826000) exceeds the ₹8,000 allocation; a 3-day cap + GST (354000) fits.
  const capped = await fixture(1000);
  let reservationId;
  await check(`${database}: capped reserve needs the cap plus GST, not seven daily budgets (#208)`, async () => {
    await assert.rejects(capped.reserve(), {code:'23514'});
    await assert.rejects(capped.reserve(700000), {code:'23514'});
    await assert.rejects(capped.reserve(0), {code:'23514'});
    ({ reservationId } = await capped.reserve(300000));
    assert.equal(Number(await capped.bound()),300000);
  });
  await check(`${database}: funded capped run is not held when its cost evidence ages (#208)`, async () => {
    await capped.activate(reservationId);
    await capped.age();
    const current = await capped.balance();
    assert.equal(current.held,false);
    assert.equal(current.reservedPaise,800000);
    await capped.costs(100000,18000);
    await capped.age();
    assert.equal((await capped.balance()).held,false);
  });
  await check(`${database}: the same run uncapped is held when its cost evidence ages`, async () => {
    const uncapped = await fixture(280);
    const { reservationId: id } = await uncapped.reserve();
    assert.equal(await uncapped.bound(),null);
    await uncapped.activate(id);
    assert.equal((await uncapped.balance()).held,false);
    await uncapped.age();
    assert.equal((await uncapped.balance()).held,true);
  });
  await check(`${database}: explicit cost holds still hold a capped run`, async () => {
    await capped.hold(true);
    assert.equal((await capped.balance()).held,true);
    await capped.hold(false);
    assert.equal((await capped.balance()).held,false);
  });
  await check(`${database}: a new capped reservation rebases its bound on attributed media`, async () => {
    await capped.pause(reservationId);
    await capped.costs(100000,18000);
    const next = await capped.reserve(200000);
    assert.notEqual(next.reservationId,reservationId);
    assert.equal(Number(await capped.bound()),300000);
    await capped.activate(next.reservationId);
    await capped.age();
    assert.equal((await capped.balance()).held,false);
  });
  await check(`${database}: cost evidence above the capped bound holds the balance`, async () => {
    await capped.costs(300001,54001);
    assert.equal((await capped.balance()).held,true);
  });
  // #212 plan: a ₹1,250 order leaves ₹1,000 for ads; ₹280 × 3 = 84000 needs ceil(84000 × 1.18) = 99120.
  await check(`${database}: ₹1,000 for ads runs ₹280 × 3 capped and rejects it uncapped (#208/#212)`, async () => {
    const run = await fixture(280, 125000);
    await assert.rejects(run.reserve(), {code:'23514'});
    const { reservationId: id } = await run.reserve(84000);
    await run.activate(id);
    assert.equal(Number(await run.bound()),84000);
    await run.age();
    assert.equal((await run.balance()).held,false);
    await run.costs(84001,15121);
    assert.equal((await run.balance()).held,true);
  });
  await check(`${database}: capped admission boundary is cap × 1.18 (99120 accepted, 99119 rejected)`, async () => {
    // amount − amount/5: 123898 leaves 99119 for ads, 123900 leaves 99120.
    await assert.rejects((await fixture(280, 123898)).reserve(84000), {code:'23514'});
    const run = await fixture(280, 123900);
    const { reservationId: id } = await run.reserve(84000);
    await run.activate(id);
    assert.equal((await run.balance()).held,false);
  });
  await check(`${database}: the guard still rejects an uncapped activation under seven-day headroom`, async () => {
    const run = await fixture(280, 125000);
    const { reservationId: id } = await run.reserve(84000);
    await db.query("update private.customer_ad_reservations set bounded_media_paise=null where id=$1",[id]);
    await assert.rejects(run.activate(id), {code:'23514'});
  });
  await check(`${database}: an uncapped reservation after a capped run clears the bound`, async () => {
    const run = await fixture(280);
    const first = await run.reserve(84000);
    await run.activate(first.reservationId);
    await run.pause(first.reservationId);
    const next = await run.reserve();
    assert.notEqual(next.reservationId,first.reservationId);
    assert.equal(await run.bound(),null);
    await run.activate(next.reservationId);
    await run.age();
    assert.equal((await run.balance()).held,true);
  });
  await check(`${database}: Meta-read evidence lets a paying customer reserve and activate with no operator (#216)`, async () => {
    const run = await fixture(280, 125000, { operator: false });
    await assert.rejects(run.costs(0,0), {code:'42501'});
    await assert.rejects(run.reserve(84000), {code:'23514'});
    assert.deepEqual(await run.observe(0).then(result => [result.mediaPaise,result.taxPaise,result.taxRateBps]), [0,0,1800]);
    const evidence = await run.evidence();
    assert.equal(evidence.actor_id,null);
    assert.equal(evidence.input.final,false);
    const { reservationId: id } = await run.reserve(84000);
    await run.activate(id);
    assert.equal((await run.balance()).held,false);
    await run.age();
    assert.equal((await run.balance()).held,false);
    await run.observe(3263);
    assert.deepEqual(await run.cost(), { media:3263, tax:588, rate:1800, held:false, finalized:false });
  });
  await check(`${database}: Meta-read evidence never lowers figures, finalizes or clears a hold (#216)`, async () => {
    const run = await fixture(280);
    await run.costs(1000,200);
    await run.observe(500);
    assert.deepEqual(await run.cost(), { media:1000, tax:200, rate:1800, held:false, finalized:false });
    await run.observe(3263);
    assert.deepEqual(await run.cost(), { media:3263, tax:588, rate:1800, held:false, finalized:false });
    await run.hold(true);
    await run.observe(4000);
    assert.deepEqual(await run.cost(), { media:4000, tax:720, rate:1800, held:true, finalized:false });
    assert.equal((await run.balance()).held,true);
  });
  await check(`${database}: Meta-read evidence is bound to the owner, campaign, ad account, generation and a live order (#216)`, async () => {
    const run = await fixture(280, 125000, { operator: false });
    const stranger = randomUUID();
    await db.query("insert into auth.users(id) values ($1)", [stranger]);
    await assert.rejects(run.observe(0, stranger), {code:'23514'});
    await assert.rejects(run.observe(0, run.owner, 'act_999'), {code:'23514'});
    await assert.rejects(run.observe(0, run.owner, 'act_123', 2), {code:'23514'});
    await assert.rejects(run.observe(-1), {code:'23514'});
    assert.equal(await run.cost(), undefined);
    const owner = randomUUID(), business = randomUUID(), campaign = randomUUID();
    await db.query("insert into auth.users(id) values ($1)", [owner]);
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Synthetic unpaid')", [business,owner]);
    await db.query("insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id,page_id) values ($1,1,'connected','act_123','123')", [business]);
    await db.query("insert into public.campaigns(id,business_id,status,daily_budget,meta_campaign_id,meta_ad_account_id,meta_page_id,meta_connection_generation) values ($1,$2,'paused',280,$3,'act_123','123',1)", [campaign,business,`meta_${campaign}`]);
    await assert.rejects(service("select public.customer_ad_observe_costs($1,$2,$3,$4,'act_123',1,0)",[business,owner,account,campaign]), {code:'23514'});
    for (const role of ['anon','authenticated']) {
      const session = client(database);
      await session.connect();
      try {
        await session.query(`set role ${role}`);
        await assert.rejects(session.query("select public.customer_ad_observe_costs($1,$2,$3,$4,'act_123',1,0)",[run.business,run.owner,account,run.campaign]),{code:'42501'});
      } finally { await session.end(); }
    }
  });
  await check(`${database}: final evidence stays operator-only after Meta-read evidence, and a closed or never-reserved run does not hold when it ages (#216)`, async () => {
    const run = await fixture(280);
    await run.observe(0);
    await run.age();
    assert.equal((await run.balance()).held,false);
    await run.observe(0);
    const { reservationId: id } = await run.reserve(84000);
    await run.activate(id);
    await run.observe(2000);
    await run.pause(id);
    await run.final(id, 2000, 360);
    assert.deepEqual(await run.cost(), { media:2000, tax:360, rate:1800, held:false, finalized:true });
    await run.observe(2000);
    await run.age();
    assert.equal((await run.cost()).finalized,true);
    assert.equal((await run.balance()).held,false);
  });
  await check(`${database}: QA #219: a review read after final evidence leaves the closed run finalizable or finalized`, async () => {
    const run = await fixture(280);
    await run.observe(0);
    const { reservationId: id } = await run.reserve(84000);
    await run.activate(id);
    await run.pause(id);
    await run.final(id, 2000, 360);
    await run.observe(2000);
    const stillFinal = (await run.cost()).finalized;
    const refinalized = stillFinal || await run.final(id, 2000, 360).then(() => true, () => false);
    assert.ok(refinalized, "observe un-finalized a closed run and the operator cannot finalize it again, so customer_ad_refund_guard blocks every refund");
  });
  await check(`${database}: re-activating a finalized run reopens it as non-final (#216)`, async () => {
    const run = await fixture(280);
    const { reservationId: first } = await run.reserve(84000);
    await run.activate(first);
    await run.pause(first);
    await run.final(first, 2000, 360);
    await run.observe(2500);
    assert.deepEqual(await run.cost(), { media:2500, tax:450, rate:1800, held:false, finalized:true });
    const { reservationId: second } = await run.reserve(84000);
    await run.activate(second);
    assert.equal((await run.cost()).finalized,false);
    assert.equal((await run.balance()).held,false);
  });
  // #221: a paused run settles from Meta reads; while it settles only its own unused reserve is held.
  const settling = async (options) => {
    const run = await fixture(280, 1000000, options);
    await run.observe(0);
    const { reservationId: id } = await run.reserve();
    await run.activate(id);
    await run.observe(2000);
    await run.pause(id);
    return { run, id };
  };
  await check(`${database}: a paused run's stale evidence holds only its reserve, and campaign B activates with no operator (#221)`, async () => {
    const { run, id } = await settling({ operator: false });
    await run.age();
    let current = await run.balance();
    assert.equal(current.held,false);
    assert.equal(current.reservedPaise,800000-2000-360);
    assert.equal(current.remainingPaise,0);
    // A second paid order (live since #217, which this customer-only path does not replay).
    await db.query("drop index if exists private.production_payment_orders_active_business_idx");
    await run.pay();
    current = await run.balance();
    assert.equal(current.held,false);
    assert.equal(current.remainingPaise,800000);
    const other = randomUUID();
    await db.query("insert into public.campaigns(id,business_id,status,daily_budget,meta_campaign_id,meta_ad_account_id,meta_page_id,meta_connection_generation) values ($1,$2,'paused',280,$3,'act_123','123',1)", [other,run.business,`meta_${other}`]);
    await service("select public.customer_ad_observe_costs($1,$2,'acc_capped',$3,'act_123',1,0)",[run.business,run.owner,other]);
    const { reservationId: next } = await service("select public.customer_ad_reserve($1,$2,'acc_capped',$3,'act_123',1,28000,$4,false,null) as result",[run.business,run.owner,other,'e'.repeat(64)]);
    await service("select public.customer_ad_activation_result($1,$2,'acc_capped',$3,$4,'active')",[run.business,run.owner,other,next]);
    await db.query("update public.campaigns set status='active' where id=$1",[other]);
    current = await run.balance();
    assert.equal(current.held,false);
    assert.equal(current.reservedPaise,(800000-2000-360)+800000);
    assert.equal(await run.state(),'paused');
    assert.equal((await run.cost()).finalized,false);
    assert.equal(id.length,36);
  });
  await check(`${database}: two equal Meta reads 30 minutes apart, 3 hours after the pause, finalize and release the reserve (#221)`, async () => {
    const { run, id } = await settling({ operator: false });
    assert.equal(await run.settle(id, 2000),false);
    await run.rewind(240);
    assert.equal(await run.settle(id, 2000),true);
    assert.deepEqual(await run.cost(), { media:2000, tax:360, rate:1800, held:false, finalized:true });
    assert.equal(await run.state(),'closed');
    const evidence = await run.evidence();
    assert.equal(evidence.actor_id,null);
    assert.equal(evidence.input.final,true);
    assert.equal(evidence.input.settleRead,true);
    assert.equal(evidence.input.reservation,id);
    const current = await run.balance();
    assert.equal(current.held,false);
    assert.equal(current.reservedPaise,0);
    assert.equal(current.remainingPaise,800000-2000-360);
    await assert.rejects(run.settle(id, 2000), {code:'23514'});
  });
  await check(`${database}: unequal Meta reads do not finalize; a later equal pair does (#221)`, async () => {
    const { run, id } = await settling();
    await run.settle(id, 2000);
    await run.rewind(240);
    assert.equal(await run.settle(id, 2100),false);
    await run.rewind(20);
    assert.equal(await run.settle(id, 2000),false);
    await run.rewind(20);
    assert.equal(await run.settle(id, 2000),false, "a differing read after the first equal read restarts the window");
    assert.equal(await run.state(),'paused');
    await run.rewind(31);
    assert.equal(await run.settle(id, 2000),true);
    assert.equal((await run.cost()).media,2100, "figures never go down");
  });
  await check(`${database}: equal reads less than 3 hours after the pause do not finalize (#221)`, async () => {
    const { run, id } = await settling();
    await run.settle(id, 2000);
    await run.rewind(60);
    assert.equal(await run.settle(id, 2000),false);
    await run.rewind(110);
    assert.equal(await run.settle(id, 2000),false, "170 minutes after the pause");
    await run.rewind(10);
    assert.equal(await run.settle(id, 2000),true);
  });
  await check(`${database}: an explicit hold blocks system final evidence and is never cleared (#221)`, async () => {
    const { run, id } = await settling();
    await run.hold(true);
    await run.settle(id, 2000);
    await run.rewind(240);
    assert.equal(await run.settle(id, 2000),false);
    assert.deepEqual(await run.cost(), { media:2000, tax:360, rate:1800, held:true, finalized:false });
    assert.equal(await run.state(),'paused');
    assert.equal((await run.balance()).held,true);
  });
  await check(`${database}: without a Meta read the paused run keeps its reserve and is not final (#221)`, async () => {
    const { run } = await settling();
    await run.rewind(600);
    await run.age();
    const current = await run.balance();
    assert.equal(current.held,false);
    assert.equal(current.reservedPaise,800000-2000-360);
    assert.equal(await run.state(),'paused');
    assert.equal((await run.cost()).finalized,false);
    await assert.rejects(service("select public.production_payment_refund_claim($1,'acc_capped','rzp_live_fixture',$2,$3,$4,10000,$5,$6,'Synthetic refund')",
      [(await db.query("select id from private.production_payment_orders where business_id=$1",[run.business])).rows[0].id,run.owner,randomUUID(),randomUUID(),'a'.repeat(64),randomUUID()]), {code:'23514'});
  });
  await check(`${database}: an ended capped run, once paused, finalizes the same way (#221)`, async () => {
    const run = await fixture(280, 125000, { operator: false });
    await run.observe(0);
    const { reservationId: id } = await run.reserve(84000);
    await run.activate(id);
    await run.observe(84000);
    await run.pause(id);
    await run.age();
    assert.equal((await run.balance()).held,false);
    await run.settle(id, 84000);
    await run.rewind(181);
    assert.equal(await run.settle(id, 84000),true);
    assert.deepEqual(await run.cost(), { media:84000, tax:15120, rate:1800, held:false, finalized:true });
    assert.equal(await run.state(),'closed');
    assert.equal((await run.balance()).reservedPaise,0);
  });
  await check(`${database}: system settle needs a paused, current reservation on a paused campaign, and is service-only (#221)`, async () => {
    const run = await fixture(280, 1000000, { operator: false });
    await run.observe(0);
    const { reservationId: id } = await run.reserve();
    await assert.rejects(run.settle(id, 0), {code:'23514'}, "uncertain");
    await run.activate(id);
    await assert.rejects(run.settle(id, 0), {code:'23514'}, "active");
    await db.query("update public.campaigns set status='paused' where id=$1",[run.campaign]);
    await assert.rejects(run.settle(id, 0), {code:'23514'}, "reservation still active");
    await run.result(id,'paused');
    await assert.rejects(run.settle(randomUUID(), 0), {code:'23514'}, "stale reservation id");
    await assert.rejects(run.settle(id, -1), {code:'23514'});
    assert.ok((await db.query("select public.customer_ad_settling_businesses() as id")).rows.some(row => row.id===run.business));
    const { reservationId: again } = await run.reserve();
    await assert.rejects(run.settle(again, 0), {code:'23514'}, "in flight");
    for (const role of ['anon','authenticated']) {
      const session = client(database);
      await session.connect();
      try {
        await session.query(`set role ${role}`);
        await assert.rejects(session.query("select public.customer_ad_settle_costs($1,$2,'acc_capped',$3,'act_123',1,$4,0)",[run.business,run.owner,run.campaign,again]),{code:'42501'});
        await assert.rejects(session.query("select public.customer_ad_settling_businesses()"),{code:'42501'});
      } finally { await session.end(); }
    }
  });
}

async function verifyManagedWhatsAppPageLink(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID(), otherBusiness = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Page WhatsApp'),($3,$4,'Other Page WhatsApp')", [business, owner, otherBusiness, other]);
  const service = async (run) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query("set local role service_role");
      return await run(session);
    } finally { await session.query("rollback").catch(() => {}); await session.end(); }
  };
  await check(`${database}: 2T WhatsApp v1: a Page-linked number completes whatsapp_linked; one active customer per number (#524)`, async () => {
    await service(async (session) => {
      await session.query("insert into public.managed_meta_accounts(business_id,page_id) values ($1,'7101'),($2,'7102')", [business, otherBusiness]);
      for (const step of ["state='page_linked'", "state='child_created', child_business_id='7201'", "state='ad_account_created', ad_account_id='act_7301'", "state='funded', funding_state='card_attached'"]) {
        await session.query(`update public.managed_meta_accounts set ${step} where business_id=$1`, [business]);
      }
      await session.query("savepoint s");
      // Still refused with neither the Embedded Signup IDs nor a Page-linked number.
      await assert.rejects(session.query("update public.managed_meta_accounts set state='whatsapp_linked' where business_id=$1", [business]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("update public.managed_meta_accounts set whatsapp_number_e164='98765' where business_id=$1", [business]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await session.query("update public.managed_meta_accounts set whatsapp_number_e164='+919999990874', state='whatsapp_linked' where business_id=$1", [business]);
      // Another customer can't record the same number.
      await assert.rejects(session.query("update public.managed_meta_accounts set whatsapp_number_e164='+919999990874' where business_id=$1", [otherBusiness]), { code: "23505" });
      await session.query("rollback to savepoint s");
      // The other #519 checks that name whatsapp_linked are still there (a state needs its Page).
      const checks = (await session.query("select count(*)::int as n from pg_constraint where conrelid='public.managed_meta_accounts'::regclass and contype='c' and pg_get_constraintdef(oid) like '%page_id IS NOT NULL%'")).rows[0].n;
      assert.equal(checks, 1);
    });
  });
}

async function verifyTokenSearchPath(db, database) {
  await check(`${database}: the token RPCs run with an empty search_path and still store, read and delete (#625)`, async () => {
    const config = (await db.query(`select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('meta_token_insert','meta_token_get','meta_token_delete') order by p.proname`)).rows;
    assert.deepEqual(config, ["meta_token_delete", "meta_token_get", "meta_token_insert"].map((proname) => ({ proname, proconfig: ['search_path=""'] })));
    const owner = randomUUID(), business = randomUUID(), token = randomUUID();
    await db.query("begin");
    try {
      await db.query("insert into auth.users(id) values ($1)", [owner]);
      await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Search path')", [business, owner]);
      await db.query("set local search_path = ''");
      await db.query(`select public.meta_token_insert($1,$2,$3,'s1','business_system_user',$4,$5,$6,'k1','v1',array['ads_management'],'[]'::jsonb,null,now(),null)`,
        [token, business, owner, "\\x01", `\\x${"00".repeat(12)}`, `\\x${"00".repeat(16)}`]);
      const [row] = (await db.query("select * from public.meta_token_get($1,$2)", [token, business])).rows;
      assert.equal(row.id, token);
      assert.deepEqual([...row.ciphertext], [1]);
      assert.equal((await db.query("select public.meta_token_delete($1,$2) as deleted", [token, business])).rows[0].deleted, true);
      assert.equal((await db.query("select count(*)::int n from private.meta_tokens where id = $1", [token])).rows[0].n, 0);
    } finally { await db.query("rollback"); }
  });
}

/** #1648: seeds a token revoked before the migration (backfill), then applies it twice. */
async function verifyMetaTokenPurge(db, database) {
  const owner = randomUUID(), business = randomUUID(), revoked = randomUUID(), live = randomUUID();
  await db.query("insert into auth.users(id) values ($1)", [owner]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Token purge')", [business, owner]);
  for (const token of [revoked, live]) {
    await db.query(`select public.meta_token_insert($1,$2,$3,'s-purge','user',$4,$5,$6,'k1','v1',array['ads_management'],'[]'::jsonb,null,now(),null)`,
      [token, business, owner, "\\x01", `\\x${"00".repeat(12)}`, `\\x${"00".repeat(16)}`]);
  }
  await db.query("update private.meta_tokens set revoked_at = now() where id = $1", [revoked]);
  await db.query(tokenPurgeMigration);
  await db.query(tokenPurgeMigration);
  await check(`${database}: a revoked Meta token keeps no secret, a live one keeps all of it (#1648)`, async () => {
    const secrets = async (id) => (await db.query("select ciphertext, nonce, auth_tag, revoked_at from private.meta_tokens where id = $1", [id])).rows[0];
    const old = await secrets(revoked);
    assert.ok(old.revoked_at);
    assert.deepEqual([old.ciphertext, old.nonce, old.auth_tag], [null, null, null]);
    assert.deepEqual([...(await secrets(live)).ciphertext], [1]);
    const [read] = (await db.query("select * from public.meta_token_get($1,$2)", [revoked, business])).rows;
    assert.ok(read.revoked_at);
    assert.equal(read.ciphertext, null);
    assert.equal((await db.query("select public.meta_disconnect($1,$2) as ok", [business, owner])).rows[0].ok, true);
    assert.deepEqual(Object.values(await secrets(live)).slice(0, 3), [null, null, null]);
    await db.query("update private.meta_tokens set ciphertext = $2, nonce = $3, auth_tag = $4 where id = $1", [live, Buffer.from([1]), Buffer.alloc(12), Buffer.alloc(16)]);
    assert.equal((await secrets(live)).ciphertext, null);
    await assert.rejects(db.query("update private.meta_tokens set revoked_at = null where id = $1", [live]), { code: "23514" });
  });
}

/** #1649: which live token disconnect may revoke at Meta, and whether that Meta user is shared with another business. */
async function verifyMetaRevocationTarget(db, database) {
  await check(`${database}: revocation target: unshared, shared, system user, already revoked (#1649)`, async () => {
    const owner = randomUUID();
    const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const target = async (business) => (await db.query("select * from public.meta_token_revocation_target($1)", [business])).rows;
    await db.query("begin");
    try {
      await db.query("insert into auth.users(id) values ($1)", [owner]);
      const connect = async (business, subject, kind) => {
        const token = randomUUID();
        await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Revoke target')", [business, owner]);
        await db.query(`select public.meta_token_insert($1,$2,$3,$4,$5,$6,$7,$8,'k1','v1',array['ads_management'],'[]'::jsonb,null,now(),null)`,
          [token, business, owner, subject, kind, "\\x01", `\\x${"00".repeat(12)}`, `\\x${"00".repeat(16)}`]);
        await db.query("insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id,page_id,token_id) values ($1,1,'connected','act_123','123',$2)", [business, token]);
        return token;
      };
      const tokenA = await connect(a, "4242", "user");
      assert.deepEqual(await target(a), [{ token_id: tokenA, subject_id: "4242", token_kind: "user", shared: false }]);
      await connect(b, "4242", "user");
      assert.equal((await target(a))[0].shared, true);
      await connect(c, "9001", "business_system_user");
      assert.deepEqual((await target(c)).map((r) => [r.token_kind, r.shared]), [["business_system_user", false]]);
      await connect(d, "7777", "user");
      await db.query("update private.meta_tokens set revoked_at = now() where business_id = $1", [d]);
      assert.equal((await target(d)).length, 0);
      await db.query("update private.meta_tokens set revoked_at = now() where business_id = $1", [b]);
      assert.equal((await target(a))[0].shared, false);
      await db.query("set local role authenticated");
      await assert.rejects(db.query("select * from public.meta_token_revocation_target($1)", [a]), { code: "42501" });
    } finally { await db.query("rollback"); }
  });
}

async function verifyConnectionReauth(db, database) {
  await check(`${database}: a Graph 190 marks only the failing connection generation reauth_required, service role only (#757)`, async () => {
    const owner = randomUUID(), business = randomUUID();
    await db.query("begin");
    try {
      await db.query("insert into auth.users(id) values ($1)", [owner]);
      await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Reauth')", [business, owner]);
      await db.query("insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id,page_id) values ($1,5,'connected','act_1','page_1')", [business]);
      const mark = async (generation) => (await db.query("select public.meta_connection_mark_reauth($1,$2) as changed", [business, generation])).rows[0].changed;
      assert.equal(await mark(4), false, "a stale generation must not touch a reconnected row");
      assert.equal((await db.query("select authorization_status from public.meta_connections where business_id = $1", [business])).rows[0].authorization_status, "connected");
      assert.equal(await mark(5), true);
      assert.equal(await mark(5), false, "already marked");
      const row = (await db.query("select authorization_status, generation from public.meta_connections where business_id = $1", [business])).rows[0];
      assert.deepEqual(row, { authorization_status: "reauth_required", generation: "5" });
      const fn = (await db.query(`select p.proconfig, has_function_privilege('authenticated', p.oid, 'execute') as customer
        from pg_proc p where p.proname = 'meta_connection_mark_reauth'`)).rows[0];
      assert.deepEqual(fn, { proconfig: ['search_path=""'], customer: false });
    } finally { await db.query("rollback"); }
  });
}

async function verifyMetaDeletionRequests(db, database) {
  await check(`${database}: Meta's deletion callback records one open request per owner and code, or one unbound, and owners can't forge one (#730)`, async () => {
    const owner = randomUUID(), other = randomUUID(), business = randomUUID(), otherBusiness = randomUUID();
    const record = async (subject, code) => (await db.query("select public.meta_deletion_request_record($1,$2) as n", [subject, code])).rows[0].n;
    const refused = async (sql, params) => {
      await db.query("savepoint refused");
      await assert.rejects(db.query(sql, params));
      await db.query("rollback to savepoint refused");
    };
    await db.query("begin");
    try {
      await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
      await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Deletion'),($3,$4,'Deletion 2')", [business, owner, otherBusiness, other]);
      for (const [b, by] of [[business, owner], [otherBusiness, other], [otherBusiness, other]]) {
        await db.query(`insert into private.meta_tokens(business_id,authorized_by,subject_id,token_kind,ciphertext,nonce,auth_tag,key_id)
          values ($1,$2,'fb-person','user','\\x01',$3,$4,'k1')`, [b, by, `\\x${"00".repeat(12)}`, `\\x${"00".repeat(16)}`]);
      }
      // The owner's own open deletion request doesn't block the callback's.
      await db.query("insert into public.privacy_requests(owner_id,kind) values ($1,'delete')", [owner]);
      assert.equal(await record("fb-person", "0123456789abcdef"), 2);
      assert.equal(await record("fb-person", "0123456789abcdef"), 2, "a Meta retry must not duplicate");
      const rows = (await db.query("select owner_id, source, status from public.privacy_requests where confirmation_code = '0123456789abcdef' order by owner_id")).rows;
      assert.deepEqual(rows.map(row => row.owner_id).sort(), [owner, other].sort());
      assert.ok(rows.every(row => row.source === "meta_callback" && row.status === "received"));
      assert.equal(await record("fb-unknown", "fedcba9876543210"), 1);
      assert.equal(await record("fb-unknown", "fedcba9876543210"), 1);
      assert.equal((await db.query("select count(*)::int n from public.privacy_requests where confirmation_code = 'fedcba9876543210' and owner_id is null")).rows[0].n, 1);
      await refused("select public.meta_deletion_request_record('fb-person','not-a-code')");
      await refused("insert into public.privacy_requests(owner_id,kind) values (null,'delete')");
      // After review completes, a later callback is a new request.
      await db.query("update public.privacy_requests set status = 'completed' where confirmation_code = 'fedcba9876543210'");
      assert.equal(await record("fb-unknown", "fedcba9876543210"), 1);
      const fn = (await db.query(`select p.proconfig, has_function_privilege('authenticated', p.oid, 'execute') as customer
        from pg_proc p where p.proname = 'meta_deletion_request_record'`)).rows[0];
      assert.deepEqual(fn, { proconfig: ['search_path=""'], customer: false });
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [owner]);
      await refused("insert into public.privacy_requests(owner_id,kind,source,confirmation_code,meta_subject_id) values ($1,'delete','meta_callback','aaaaaaaaaaaaaaaa','x')", [owner]);
    } finally { await db.query("rollback"); }
  });
}

async function verifyLegacyCredentialsAndBuckets(db, database) {
  await check(`${database}: browsers can't reach legacy meta_credentials, and buckets take only images within a size limit (#731)`, async () => {
    const legacy = (await db.query(`select case when to_regclass('public.meta_credentials') is null then false else
        has_table_privilege('authenticated', 'public.meta_credentials', 'SELECT') or has_table_privilege('authenticated', 'public.meta_credentials', 'UPDATE')
        or has_table_privilege('anon', 'public.meta_credentials', 'SELECT') end as browser`)).rows[0];
    assert.equal(legacy.browser, false);
    const buckets = (await db.query("select id, file_size_limit::int as size, allowed_mime_types as types from storage.buckets where id in ('brand-assets','creatives') order by id")).rows;
    const images = ["image/png", "image/jpeg", "image/webp"];
    assert.deepEqual(buckets, [{ id: "brand-assets", size: 10485760, types: images }, { id: "creatives", size: 20971520, types: images }]);
  });
}

async function verifyLeadCampaignLink(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID(), otherBusiness = randomUUID(), campaign = randomUUID(), otherCampaign = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Leads link'),($3,$4,'Other leads link')", [business, owner, otherBusiness, other]);
  await db.query("insert into public.campaigns(id,business_id,daily_budget,meta_campaign_id) values ($1,$2,300,'1201'),($3,$4,300,'1202')", [campaign, business, otherCampaign, otherBusiness]);
  await db.query("insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id,page_id) values ($1,1,'connected','act_fixture','page_fixture')", [business]);
  await check(`${database}: lead sync links a lead to its business's campaign by Meta id, backfills an empty link and counts only new leads (#680)`, async () => {
    const run = (await db.query("select * from public.lead_sync_start($1,$2,null,1,'act_fixture','page_fixture')", [business, owner])).rows[0];
    const checkpoint = async (version, rows) => (await db.query(
      "select public.lead_sync_checkpoint($1,$2,$3,1,'act_fixture','page_fixture',$4,$5::jsonb,$6::jsonb) as result",
      [business, owner, run.id, version, JSON.stringify(rows), JSON.stringify({ formsDone: false, pending: [] })],
    )).rows[0].result;
    const first = await checkpoint(run.version, [
      { meta_lead_id: "ad-lead", meta_campaign_id: "1201", form_id: "f1", full_name: "A" },
      { meta_lead_id: "test-lead", meta_campaign_id: null, form_id: "f1" },
      { meta_lead_id: "foreign", meta_campaign_id: "1202", form_id: "f1" },
      { meta_lead_id: "late-link", form_id: "f1" },
    ]);
    assert.equal(first.imported, 4);
    const second = await checkpoint(first.run.version, [
      { meta_lead_id: "late-link", meta_campaign_id: "1201", form_id: "f1" },
      { meta_lead_id: "ad-lead", meta_campaign_id: "9999", form_id: "f1" },
      { meta_lead_id: "new-lead", meta_campaign_id: "1201", form_id: "f1" },
    ]);
    assert.equal(second.imported, 1);
    // The same lead twice in one batch must not fail the checkpoint (the old insert did nothing on it).
    const third = await checkpoint(second.run.version, [
      { meta_lead_id: "twice", meta_campaign_id: null, form_id: "f1" },
      { meta_lead_id: "twice", meta_campaign_id: "1201", form_id: "f1" },
      { meta_lead_id: "new-lead", meta_campaign_id: "1201", form_id: "f1" },
      { meta_lead_id: "new-lead", meta_campaign_id: "1201", form_id: "f1" },
    ]);
    assert.equal(third.imported, 1);
    const links = Object.fromEntries((await db.query("select meta_lead_id, campaign_id from public.leads where business_id=$1", [business])).rows.map(row => [row.meta_lead_id, row.campaign_id]));
    assert.deepEqual(links, { "ad-lead": campaign, "test-lead": null, foreign: null, "late-link": campaign, "new-lead": campaign, twice: campaign });
  });
}

async function verifyLeadErase(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID(), campaign = randomUUID(), otherCampaign = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Erase')", [business, owner]);
  await db.query("insert into public.campaigns(id,business_id,daily_budget,meta_campaign_id) values ($1,$2,300,'2201'),($3,$2,300,'2202')", [campaign, business, otherCampaign]);
  await db.query("insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id,page_id) values ($1,1,'connected','act_erase','page_erase')", [business]);
  const lead = async (meta, campaignId, source = "meta_form") => (await db.query(
    "insert into public.leads(business_id,campaign_id,meta_lead_id,source,full_name,phone) values ($1,$2,$3,$4,'Rohit','+919800000001') returning id",
    [business, campaignId, meta, source])).rows[0].id;
  const one = await lead("erase-1", campaign), two = await lead("erase-2", campaign), three = await lead("erase-3", otherCampaign);
  await lead(null, campaign, "whatsapp_manual");
  const as = async (user, run) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin"); await session.query("set local role authenticated");
      await session.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      const result = await run(session); await session.query("commit"); return result;
    } catch (error) { await session.query("rollback").catch(() => {}); throw error; } finally { await session.end(); }
  };
  const left = async () => (await db.query("select count(*)::int as n from public.leads where business_id=$1", [business])).rows[0].n;
  await check(`${database}: an owner erases one enquiry or a campaign's, leaving a hashed tombstone and no personal data (#1761)`, async () => {
    assert.equal(await as(other, s => s.query("select public.leads_erase($1,$2) as n", [business, one]).then(r => r.rows[0].n)), 0, "another owner erases nothing");
    assert.equal(await as(owner, s => s.query("select public.leads_erase($1,$2) as n", [business, one]).then(r => r.rows[0].n)), 1);
    assert.equal(await left(), 3);
    assert.equal(await as(owner, s => s.query("select public.leads_erase($1,null,$2) as n", [business, campaign]).then(r => r.rows[0].n)), 2, "the campaign's form lead and its logged WhatsApp enquiry");
    assert.equal(await left(), 1);
    const tombstones = (await db.query("select meta_lead_hash from public.lead_tombstones where business_id=$1 order by 1", [business])).rows.map(r => r.meta_lead_hash);
    assert.equal(tombstones.length, 2);
    assert.ok(tombstones.every(hash => /^[0-9a-f]{64}$/.test(hash)) && !tombstones.join().includes("erase"), "only hashes are kept");
    await as(owner, async s => {
      await s.query("savepoint a");
      await assert.rejects(s.query("select public.leads_erase($1,$2,$3)", [business, three, otherCampaign]), { code: "22023" });
      await s.query("rollback to savepoint a");
      await assert.rejects(s.query("delete from public.lead_tombstones"), { code: "42501" });
    });
    void two;
  });
  await check(`${database}: lead sync never re-imports an erased enquiry (#1761)`, async () => {
    const run = (await db.query("select * from public.lead_sync_start($1,$2,null,1,'act_erase','page_erase')", [business, owner])).rows[0];
    const saved = (await db.query(
      "select public.lead_sync_checkpoint($1,$2,$3,1,'act_erase','page_erase',$4,$5::jsonb,$6::jsonb) as result",
      [business, owner, run.id, run.version, JSON.stringify([
        { meta_lead_id: "erase-1", meta_campaign_id: "2201", form_id: "f1" },
        { meta_lead_id: "erase-2", meta_campaign_id: "2201", form_id: "f1" },
        { meta_lead_id: "erase-new", meta_campaign_id: "2201", form_id: "f1" },
      ]), JSON.stringify({ formsDone: false, pending: [] })],
    )).rows[0].result;
    assert.equal(saved.imported, 1);
    const ids = (await db.query("select meta_lead_id from public.leads where business_id=$1 and meta_lead_id is not null order by 1", [business])).rows.map(r => r.meta_lead_id);
    assert.deepEqual(ids, ["erase-3", "erase-new"]);
  });
}

async function verifySharedPageLeads(db, database) {
  const [ownerA, ownerB, ownerC, a, b, c, campA, campB] = Array.from({ length: 8 }, () => randomUUID());
  await db.query("insert into auth.users(id) values ($1),($2),($3)", [ownerA, ownerB, ownerC]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Shared A'),($3,$4,'Shared B'),($5,$6,'Solo C')", [a, ownerA, b, ownerB, c, ownerC]);
  await db.query("insert into public.campaigns(id,business_id,daily_budget,meta_campaign_id) values ($1,$2,300,'1301'),($3,$4,300,'1302')", [campA, a, campB, b]);
  await db.query(`insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id,page_id)
    values ($1,1,'connected','act_shared_a','page_shared'),($2,1,'connected','act_shared_b','page_shared'),($3,1,'connected','act_solo','page_solo')`, [a, b, c]);
  const sync = async (business, owner, account, page, rows) => {
    const run = (await db.query("select * from public.lead_sync_start($1,$2,null,1,$3,$4)", [business, owner, account, page])).rows[0];
    return (await db.query("select public.lead_sync_checkpoint($1,$2,$3,1,$4,$5,$6,$7::jsonb,$8::jsonb) as result",
      [business, owner, run.id, account, page, run.version, JSON.stringify(rows), JSON.stringify({ formsDone: true, pending: [] })])).rows[0].result;
  };
  const leadsOf = async (business) => (await db.query("select meta_lead_id from public.leads where business_id=$1 order by 1", [business])).rows.map(row => row.meta_lead_id);
  await check(`${database}: on a Page two businesses share, a lead goes only to the business whose campaign it came from (#1775)`, async () => {
    const rows = [
      { meta_lead_id: "from-b", meta_campaign_id: "1302", form_id: "f" },
      { meta_lead_id: "from-a", meta_campaign_id: "1301", form_id: "f" },
      { meta_lead_id: "outside", meta_campaign_id: "9999", form_id: "f" },
      { meta_lead_id: "no-campaign", meta_campaign_id: null, form_id: "f" },
    ];
    assert.equal((await sync(b, ownerB, "act_shared_b", "page_shared", rows)).imported, 1);
    assert.deepEqual(await leadsOf(b), ["from-b"]);
    assert.equal((await sync(a, ownerA, "act_shared_a", "page_shared", rows)).imported, 1);
    assert.deepEqual(await leadsOf(a), ["from-a"]);
  });
  await check(`${database}: a business that alone has its Page still imports all of its Page's leads (#680, #1775)`, async () => {
    const rows = [{ meta_lead_id: "boost", meta_campaign_id: "8888", form_id: "f" }, { meta_lead_id: "test", meta_campaign_id: null, form_id: "f" }];
    assert.equal((await sync(c, ownerC, "act_solo", "page_solo", rows)).imported, 2);
    assert.deepEqual(await leadsOf(c), ["boost", "test"]);
  });
}

async function verifyWhatsAppTemplate(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Template')", [business, owner]);
  const as = async (role, user, run) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query(`set local role ${role}`);
      if (user) await session.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      return await run(session);
    } finally { await session.query("rollback").catch(() => {}); await session.end(); }
  };
  await check(`${database}: WhatsApp template: owner saves an object, other owners can't, bounded shape (#840)`, async () => {
    const template = JSON.stringify({ greeting: "Hi! Thanks for messaging Solaride.", opening: { kind: "prefill", prefill: "Can I get more info on this", callButton: true }, language: "en" });
    await as("authenticated", owner, async (session) => {
      assert.equal((await session.query("update public.businesses set whatsapp_template=$2::jsonb where id=$1", [business, template])).rowCount, 1);
      await session.query("savepoint s");
      await assert.rejects(session.query("update public.businesses set whatsapp_template='[]'::jsonb where id=$1", [business]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("update public.businesses set whatsapp_template=jsonb_build_object('greeting', repeat('x', 5000)) where id=$1", [business]), { code: "23514" });
    });
    await as("authenticated", other, async (session) => {
      assert.equal((await session.query("update public.businesses set whatsapp_template='{}'::jsonb where id=$1", [business])).rowCount, 0);
    });
  });
}

async function verifyCampaignLearnings(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID(), otherBusiness = randomUUID(), campaign = randomUUID(), otherCampaign = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Learns'),($3,$4,'Other learns')", [business, owner, otherBusiness, other]);
  await db.query("insert into public.campaigns(id,business_id,daily_budget) values ($1,$2,300),($3,$4,300)", [campaign, business, otherCampaign, otherBusiness]);
  const as = async (role, user, run) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query(`set local role ${role}`);
      if (user) await session.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      return await run(session);
    } finally { await session.query("rollback").catch(() => {}); await session.end(); }
  };
  await check(`${database}: learning ledger: owners read only their own; only the service role writes; bounded text (#588)`, async () => {
    await as("service_role", null, async (session) => {
      await session.query(`insert into public.campaign_learnings(campaign_id,business_id,snapshot,hypothesis) values ($1,$2,'{"destination":"whatsapp"}','English prefill beats Hinglish'),($3,$4,'{}',null)`, [campaign, business, otherCampaign, otherBusiness]);
      await session.query("update public.campaign_learnings set verdict='Pending' where campaign_id=$1", [campaign]);
      await session.query("savepoint s");
      await assert.rejects(session.query("update public.campaign_learnings set snapshot='[]' where campaign_id=$1", [campaign]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("update public.campaign_learnings set verdict=repeat('x', 501) where campaign_id=$1", [campaign]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await session.query("commit");
    });
    await as("authenticated", owner, async (session) => {
      assert.deepEqual((await session.query("select campaign_id, verdict from public.campaign_learnings")).rows, [{ campaign_id: campaign, verdict: "Pending" }]);
      await session.query("savepoint s");
      await assert.rejects(session.query("update public.campaign_learnings set verdict='Mine' where campaign_id=$1", [campaign]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("insert into public.campaign_learnings(campaign_id,business_id) values ($1,$2)", [otherCampaign, business]), { code: "42501" });
    });
    await as("anon", null, async (session) => {
      await assert.rejects(session.query("select 1 from public.campaign_learnings"), { code: "42501" });
    });
  });
}

async function verifyLeadCustomerStatus(db, database) {
  const owner = randomUUID(), business = randomUUID(), lead = randomUUID();
  await db.query("insert into auth.users(id) values ($1)", [owner]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Customers')", [business, owner]);
  await db.query("insert into public.leads(id,business_id,meta_lead_id,full_name) values ($1,$2,'manual-798','Asha')", [lead, business]);
  await check(`${database}: an enquiry can become a customer, the Enquiries filter finds it, nothing else is accepted (#798)`, async () => {
    const checks = await db.query("select count(*)::int as n from pg_constraint where conrelid='public.leads'::regclass and contype='c' and pg_get_constraintdef(oid) like '%workflow_status%'");
    assert.equal(checks.rows[0].n, 1);
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query("set local role authenticated");
      await session.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      await session.query("update public.leads set workflow_status='customer' where id=$1", [lead]);
      const page = await session.query("select public.get_lead_page($1,'','customer') as page", [business]);
      assert.equal(page.rows[0].page.total, 1);
      assert.equal(page.rows[0].page.leads[0].workflow_status, "customer");
      await session.query("savepoint s");
      await assert.rejects(session.query("update public.leads set workflow_status='sold' where id=$1", [lead]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("select public.get_lead_page($1,'','sold')", [business]), { code: "22023" });
    } finally { await session.query("rollback").catch(() => {}); await session.end(); }
  });
}

async function verifyLeadFirstContacted(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID(), lead = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Replies')", [business, owner]);
  await db.query("insert into public.leads(id,business_id,meta_lead_id,full_name) values ($1,$2,'reply-1049','Ravi')", [lead, business]);
  await check(`${database}: an owner records the first reply time on their own enquiry; the enquiry page returns it; nobody else can (#1049)`, async () => {
    const as = async (user, run) => {
      const session = client(database);
      await session.connect();
      try {
        await session.query("begin");
        await session.query("set local role authenticated");
        await session.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
        return await run(session);
      } finally { await session.query("rollback").catch(() => {}); await session.end(); }
    };
    await as(owner, async (session) => {
      const updated = await session.query("update public.leads set first_contacted_at=now() where id=$1 and first_contacted_at is null returning first_contacted_at", [lead]);
      assert.equal(updated.rowCount, 1);
      const page = await session.query("select public.get_lead_page($1) as page", [business]);
      assert.ok(page.rows[0].page.leads[0].first_contacted_at);
    });
    await as(other, async (session) => {
      assert.equal((await session.query("update public.leads set first_contacted_at=now() where id=$1", [lead])).rowCount, 0);
    });
    assert.equal((await db.query("select count(*)::int as n from pg_indexes where indexname='leads_business_first_contacted_idx'")).rows[0].n, 1);
  });
}

async function verifyCampaignAdsAndResults(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID(), otherBusiness = randomUUID(), campaign = randomUUID(), otherCampaign = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Per ad'),($3,$4,'Other per ad')", [business, owner, otherBusiness, other]);
  await db.query("insert into public.campaigns(id,business_id,daily_budget) values ($1,$2,300),($3,$4,300)", [campaign, business, otherCampaign, otherBusiness]);
  const as = async (role, user, run) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query(`set local role ${role}`);
      if (user) await session.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      return await run(session);
    } finally { await session.query("rollback").catch(() => {}); await session.end(); }
  };
  await check(`${database}: per-ad results: owners read only their own, only the service role writes, rows stay on their campaign's business (#783)`, async () => {
    await as("service_role", null, async (session) => {
      await session.query("insert into public.campaign_ads(business_id,campaign_id,meta_ad_id,meta_creative_id,variant_index,position) values ($1,$2,'120253710068180526','2421940755245471',0,0),($3,$4,'120253710070870526',null,0,0)", [business, campaign, otherBusiness, otherCampaign]);
      await session.query("insert into public.ad_results(business_id,campaign_id,meta_ad_id,ad_name,effective_status,period_start,period_end,delivered,impressions,link_clicks,conversations,spend_paise) values ($1,$2,'120253710068180526','Lower bills','ACTIVE','2026-10-26','2026-10-26',true,1100,9,1,7030),($1,$2,'120253710006390526',null,null,null,null,false,0,0,0,0),($3,$4,'120253710070870526',null,null,null,null,true,10,1,0,1510)", [business, campaign, otherBusiness, otherCampaign]);
      // The refresh upserts the lifetime row; an undelivered ad (no dates) is still one row (nulls not distinct).
      // The exact row saveAdResults upserts (src/lib/campaign/ad-results-store.ts), so a column drift fails here.
      await session.query(`insert into public.ad_results(business_id,campaign_id,meta_ad_id,ad_name,effective_status,period_start,period_end,delivered,impressions,link_clicks,conversations,leads,spend_paise,synced_at)
        values ($1,$2,'120253710006390526','Gone ad','DELETED',null,null,false,0,0,0,0,0,now())
        on conflict (campaign_id,meta_ad_id,period_start,period_end) do update set ad_name=excluded.ad_name, effective_status=excluded.effective_status,
          delivered=excluded.delivered, impressions=excluded.impressions, link_clicks=excluded.link_clicks, conversations=excluded.conversations,
          leads=excluded.leads, spend_paise=excluded.spend_paise, synced_at=excluded.synced_at`, [business, campaign]);
      assert.equal((await session.query("select effective_status from public.ad_results where campaign_id=$1 and meta_ad_id='120253710006390526'", [campaign])).rows[0].effective_status, "DELETED");
      for (const [sql, params, code] of [
        ["insert into public.campaign_ads(business_id,campaign_id,meta_ad_id) values ($1,$2,'1')", [business, otherCampaign], "23503"],
        ["insert into public.ad_results(business_id,campaign_id,meta_ad_id) values ($1,$2,'1')", [business, otherCampaign], "23503"],
        ["insert into public.campaign_ads(business_id,campaign_id,meta_ad_id) values ($1,$2,'not-an-id')", [business, campaign], "23514"],
        ["insert into public.ad_results(business_id,campaign_id,meta_ad_id,spend_paise) values ($1,$2,'2',-1)", [business, campaign], "23514"],
        ["insert into public.ad_results(business_id,campaign_id,meta_ad_id,period_start,period_end) values ($1,$2,'3','2026-10-27','2026-10-26')", [business, campaign], "23514"],
        ["insert into public.ad_results(business_id,campaign_id,meta_ad_id,effective_status) values ($1,$2,'4','archived; drop')", [business, campaign], "23514"],
        ["insert into public.campaign_ads(business_id,campaign_id,meta_ad_id) values ($1,$2,'120253710068180526')", [business, campaign], "23505"],
      ]) {
        await session.query("savepoint s");
        await assert.rejects(session.query(sql, params), { code });
        await session.query("rollback to savepoint s");
      }
      assert.equal((await session.query("select count(*)::int as n from public.ad_results where campaign_id=$1", [campaign])).rows[0].n, 2);
      await session.query("commit");
    });
    await as("authenticated", owner, async (session) => {
      assert.deepEqual((await session.query("select meta_ad_id from public.campaign_ads order by meta_ad_id")).rows, [{ meta_ad_id: "120253710068180526" }]);
      assert.deepEqual((await session.query("select meta_ad_id, spend_paise::int from public.ad_results order by meta_ad_id")).rows,
        [{ meta_ad_id: "120253710006390526", spend_paise: 0 }, { meta_ad_id: "120253710068180526", spend_paise: 7030 }]);
      await session.query("savepoint s");
      await assert.rejects(session.query("insert into public.ad_results(business_id,campaign_id,meta_ad_id) values ($1,$2,'9')", [business, campaign]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("update public.campaign_ads set position=1"), { code: "42501" });
    });
    await as("anon", null, async (session) => {
      await assert.rejects(session.query("select 1 from public.ad_results"), { code: "42501" });
    });
    await db.query("delete from public.campaigns where id=$1", [campaign]);
    assert.equal((await db.query("select (select count(*) from public.campaign_ads where campaign_id=$1)::int + (select count(*) from public.ad_results where campaign_id=$1)::int as n", [campaign])).rows[0].n, 0);
  });
}

async function verifyEditAdCreativeKind(db, database) {
  const owner = randomUUID(), business = randomUUID(), campaign = randomUUID();
  const hash = "c".repeat(64);
  await db.query("insert into auth.users(id) values ($1)", [owner]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Ad edit')", [business, owner]);
  await db.query("insert into public.campaigns(id,business_id,daily_budget) values ($1,$2,300)", [campaign, business]);
  await check(`${database}: edit envelope takes an ad creative edit, and still refuses unknown kinds (#775)`, async () => {
    await db.query("insert into public.campaign_edit_operations(business_id,campaign_id,kind,idempotency_key,request_hash,before,change) values ($1,$2,'ad_creative','ad-edit-key-1',$3,$4,$5)",
      [business, campaign, hash, JSON.stringify({ ad_id: "120253710068180526", previous_creative_id: "2421940755245471" }), JSON.stringify({ message: "New words" })]);
    await assert.rejects(db.query("insert into public.campaign_edit_operations(business_id,campaign_id,kind,idempotency_key,request_hash) values ($1,$2,'other','ad-edit-key-2',$3)", [business, campaign, hash]), { code: "23514" });
    assert.equal((await db.query("select count(*)::int as n from public.campaign_edit_operations where campaign_id=$1 and kind='ad_creative'", [campaign])).rows[0].n, 1);
  });
}

async function verifyPlanPeriods(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Plan')", [business, owner]);
  await db.query("insert into public.campaigns(id,business_id,daily_budget,launched_at) values ($1,$2,300,'2026-10-10T09:00:00Z')", [randomUUID(), business]);
  const service = async (sql, params) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin"); await session.query("set local role service_role");
      const result = (await session.query(sql, params)).rows[0]; await session.query("commit"); return result;
    } catch (error) { await session.query("rollback").catch(() => {}); throw error; } finally { await session.end(); }
  };
  const open = async () => (await service("select public.plan_period_open($1) as r", [business])).r;
  const link = (period, id) => service("select public.plan_period_set_link($1,$2,'https://rzp.io/i/x') as r", [period, id]);
  const paid = async (id, payment, at) => (await service("select public.plan_period_paid($1,$2,$3) as r", [id, payment, at])).r;
  const months = async () => (await db.query("select to_char(starts_at at time zone 'UTC','YYYY-MM-DD') as s, to_char(ends_at at time zone 'UTC','YYYY-MM-DD') as e from public.plan_periods where business_id=$1 and state='paid' order by starts_at", [business])).rows;
  await check(`${database}: plan periods: one open month, paid once, early pay stacks after the free month, late pay starts at payment, paid-after-expiry credited (#718)`, async () => {
    const first = await open();
    assert.equal((await open()).periodId, first.periodId);
    assert.equal((await link(first.periodId, "plink_A")).r, true);
    assert.equal((await link(first.periodId, "plink_B")).r, false);
    assert.equal(await paid("plink_Unknown", "pay_X", "2026-11-05T00:00:00Z"), "ignored");
    assert.equal(await paid("plink_A", "pay_A", "2026-11-05T00:00:00Z"), "paid");
    assert.equal(await paid("plink_A", "pay_A", "2026-11-05T00:00:00Z"), "duplicate");
    assert.equal(await paid("plink_A", "pay_Other", "2026-11-06T00:00:00Z"), "ignored");
    assert.deepEqual(await months(), [{ s: "2026-11-10", e: "2026-12-10" }]);
    const second = await open();
    assert.notEqual(second.periodId, first.periodId);
    await link(second.periodId, "plink_C");
    assert.equal(await paid("plink_C", "pay_C", "2027-01-31T10:00:00Z"), "paid");
    assert.deepEqual(await months(), [{ s: "2026-11-10", e: "2026-12-10" }, { s: "2027-01-31", e: "2027-02-28" }]);
    const third = await open();
    await link(third.periodId, "plink_D");
    assert.equal((await service("select public.plan_period_expire('plink_D') as r")).r, true);
    // A payment that lands after its link expired still buys its month (Reviewer, #1430): starts after Feb 28.
    assert.equal(await paid("plink_D", "pay_D", "2027-02-01T00:00:00Z"), "paid");
    assert.equal(await paid("plink_D", "pay_D", "2027-02-01T00:00:00Z"), "duplicate");
    assert.deepEqual((await months()).at(-1), { s: "2027-02-28", e: "2027-03-28" });
    assert.equal((await service("select public.plan_period_expire('plink_D') as r")).r, false);
  });
  await check(`${database}: plan periods: owners read only their own, nobody writes them directly (#718)`, async () => {
    const as = async (role, user, run) => {
      const session = client(database);
      await session.connect();
      try {
        await session.query("begin"); await session.query(`set local role ${role}`);
        if (user) await session.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
        return await run(session);
      } finally { await session.query("rollback").catch(() => {}); await session.end(); }
    };
    await as("authenticated", owner, async (session) => {
      assert.equal((await session.query("select count(*)::int as n from public.plan_periods")).rows[0].n, 3);
      await session.query("savepoint s");
      await assert.rejects(session.query("select public.plan_period_open($1)", [business]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("update public.plan_periods set state='paid'"), { code: "42501" });
    });
    await as("authenticated", other, async (session) => {
      assert.equal((await session.query("select count(*)::int as n from public.plan_periods")).rows[0].n, 0);
    });
    await as("anon", null, async (session) => {
      await assert.rejects(session.query("select 1 from public.plan_periods"), { code: "42501" });
    });
    await assert.rejects(db.query("insert into public.plan_periods(business_id,amount_paise) values ($1,100)", [business]), { code: "23514" });
    // QA (#1430): paid months are receipts (GST, disputes), so deleting the business can't silently erase them.
    // RESTRICT reports 23001 (restrict_violation); NO ACTION-style checks report 23503. Either means refused.
    await assert.rejects(db.query("delete from public.businesses where id=$1", [business]), { code: /^(23001|23503)$/ });
  });
}

/**
 * #1700 (QA red tests for #1670: CTO design 18:55Z + Reviewer's 7 points, 19:06Z). A rep hands a `+prospect` business to
 * its owner: the owner's own new account claims it with a single-use link; nothing of the staff login carries over.
 * Skips until a `db/migrations/*business_transfer*.sql` exists (META_TEST_TRANSFER_SQL points at another file to try).
 * Contract these cases pin (rename freely, keep the behaviour):
 *   private.business_transfers(id, business_id, from_user_id, target_email, token_hash, state, expires_at, ...)
 *   public.business_transfer_start(p_business_id uuid, p_from_user_id uuid, p_target_email text, p_token_hash text)
 *     returns uuid, service_role only, 30-min expiry; refuses unless p_from_user_id owns the business with a
 *     `+prospect@<team domain>` address and the pre-checks pass (no live Meta connection, no campaigns, no payments).
 *   public.business_transfer_claim(p_token_hash text) returns uuid (the business), for `authenticated`: the session's
 *     confirmed email (case-insensitive) must be the target; pre-checks re-run under lock; single use; refuses a target
 *     that already owns a business; moves owner_id on businesses, campaign_drafts, preference_settings and
 *     declared_preferences; writes one audit_log row naming both users.
 */
async function verifyBusinessTransfer(db, database) {
  const files = (await readdir(join(root, "db/migrations"))).filter((file) => /business_transfer/.test(file)).sort();
  const override = process.env.META_TEST_TRANSFER_SQL;
  if (!files.length && !override) { console.log(`SKIP ${database}: business transfer (#1670) is not built yet`); return; }
  // The move covers every owner_id table (Reviewer, #1670); a database whose chain lacks one can't test it.
  const missing = (await db.query("select t from unnest(array['public.campaign_drafts','public.preference_settings','public.declared_preferences','public.audit_log']) t where to_regclass(t) is null")).rows.map((row) => row.t);
  if (missing.length) { console.log(`SKIP ${database}: business transfer (#1670) needs ${missing.join(", ")}`); return; }
  // Supabase has these; the bootstrap's auth stub doesn't.
  await db.query("alter table auth.users add column if not exists email_confirmed_at timestamptz");
  await db.query(`create or replace function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$`);
  await db.query("grant execute on function auth.jwt() to authenticated, service_role");
  for (const file of files) { const sql = await readFile(join(root, "db/migrations", file), "utf8"); await db.query(sql); await db.query(sql); }
  if (override) await db.query(await readFile(override, "utf8"));

  const hash = (token) => createHash("sha256").update(token).digest("hex");
  const session = async (role, claims, run) => {
    const s = client(database);
    await s.connect();
    try {
      await s.query("begin"); await s.query(`set local role ${role}`);
      if (claims) {
        await s.query("select set_config('request.jwt.claim.sub',$1,true)", [claims.sub]);
        await s.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
      }
      const result = await run(s); await s.query("commit"); return result;
    } catch (error) { await s.query("rollback").catch(() => {}); throw error; } finally { await s.end(); }
  };
  const start = (business, from, email, token) => session("service_role", null,
    async (s) => (await s.query("select public.business_transfer_start($1,$2,$3,$4) as id", [business, from, email, hash(token)])).rows[0].id);
  const claim = (user, email, token) => session("authenticated", { sub: user, email, role: "authenticated" },
    async (s) => (await s.query("select public.business_transfer_claim($1) as business_id", [hash(token)])).rows[0].business_id);
  const ownerOf = async (business) => (await db.query("select owner_id from public.businesses where id=$1", [business])).rows[0].owner_id;
  const seed = async ({ staffEmail, ownerConfirmed = true } = {}) => {
    const staff = randomUUID(), owner = randomUUID(), business = randomUUID();
    const ownerEmail = `owner-${owner.slice(0, 8)}@example.com`;
    await db.query("insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now()),($3,$4,$5)",
      [staff, staffEmail ?? `qa+prospect-${staff.slice(0, 8)}@adbrain.vanshul.com`, owner, ownerEmail, ownerConfirmed ? new Date() : null]);
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Prospect bakery')", [business, staff]);
    return { staff, owner, business, ownerEmail };
  };

  await check(`${database}: business transfer: the owner's own account claims it once; drafts and preferences move; audited (#1670)`, async () => {
    const { staff, owner, business, ownerEmail } = await seed();
    await db.query("insert into public.preference_settings(business_id,owner_id,enabled) values ($1,$2,true)", [business, staff]);
    await db.query("insert into public.declared_preferences(business_id,owner_id,category,value) values ($1,$2,'tone','warm')", [business, staff]);
    await db.query("insert into public.campaign_drafts(business_id,owner_id,input,expires_at) values ($1,$2,'{}',now()+interval '1 day')", [business, staff]);
    await start(business, staff, ownerEmail, "token-happy");
    // Case-insensitive: the owner's mail app may capitalise.
    assert.equal(await claim(owner, ownerEmail.toUpperCase(), "token-happy"), business);
    assert.equal(await ownerOf(business), owner);
    for (const table of ["campaign_drafts", "preference_settings", "declared_preferences"]) {
      const rows = (await db.query(`select owner_id from public.${table} where business_id=$1`, [business])).rows;
      assert.ok(rows.length && rows.every((row) => row.owner_id === owner), `${table} moved to the owner`);
    }
    const audit = (await db.query("select details::text as details, actor_id from public.audit_log where business_id=$1", [business])).rows;
    assert.ok(audit.some((row) => `${row.details} ${row.actor_id}`.includes(staff) && `${row.details} ${row.actor_id}`.includes(owner)), "one audit row names both users");
    await assert.rejects(claim(owner, ownerEmail, "token-happy"), "a used link is refused");
  });

  await check(`${database}: business transfer: expired, wrong email, unconfirmed email and an unknown link are refused (#1670)`, async () => {
    const expired = await seed();
    await start(expired.business, expired.staff, expired.ownerEmail, "token-expired");
    await db.query("update private.business_transfers set expires_at = now() - interval '1 minute' where token_hash=$1", [hash("token-expired")]);
    await assert.rejects(claim(expired.owner, expired.ownerEmail, "token-expired"));
    assert.equal(await ownerOf(expired.business), expired.staff);

    const wrong = await seed();
    await start(wrong.business, wrong.staff, wrong.ownerEmail, "token-wrong");
    const stranger = randomUUID();
    await db.query("insert into auth.users(id,email,email_confirmed_at) values ($1,'stranger@example.com',now())", [stranger]);
    await assert.rejects(claim(stranger, "stranger@example.com", "token-wrong"));
    // The JWT's email claim alone isn't proof: it must be this user's confirmed address.
    await assert.rejects(claim(stranger, wrong.ownerEmail, "token-wrong"));
    assert.equal(await ownerOf(wrong.business), wrong.staff);

    const unconfirmed = await seed({ ownerConfirmed: false });
    await start(unconfirmed.business, unconfirmed.staff, unconfirmed.ownerEmail, "token-unconfirmed");
    await assert.rejects(claim(unconfirmed.owner, unconfirmed.ownerEmail, "token-unconfirmed"));
    assert.equal(await ownerOf(unconfirmed.business), unconfirmed.staff);

    await assert.rejects(claim(wrong.owner, wrong.ownerEmail, "token-never-issued"));
  });

  await check(`${database}: business transfer: pre-checks block at start and again at claim (Meta connected, a campaign) (#1670)`, async () => {
    const atStart = await seed();
    await db.query("insert into public.meta_connections(business_id,authorization_status) values ($1,'connected')", [atStart.business]);
    await assert.rejects(start(atStart.business, atStart.staff, atStart.ownerEmail, "token-meta-start"));

    // Staff connect Meta after the link went out: the claim re-checks under lock.
    const atClaim = await seed();
    await start(atClaim.business, atClaim.staff, atClaim.ownerEmail, "token-meta-claim");
    await db.query("insert into public.meta_connections(business_id,authorization_status) values ($1,'connected')", [atClaim.business]);
    await assert.rejects(claim(atClaim.owner, atClaim.ownerEmail, "token-meta-claim"));
    assert.equal(await ownerOf(atClaim.business), atClaim.staff);

    const campaign = await seed();
    await start(campaign.business, campaign.staff, campaign.ownerEmail, "token-campaign");
    await db.query("insert into public.campaigns(id,business_id,daily_budget) values ($1,$2,300)", [randomUUID(), campaign.business]);
    await assert.rejects(claim(campaign.owner, campaign.ownerEmail, "token-campaign"));
    assert.equal(await ownerOf(campaign.business), campaign.staff);
  });

  await check(`${database}: business transfer: only a +prospect owner can start; a target who already owns a business is refused (#1670)`, async () => {
    for (const staffEmail of ["qa@adbrain.vanshul.com", "owner@example.com"]) {
      const notProspect = await seed({ staffEmail: staffEmail.replace("@", `-${randomUUID().slice(0, 6)}@`) });
      await assert.rejects(start(notProspect.business, notProspect.staff, notProspect.ownerEmail, `token-np-${staffEmail}`), staffEmail);
    }
    const notOwner = await seed();
    await assert.rejects(start(notOwner.business, notOwner.owner, notOwner.ownerEmail, "token-not-owner"), "the starter must own the business");

    const taken = await seed();
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Their own shop')", [randomUUID(), taken.owner]);
    await start(taken.business, taken.staff, taken.ownerEmail, "token-taken");
    await assert.rejects(claim(taken.owner, taken.ownerEmail, "token-taken"));
    assert.equal(await ownerOf(taken.business), taken.staff);
  });

  await check(`${database}: business transfer: two simultaneous claims, exactly one wins (#1670)`, async () => {
    const race = await seed();
    await start(race.business, race.staff, race.ownerEmail, "token-race");
    const results = await Promise.allSettled([claim(race.owner, race.ownerEmail, "token-race"), claim(race.owner, race.ownerEmail, "token-race")]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(await ownerOf(race.business), race.owner);
  });

  await check(`${database}: business transfer: browsers can't start one or read the transfers; anon can't claim (#1670)`, async () => {
    const roles = await seed();
    await assert.rejects(session("authenticated", { sub: roles.staff, email: "x", role: "authenticated" },
      (s) => s.query("select public.business_transfer_start($1,$2,$3,$4)", [roles.business, roles.staff, roles.ownerEmail, hash("token-browser")])), { code: "42501" });
    await assert.rejects(session("authenticated", { sub: roles.staff, email: "x", role: "authenticated" },
      (s) => s.query("select 1 from private.business_transfers")), { code: "42501" });
    await assert.rejects(session("anon", null, (s) => s.query("select public.business_transfer_claim($1)", [hash("token-anon")])), { code: "42501" });
  });
}

/** #1838: the crons remember Meta's throttling per account and app-wide; never shortened, at most a day, service role only. */
async function verifyMetaThrottle(db, database) {
  const sql = await readFile(join(root, "db/migrations/20261029_meta_throttle.sql"), "utf8");
  await db.query(sql); await db.query(sql);
  const as = async (role, run) => {
    const s = client(database); await s.connect();
    try { await s.query("begin"); await s.query(`set local role ${role}`); const result = await run(s); await s.query("commit"); return result; }
    catch (error) { await s.query("rollback").catch(() => {}); throw error; } finally { await s.end(); }
  };
  const record = (business, scope, minutes) => as("service_role", (s) => s.query(
    "select public.meta_throttle_record($1,$2,now() + make_interval(mins => $3))", [business, scope, minutes]));
  await check(`${database}: Meta throttle: an account wait is kept, never shortened, at most a day (#1838)`, async () => {
    const owner = randomUUID(), business = randomUUID();
    await db.query("insert into auth.users(id) values ($1)", [owner]);
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Throttled')", [business, owner]);
    await db.query("insert into public.meta_connections(business_id,authorization_status) values ($1,'connected')", [business]);
    const until = async () => (await db.query("select extract(epoch from throttled_until - now())/60 as mins, throttled_scope from public.meta_connections where business_id=$1", [business])).rows[0];
    await record(business, "account", 37);
    let row = await until();
    assert.ok(row.mins > 36 && row.mins <= 37, String(row.mins)); assert.equal(row.throttled_scope, "account");
    await record(business, "account", 5);
    assert.ok((await until()).mins > 36, "a smaller later estimate doesn't shorten the wait");
    await record(business, "page", 60 * 48);
    row = await until();
    assert.ok(row.mins <= 24 * 60 + 1, "capped at a day"); assert.equal(row.throttled_scope, "page");
    await assert.rejects(record(business, "everyone", 5));
  });
  await check(`${database}: Meta throttle: the app-wide limit is one row; only the service role touches it (#1838)`, async () => {
    await record(randomUUID(), "app", 15);
    const app = await as("service_role", async (s) => (await s.query("select public.meta_app_throttled_until() as until")).rows[0].until);
    assert.ok(app && new Date(app).getTime() > Date.now(), "app throttle active");
    await assert.rejects(as("authenticated", (s) => s.query("select public.meta_throttle_record($1,'app',now())", [randomUUID()])), { code: "42501" });
    await assert.rejects(as("authenticated", (s) => s.query("select public.meta_app_throttled_until()")), { code: "42501" });
    await assert.rejects(as("authenticated", (s) => s.query("select 1 from private.channel_throttle")), { code: "42501" });
    await db.query("delete from private.channel_throttle");
  });
}

async function verifyOwnerAlertSends(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Sends')", [business, owner]);
  await db.query("insert into public.owner_alert_prefs(business_id,owner_id,lead_alerts,daily_results,phone_e164,verified_at) values ($1,$2,true,false,'+919800000009',now())", [business, owner]);
  const as = async (role, user, run) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query(`set local role ${role}`);
      if (user) await session.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      const result = await run(session);
      await session.query("commit");
      return result;
    } catch (error) { await session.query("rollback").catch(() => {}); throw error; } finally { await session.end(); }
  };
  const claim = (key, { kind = "lead", template = "lead_alert_en", cap = 100 } = {}) => as("service_role", null, async (session) =>
    (await session.query("select public.owner_alert_claim($1,$2,$3,$4,$5) as r", [business, kind, key, template, cap])).rows[0].r);
  const settle = (id, state, counts = false, code = null) => as("service_role", null, (session) =>
    session.query("select public.owner_alert_settle($1,$2,$3,$4,$5)", [id, state, code, state === "sent" ? "wamid.X" : null, counts]));
  const prefs = async () => (await db.query("select send_failures, paused_at is not null as paused from public.owner_alert_prefs where business_id=$1", [business])).rows[0];
  await check(`${database}: WhatsApp alert sends: one alert per lead, retry and unknown, owners read only their own (#701)`, async () => {
    const first = await claim("lead-1");
    assert.deepEqual({ ...first, sendId: typeof first.sendId }, { claimed: true, sendId: "number", phone: "+919800000009", language: "en" });
    assert.deepEqual(await claim("lead-1"), { claimed: false, reason: "duplicate" });
    await settle(first.sendId, "sent");
    const retry = await claim("lead-2");
    await settle(retry.sendId, "retry");
    assert.equal((await claim("lead-2")).claimed, true);
    assert.equal((await db.query("select attempts from public.owner_alert_sends where id=$1", [retry.sendId])).rows[0].attempts, 2);
    const unknown = await claim("lead-3");
    await settle(unknown.sendId, "unknown");
    assert.deepEqual(await claim("lead-3"), { claimed: false, reason: "duplicate" });
    assert.deepEqual(await claim("2026-10-27", { kind: "daily" }), { claimed: false, reason: "off" });
    await as("authenticated", owner, async (session) => {
      assert.equal((await session.query("select count(*)::int as n from public.owner_alert_sends")).rows[0].n, 3);
      await session.query("savepoint s");
      await assert.rejects(session.query("select public.owner_alert_claim($1,'lead','x','t',9)", [business]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("insert into public.owner_alert_sends(business_id,kind,dedupe_key,template) values ($1,'lead','y','t')", [business]), { code: "42501" });
    });
    await as("authenticated", other, async (session) => {
      assert.equal((await session.query("select count(*)::int as n from public.owner_alert_sends")).rows[0].n, 0);
    });
    await as("anon", null, async (session) => {
      await assert.rejects(session.query("select 1 from public.owner_alert_sends"), { code: "42501" });
    });
  });
  await check(`${database}: WhatsApp alert sends: 3 counted failures pause until a new START; the cap pauses only the daily line; blocked template and STOP refuse (#701)`, async () => {
    for (const key of ["f-1", "f-2"]) { const c = await claim(key); await settle(c.sendId, "failed", true, "131026"); }
    const notCounted = await claim("f-x"); await settle(notCounted.sendId, "failed", false, "132018");
    assert.deepEqual(await prefs(), { send_failures: 2, paused: false });
    const third = await claim("f-3"); await settle(third.sendId, "failed", true, "131026");
    assert.deepEqual(await prefs(), { send_failures: 3, paused: true });
    assert.deepEqual(await claim("f-4"), { claimed: false, reason: "paused" });
    await db.query("update public.owner_alert_prefs set verified_at = now() + interval '1 second' where business_id=$1", [business]);
    assert.deepEqual(await prefs(), { send_failures: 0, paused: false });
    // The monthly cap (all businesses) pauses only the daily line; lead alerts keep going.
    await db.query("update public.owner_alert_prefs set daily_results = true where business_id=$1", [business]);
    const used = (await db.query("select count(*)::int as n from public.owner_alert_sends where state in ('pending','sent','unknown')")).rows[0].n;
    assert.deepEqual(await claim("2026-10-27", { kind: "daily", cap: used }), { claimed: false, reason: "cap" });
    assert.equal((await claim("2026-10-27", { kind: "daily", cap: used + 1 })).claimed, true);
    assert.equal((await claim("cap-lead", { cap: 0 })).claimed, true);
    await as("service_role", null, (session) => session.query("select public.owner_alert_template_block('lead_alert_en','MARKETING')"));
    assert.deepEqual(await claim("blocked-1"), { claimed: false, reason: "template_blocked" });
    await as("service_role", null, (session) => session.query("select public.owner_alert_stop('+919800000009')"));
    assert.deepEqual(await claim("stop-1", { template: "lead_alert_hi" }), { claimed: false, reason: "opted_out" });
  });
}

async function verifyOwnerWhatsAppAlerts(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID(), otherBusiness = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Alerts'),($3,$4,'Other alerts')", [business, owner, otherBusiness, other]);
  const as = async (role, user, run) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query(`set local role ${role}`);
      if (user) await session.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      const result = await run(session);
      await session.query("commit");
      return result;
    } catch (error) { await session.query("rollback").catch(() => {}); throw error; } finally { await session.end(); }
  };
  await check(`${database}: WhatsApp alerts: owners change only their own switches through the function, and every change is logged (#701)`, async () => {
    await as("authenticated", owner, async (session) => {
      await session.query("select public.owner_alert_prefs_set($1,true,false,'hi')", [business]);
      await session.query("savepoint s");
      await assert.rejects(session.query("select public.owner_alert_prefs_set($1,true,true,'en')", [otherBusiness]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("select public.owner_alert_prefs_set($1,true,true,'fr')", [business]), { code: "22023" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("update public.owner_alert_prefs set verified_at=now(), phone_e164='+919800000001' where business_id=$1", [business]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("select public.owner_alert_confirm('ABCDEF1234','+919800000001')"), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("insert into public.owner_alert_consent_events(business_id,event,method) values ($1,'verified','settings')", [business]), { code: "42501" });
      await session.query("rollback to savepoint s");
      assert.deepEqual((await session.query("select lead_alerts, daily_results, language, verified_at from public.owner_alert_prefs")).rows, [{ lead_alerts: true, daily_results: false, language: "hi", verified_at: null }]);
    });
    await as("authenticated", other, async (session) => {
      assert.equal((await session.query("select count(*)::int as n from public.owner_alert_prefs")).rows[0].n, 0);
      assert.equal((await session.query("select count(*)::int as n from public.owner_alert_consent_events")).rows[0].n, 0);
      // #1606: whoever holds a START code gets the business's enquiries, so another user can never mint one.
      await assert.rejects(session.query("select public.owner_alert_start_verification($1)", [business]), { code: "42501" });
    });
    await as("anon", null, async (session) => {
      await assert.rejects(session.query("select 1 from public.owner_alert_prefs"), { code: "42501" });
    });
    assert.deepEqual((await db.query("select event, method, detail from public.owner_alert_consent_events where business_id=$1", [business])).rows,
      [{ event: "preferences", method: "settings", detail: { lead_alerts: true, daily_results: false, language: "hi" } }]);
  });
  await check(`${database}: WhatsApp alerts: START <code> binds the sender's number once, an expired code binds nothing, STOP turns both off and only a new START lifts it (#701)`, async () => {
    const code = await as("authenticated", owner, async (session) => (await session.query("select public.owner_alert_start_verification($1) as code", [business])).rows[0].code);
    assert.match(code, /^[A-F0-9]{10}$/);
    await as("service_role", null, async (session) => {
      assert.equal((await session.query("select public.owner_alert_confirm('0000000000','+919800000001') as id")).rows[0].id, null);
      assert.equal((await session.query("select public.owner_alert_confirm($1,'+919800000001') as id", [code])).rows[0].id, business);
      assert.equal((await session.query("select public.owner_alert_confirm($1,'+919800000002') as id", [code])).rows[0].id, null);
    });
    assert.deepEqual((await db.query("select phone_e164, verify_code, verified_at is not null as verified from public.owner_alert_prefs where business_id=$1", [business])).rows,
      [{ phone_e164: "+919800000001", verify_code: null, verified: true }]);
    const stale = await as("authenticated", owner, async (session) => (await session.query("select public.owner_alert_start_verification($1) as code", [business])).rows[0].code);
    await db.query("update public.owner_alert_prefs set verify_expires_at = now() - interval '1 second' where business_id=$1", [business]);
    await as("service_role", null, async (session) => {
      assert.equal((await session.query("select public.owner_alert_confirm($1,'+919800000003') as id", [stale])).rows[0].id, null);
      assert.equal((await session.query("select public.owner_alert_stop('+919800000001') as n")).rows[0].n, 1);
      assert.equal((await session.query("select public.owner_alert_stop('+919800000001') as n")).rows[0].n, 0);
    });
    assert.deepEqual((await db.query("select lead_alerts, daily_results, phone_e164, opted_out_at is not null as out from public.owner_alert_prefs where business_id=$1", [business])).rows,
      [{ lead_alerts: false, daily_results: false, phone_e164: "+919800000001", out: true }]);
    assert.deepEqual((await db.query("select event, method, detail from public.owner_alert_consent_events where business_id=$1 order by id", [business])).rows.map((row) => [row.event, row.method, row.detail.phone_last4 ?? null]),
      [["preferences", "settings", null], ["verified", "whatsapp_start", "0001"], ["opted_out", "whatsapp_stop", "0001"]]);
    // Settings can't lift a STOP: only a fresh START <code> from the phone does.
    await as("authenticated", owner, async (session) => session.query("select public.owner_alert_prefs_set($1,true,true,'en')", [business]));
    assert.deepEqual((await db.query("select lead_alerts, daily_results, opted_out_at is not null as out from public.owner_alert_prefs where business_id=$1", [business])).rows,
      [{ lead_alerts: true, daily_results: true, out: true }]);
    const again = await as("authenticated", owner, async (session) => (await session.query("select public.owner_alert_start_verification($1) as code", [business])).rows[0].code);
    await as("service_role", null, async (session) => {
      assert.equal((await session.query("select public.owner_alert_confirm($1,'+919800000001') as id", [again])).rows[0].id, business);
    });
    assert.equal((await db.query("select opted_out_at from public.owner_alert_prefs where business_id=$1", [business])).rows[0].opted_out_at, null);
  });
}

async function verifyCampaignEditOperations(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID(), otherBusiness = randomUUID(), campaign = randomUUID(), otherCampaign = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Edits'),($3,$4,'Other edits')", [business, owner, otherBusiness, other]);
  await db.query("insert into public.campaigns(id,business_id,daily_budget) values ($1,$2,300),($3,$4,300)", [campaign, business, otherCampaign, otherBusiness]);
  const as = async (role, user, run) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query(`set local role ${role}`);
      if (user) await session.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      return await run(session);
    } finally { await session.query("rollback").catch(() => {}); await session.end(); }
  };
  const hash = "a".repeat(64);
  await check(`${database}: edit envelope: owners read only their own rows; only the service role writes; one row per key (#773)`, async () => {
    await db.query("insert into public.campaign_edit_operations(business_id,campaign_id,kind,idempotency_key,request_hash) values ($1,$2,'audience','edit-key-1',$3),($4,$5,'budget','edit-key-2',$3)",
      [business, campaign, hash, otherBusiness, otherCampaign]);
    await as("service_role", null, async (session) => {
      await session.query("update public.campaign_edit_operations set state='running', phase='edit', transmitted=true where campaign_id=$1", [campaign]);
      await session.query("savepoint s");
      await assert.rejects(session.query("insert into public.campaign_edit_operations(business_id,campaign_id,kind,idempotency_key,request_hash) values ($1,$2,'audience','edit-key-1',$3)", [business, campaign, hash]), { code: "23505" });
      await session.query("rollback to savepoint s");
      for (const values of [["'other'", "'edit-key-3'", `'${hash}'`], ["'audience'", "'short'", `'${hash}'`], ["'audience'", "'edit-key-4'", "'not-a-hash'"]]) {
        await assert.rejects(session.query(`insert into public.campaign_edit_operations(business_id,campaign_id,kind,idempotency_key,request_hash) values ($1,$2,${values.join(",")})`, [business, campaign]), { code: "23514" });
        await session.query("rollback to savepoint s");
      }
      await assert.rejects(session.query("update public.campaign_edit_operations set state='done' where campaign_id=$1", [campaign]), { code: "23514" });
    });
    await as("authenticated", owner, async (session) => {
      assert.deepEqual((await session.query("select campaign_id, state, phase, transmitted from public.campaign_edit_operations")).rows, [{ campaign_id: campaign, state: "pending", phase: "validate", transmitted: false }]);
      await session.query("savepoint s");
      await assert.rejects(session.query("update public.campaign_edit_operations set state='succeeded' where campaign_id=$1", [campaign]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("insert into public.campaign_edit_operations(business_id,campaign_id,kind,idempotency_key,request_hash) values ($1,$2,'audience','edit-key-9',$3)", [business, campaign, hash]), { code: "42501" });
    });
    await as("authenticated", other, async (session) => {
      assert.deepEqual((await session.query("select campaign_id from public.campaign_edit_operations")).rows, [{ campaign_id: otherCampaign }]);
    });
    await as("anon", null, async (session) => {
      await assert.rejects(session.query("select 1 from public.campaign_edit_operations"), { code: "42501" });
    });
  });
}

async function verifyWhatsAppBindings(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID(), otherBusiness = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Bound'),($3,$4,'Other bound')", [business, owner, otherBusiness, other]);
  const as = async (role, user, run) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query(`set local role ${role}`);
      if (user) await session.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      return await run(session);
    } finally { await session.query("rollback").catch(() => {}); await session.end(); }
  };
  await check(`${database}: WhatsApp number bindings: owners read only their own; only the service role writes (#253)`, async () => {
    await as("service_role", null, async (session) => {
      await session.query("insert into public.whatsapp_number_bindings(business_id,phone_e164,source) values ($1,'+919999990874','owner_pick'),($2,'+919999994842','owner_pick')", [business, otherBusiness]);
      await session.query("savepoint s");
      await assert.rejects(session.query("insert into public.whatsapp_number_bindings(business_id,phone_e164,source) values ($1,'98765','owner_pick')", [business]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("insert into public.whatsapp_number_bindings(business_id,phone_e164,source) values ($1,'+919876543210','guess')", [business]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await session.query("commit");
    });
    await as("authenticated", owner, async (session) => {
      assert.deepEqual((await session.query("select business_id,phone_e164 from public.whatsapp_number_bindings")).rows, [{ business_id: business, phone_e164: "+919999990874" }]);
      await session.query("savepoint s");
      await assert.rejects(session.query("insert into public.whatsapp_number_bindings(business_id,phone_e164,source) values ($1,'+919999994842','owner_pick')", [business]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("delete from public.whatsapp_number_bindings where business_id=$1", [otherBusiness]), { code: "42501" });
    });
    await as("anon", null, async (session) => {
      await assert.rejects(session.query("select 1 from public.whatsapp_number_bindings"), { code: "42501" });
    });
  });
}

async function verifyManagedAccounts(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID(), otherBusiness = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Managed'),($3,$4,'Other managed')", [business, owner, otherBusiness, other]);
  const as = async (role, user, run) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query(`set local role ${role}`);
      if (user) await session.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      return await run(session);
    } finally { await session.query("rollback").catch(() => {}); await session.end(); }
  };
  await check(`${database}: 2T managed accounts: owners read only their own row and events; only the service role writes (#519)`, async () => {
    await as("service_role", null, async (session) => {
      await session.query("insert into public.managed_meta_accounts(business_id,page_id) values ($1,'111'),($2,'222')", [business, otherBusiness]);
      await session.query("insert into public.managed_meta_account_events(business_id,step,outcome,meta_object_id) values ($1,'page','succeeded','111'),($2,'page','succeeded','222')", [business, otherBusiness]);
      await session.query("update public.managed_meta_accounts set state='page_linked' where business_id=$1", [business]);
      await session.query("commit");
    });
    await as("authenticated", owner, async (session) => {
      assert.deepEqual((await session.query("select business_id,state from public.managed_meta_accounts")).rows, [{ business_id: business, state: "page_linked" }]);
      assert.deepEqual((await session.query("select business_id from public.managed_meta_account_events")).rows, [{ business_id: business }]);
      await session.query("savepoint s");
      await assert.rejects(session.query("update public.managed_meta_accounts set state='ready' where business_id=$1", [business]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("insert into public.managed_meta_accounts(business_id) values ($1)", [business]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("insert into public.managed_meta_account_events(business_id,step,outcome) values ($1,'page','started')", [business]), { code: "42501" });
    });
    await as("authenticated", other, async (session) => {
      assert.deepEqual((await session.query("select business_id from public.managed_meta_accounts")).rows, [{ business_id: otherBusiness }]);
    });
    await as("anon", null, async (session) => {
      await assert.rejects(session.query("select 1 from public.managed_meta_accounts"), { code: "42501" });
    });
  });
  await check(`${database}: 2T managed accounts: the state machine, fixed IDs and append-only events (#519)`, async () => {
    const update = (sql, values) => as("service_role", null, (session) => session.query(sql, values));
    // Skipping a step, or reaching a state without its Meta IDs, is refused.
    await assert.rejects(update("update public.managed_meta_accounts set state='ready' where business_id=$1", [business]), { code: "23514" });
    await assert.rejects(update("update public.managed_meta_accounts set state='child_created' where business_id=$1", [business]), { code: "23514" });
    await assert.rejects(update("update public.managed_meta_accounts set state='funded', child_business_id='333', ad_account_id='act_444' where business_id=$1", [business]), { code: "23514" });
    await as("service_role", null, async (session) => {
      for (const step of ["state='child_created', child_business_id='333'", "state='ad_account_created', ad_account_id='act_444'",
        "state='funded', funding_state='card_attached'", "state='ready'"]) {
        await session.query(`update public.managed_meta_accounts set ${step} where business_id=$1`, [business]);
      }
      const row = (await session.query("select state, created_at < updated_at or created_at = updated_at as clock from public.managed_meta_accounts where business_id=$1", [business])).rows[0];
      assert.deepEqual(row, { state: "ready", clock: true });
      await session.query("savepoint s");
      // A tenant's child business and ad account can never be re-pointed, nor shared with another tenant.
      await assert.rejects(session.query("update public.managed_meta_accounts set ad_account_id='act_555' where business_id=$1", [business]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("update public.managed_meta_accounts set child_business_id=null where business_id=$1", [business]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("update public.managed_meta_accounts set child_business_id='333' where business_id=$1", [otherBusiness]), { code: "23505" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("update public.managed_meta_accounts set last_error='token=EAAB secret value' where business_id=$1", [business]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query(`update public.managed_meta_accounts set step_keys='{"child_business":"EAAB token with spaces"}' where business_id=$1`, [business]), { code: "23514" });
      await session.query("rollback to savepoint s");
      await session.query(`update public.managed_meta_accounts set step_keys='{"child_business":"b1-child-2026-10-25"}' where business_id=$1`, [business]);
      await assert.rejects(session.query("update public.managed_meta_account_events set outcome='failed' where business_id=$1", [business]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("delete from public.managed_meta_account_events where business_id=$1", [business]), { code: "42501" });
      await session.query("rollback to savepoint s");
      await session.query("update public.managed_meta_accounts set state='offboarding' where business_id=$1", [business]);
      await session.query("update public.managed_meta_accounts set state='offboarded' where business_id=$1", [business]);
      await assert.rejects(session.query("update public.managed_meta_accounts set state='ready' where business_id=$1", [business]), { code: "23514" });
    });
    // A business can't be deleted while its managed account exists (its ad account could still spend).
    // restrict_violation (23001) or foreign_key_violation (23503), depending on the Postgres build.
    await assert.rejects(db.query("delete from public.businesses where id=$1", [business]), (error) => ["23001", "23503"].includes(error.code));
  });
}

// QA red checks for #527 T1: no two tenants share a Page or a WhatsApp number, an insert can't skip
// the state machine, and an offboarding account can't be revived to ready.
async function verifyManagedSpendCaps(db, database) {
  const owner = randomUUID(), otherOwner = randomUUID(), business = randomUUID(), otherBusiness = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, otherOwner]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Capped child'),($3,$4,'Other tenant')", [business, owner, otherBusiness, otherOwner]);
  await db.query("insert into public.managed_meta_accounts(business_id,page_id) values ($1,'71001')", [business]);
  for (const step of ["state='page_linked'", "state='child_created', child_business_id='72001'", "state='ad_account_created', ad_account_id='act_73001'"]) {
    await db.query(`update public.managed_meta_accounts set ${step} where business_id=$1`, [business]);
  }
  const service = async (sql, values) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("set role service_role");
      return (await session.query(sql, values)).rows[0];
    } finally { await session.end(); }
  };
  const request = (token, tenant = business, account = "act_73001") =>
    service("select public.managed_spend_cap_request($1,$2,$3,60) as claimed", [tenant, account, token]).then((row) => row.claimed);
  const begin = (token) => service("select public.managed_spend_cap_begin('act_73001',$1,60) as ok", [token]).then((row) => row.ok);
  const finish = (token, action, cap, room) =>
    service("select public.managed_spend_cap_finish('act_73001',$1,$2,$3,$4,60) as again", [token, action, cap, room]).then((row) => row.again);
  const state = () => service("select public.managed_spend_cap_state($1,'act_73001') as s", [business]).then((row) => row.s);
  await check(`${database}: 2T spend caps: one writer per child ad account; an event during a pass makes it run again (#522)`, async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    assert.equal(await request(a), true);
    assert.equal(await request(b), false, "the lease is held");
    assert.equal(await begin(a), true);
    assert.equal(await begin(b), false, "only the holder writes");
    assert.equal(await request(b), false, "a payment during the pass marks the limit stale");
    assert.equal(await finish(a, "set", 33898, 33898), true, "the holder runs again with fresh figures");
    assert.equal(await begin(a), true);
    assert.deepEqual(await state(), { dirty: false, leased: true, action: null, capPaise: null, roomPaise: null }, "a pass in flight: nothing to activate on (review)");
    assert.equal(await finish(a, "keep", 33898, 33898), false, "nothing new: the lease is released");
    assert.deepEqual(await state(), { dirty: false, leased: false, action: "keep", capPaise: 33898, roomPaise: 33898 });
    assert.equal(await request(b), true, "the next event takes the free lease");
    assert.deepEqual(await state(), { dirty: true, leased: true, action: "keep", capPaise: 33898, roomPaise: 33898 });
    await service("select public.managed_spend_cap_abandon('act_73001',$1)", [b]);
    assert.deepEqual(await state(), { dirty: true, leased: false, action: null, capPaise: null, roomPaise: null }, "a failed pass leaves no decision to activate on");
  });
  await check(`${database}: 2T spend caps: of concurrent events exactly one claims the writer lease (#522)`, async () => {
    const claims = await Promise.all(Array.from({ length: 6 }, () => request(randomUUID())));
    assert.equal(claims.filter(Boolean).length, 1);
    await db.query("update private.managed_spend_caps set lease_token=null, lease_until=null where ad_account_id='act_73001'");
  });
  await check(`${database}: 2T spend caps: an expired lease passes on; the old holder can't record a decision (#522)`, async () => {
    const [stale, fresh] = [randomUUID(), randomUUID()];
    assert.equal(await request(stale), true);
    assert.equal(await begin(stale), true);
    await db.query("update private.managed_spend_caps set lease_until=clock_timestamp()-interval '1 second' where ad_account_id='act_73001'");
    assert.equal(await request(fresh), true);
    await assert.rejects(finish(stale, "set", 50000, 50000), { code: "55000" });
    assert.equal(await begin(stale), false);
    assert.equal(await begin(fresh), true);
    assert.equal(await finish(fresh, "freeze", 20000, 0), false);
    assert.deepEqual(await state(), { dirty: false, leased: false, action: "freeze", capPaise: 20000, roomPaise: 0 });
  });
  await check(`${database}: 2T spend caps: only the tenant's own child account, valid decisions, service role only (#522)`, async () => {
    await assert.rejects(request(randomUUID(), otherBusiness), { code: "42501" });
    await assert.rejects(request(randomUUID(), business, "act_99999"), { code: "42501" });
    const token = randomUUID();
    assert.equal(await request(token), true);
    assert.equal(await begin(token), true);
    for (const [action, cap, room] of [["block", 1, 1], ["set", -1, 1], ["set", 1, -1], ["set", 0, 0]]) {
      await assert.rejects(finish(token, action, cap, room), (error) => ["22023", "23514"].includes(error.code), `${action} ${cap} ${room}`);
    }
    await service("select public.managed_spend_cap_abandon('act_73001',$1)", [token]);
    for (const role of ["anon", "authenticated"]) {
      const session = client(database);
      await session.connect();
      try {
        await session.query(`set role ${role}`);
        if (role === "authenticated") await session.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
        for (const sql of ["select public.managed_spend_cap_request($1,'act_73001',gen_random_uuid(),60)", "select public.managed_spend_cap_state($1,'act_73001')",
          "select public.managed_spend_cap_inputs($1,'act_73001','acc_spend_cap')", "select public.managed_spend_cap_mark_stale($1)",
          "select public.managed_spend_cap_mark_payment_stale('acc_spend_cap','pay_x',$1::text)", "select * from public.managed_spend_cap_due(10) where $1::uuid is not null"]) {
          await assert.rejects(session.query(sql, [business]), { code: "42501" }, `${role}: ${sql}`);
        }
        await assert.rejects(session.query("select 1 from private.managed_spend_caps"), { code: "42501" });
      } finally { await session.end(); }
    }
  });
  await check(`${database}: 2T spend caps: a payment, refund or dispute marks the limit stale before it is processed (QA #560)`, async () => {
    const quote = { version: "inr-annual-total-v1", merchantDisplay: "Vanshul Goyal", currency: "INR", totalPaise: 1000000,
      serviceAllocationPaise: 200000, metaAllocationPaise: 800000, additionalCustomerTaxPaise: 0,
      metaTaxTreatment: "included-in-meta-allocation", gatewayFees: "absorbed-by-adbrain", automaticRenewal: false };
    await db.query(`insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,quote,terms,terms_hash,provider_order_id)
      values ($1,$2,$3,$4,'acc_spendcap','rzp_live_fixture',$5,$6,$7,'order_managedcap')`,
      [randomUUID(), business, owner, randomUUID(), quote, { version: "operator-managed-v1", fundingMode: "operator_managed" }, "c".repeat(64)]);
    const token = randomUUID();
    assert.equal(await request(token), true);
    assert.equal(await begin(token), true);
    assert.equal(await finish(token, "set", 33898, 33898), false);
    const target = { businessId: business, userId: owner };
    assert.deepEqual(await service("select public.managed_spend_cap_mark_payment_stale('acc_spendcap','pay_managedcap','order_managedcap') as t").then((row) => row.t), target);
    assert.equal((await state()).dirty, true, "the gate no longer allows activation on the pre-refund limit");
    assert.deepEqual(await service("select public.managed_spend_cap_mark_stale($1) as t", [business]).then((row) => row.t), target);
    assert.equal(await service("select public.managed_spend_cap_mark_payment_stale('acc_spendcap','pay_unknown',null) as t").then((row) => row.t), null);
    assert.equal(await service("select public.managed_spend_cap_mark_stale($1) as t", [otherBusiness]).then((row) => row.t), null, "not managed");
  });
  await check(`${database}: 2T spend caps: the sweep visits stale limits first, then the oldest decision (QA #560)`, async () => {
    const extra = [randomUUID(), randomUUID()];
    for (const [index, id] of extra.entries()) {
      await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Swept child')", [id, owner]);
      await db.query("insert into public.managed_meta_accounts(business_id,page_id) values ($1,$2)", [id, `7600${index}`]);
      for (const step of ["state='page_linked'", `state='child_created', child_business_id='7700${index}'`, `state='ad_account_created', ad_account_id='act_7800${index}'`]) {
        await db.query(`update public.managed_meta_accounts set ${step} where business_id=$1`, [id]);
      }
    }
    const pass = async (tenant, account) => {
      const token = randomUUID();
      assert.equal(await request(token, tenant, account), true);
      assert.equal(await service("select public.managed_spend_cap_begin($1,$2,60) as ok", [account, token]).then((row) => row.ok), true);
      await service("select public.managed_spend_cap_finish($1,$2,'keep',1000,1000,60)", [account, token]);
    };
    await pass(extra[0], "act_78000");
    await pass(extra[1], "act_78001");
    // act_73001 is stale (marked above); act_78000 was decided before act_78001.
    const due = async () => (await db.query("select business_id from public.managed_spend_cap_due(10)")).rows.map((row) => row.business_id);
    assert.deepEqual((await due()).filter((id) => [business, ...extra].includes(id)), [business, extra[0], extra[1]]);
    await pass(extra[0], "act_78000");
    assert.deepEqual((await due()).filter((id) => [business, ...extra].includes(id)), [business, extra[1], extra[0]], "the next run starts where the last one stopped");
  });
  await check(`${database}: 2T spend caps: media this child account and the tenant's other accounts, per payment account (#522)`, async () => {
    const costs = [["act_73001", "acc_spend_cap", 10000, 1800], ["act_73001", "acc_spend_cap", 2500, 1800], ["act_74001", "acc_spend_cap", 5000, 1800],
      ["act_75001", "acc_other_payments", 7000, 1800]];
    for (const [adAccount, account, media, bps] of costs) {
      const campaign = randomUUID();
      await db.query("insert into public.campaigns(id,business_id,daily_budget) values ($1,$2,200)", [campaign, business]);
      await db.query(`insert into private.customer_ad_costs(campaign_id,business_id,account_id,ad_account_id,connection_generation,media_paise,tax_paise,tax_rate_bps,observed_at)
        values ($1,$2,$3,$4,1,$5,0,$6,now())`, [campaign, business, account, adAccount, media, bps]);
    }
    const inputs = await service("select public.managed_spend_cap_inputs($1,'act_73001','acc_spend_cap') as i", [business]).then((row) => row.i);
    assert.deepEqual(inputs, { mediaThisAccountPaise: 12500, mediaOtherAccountsPaise: 5000, taxRateBps: 1800 });
    await assert.rejects(service("select public.managed_spend_cap_inputs($1,'act_73001','acc_spend_cap')", [otherBusiness]), { code: "42501" });
  });
}

async function verifyManagedAccountsTenantQA(db, database) {
  const a = randomUUID(), b = randomUUID(), ownerA = randomUUID(), ownerB = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [ownerA, ownerB]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'QA tenant A'),($3,$4,'QA tenant B')", [a, ownerA, b, ownerB]);
  const asService = async (run) => {
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query("set local role service_role");
      return await run(session);
    } finally { await session.query("rollback").catch(() => {}); await session.end(); }
  };
  await check(`${database}: 2T QA: two tenants can't share a Page or a WhatsApp number (#527 T1, #253)`, async () => {
    await asService(async (session) => {
      await session.query("insert into public.managed_meta_accounts(business_id,page_id,phone_number_id) values ($1,'90001','91001')", [a]);
      await session.query("savepoint s");
      await assert.rejects(session.query("insert into public.managed_meta_accounts(business_id,page_id) values ($1,'90001')", [b]), { code: "23505" });
      await session.query("rollback to savepoint s");
      await assert.rejects(session.query("insert into public.managed_meta_accounts(business_id,page_id,phone_number_id) values ($1,'90002','91001')", [b]), { code: "23505" });
    });
  });
  await check(`${database}: 2T QA: a new managed account starts at requested; an insert can't skip the state machine (#527 T1)`, async () => {
    await asService(async (session) => {
      await assert.rejects(session.query(`insert into public.managed_meta_accounts(business_id,state,page_id,child_business_id,ad_account_id,funding_state)
        values ($1,'ready','90003','90004','act_90005','card_attached')`, [a]), { code: "23514" });
    });
  });
  await check(`${database}: 2T QA: an offboarding account can't be revived to ready through failed (#527 T1)`, async () => {
    await asService(async (session) => {
      await session.query("insert into public.managed_meta_accounts(business_id,page_id) values ($1,'90006')", [a]);
      for (const step of ["state='page_linked'", "state='child_created', child_business_id='90007'", "state='ad_account_created', ad_account_id='act_90008'",
        "state='funded', funding_state='card_attached'", "state='ready'", "state='offboarding'"]) {
        await session.query(`update public.managed_meta_accounts set ${step} where business_id=$1`, [a]);
      }
      await session.query("savepoint s");
      await session.query("update public.managed_meta_accounts set state='failed' where business_id=$1", [a]).catch(() => session.query("rollback to savepoint s"));
      await assert.rejects(session.query("update public.managed_meta_accounts set state='ready' where business_id=$1", [a]), { code: "23514" });
    });
  });
}

async function verifyProvisionLease(db, database) {
  const owner = randomUUID(), other = randomUUID(), business = randomUUID(), otherBusiness = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Lease'),($3,$4,'Other lease')", [business, owner, otherBusiness, other]);
  await db.query("insert into public.managed_meta_accounts(business_id) values ($1),($2)", [business, otherBusiness]);
  const token = async (businessId, by) => (await db.query(`insert into private.meta_tokens(business_id,authorized_by,subject_id,token_kind,ciphertext,nonce,auth_tag,key_id)
    values ($1,$2,'6100000000009','business_system_user','\\x00',decode(repeat('00',12),'hex'),decode(repeat('00',16),'hex'),'k1') returning id`, [businessId, by])).rows[0].id;
  const service = async (sql, values) => {
    const session = client(database);
    await session.connect();
    try { await session.query("set role service_role"); return (await session.query(sql, values)).rows[0]; }
    finally { await session.end(); }
  };
  await check(`${database}: 2T provisioning lease: one run per business, claimed with database time (#521)`, async () => {
    const a = randomUUID(), b = randomUUID();
    const claim = (lease, seconds = 120) => service("select public.managed_meta_account_claim($1,$2,$3) as ok", [business, lease, seconds]).then((row) => row.ok);
    const release = (lease) => service("select public.managed_meta_account_release($1,$2) as ok", [business, lease]).then((row) => row.ok);
    assert.equal(await claim(a), true);
    assert.equal(await claim(b), false, "a second run waits while the lease is held");
    assert.equal(await claim(a), true, "the holder can extend its own lease");
    assert.equal(await release(b), false, "only the holder releases");
    assert.equal(await release(a), true);
    assert.equal(await claim(b), true);
    await db.query("update public.managed_meta_accounts set provision_lease_until = now() - interval '1 second' where business_id=$1", [business]);
    assert.equal(await claim(a), true, "an expired lease can be taken over");
    assert.equal(await service("select public.managed_meta_account_claim($1,$2,120) as ok", [otherBusiness, b]).then((row) => row.ok), true, "leases are per business");
    await assert.rejects(db.query("update public.managed_meta_accounts set provision_lease_id = null where business_id=$1", [business]), { code: "23514" });
    const session = client(database);
    await session.connect();
    try {
      await session.query("begin");
      await session.query("set local role authenticated");
      await session.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      await assert.rejects(session.query("select public.managed_meta_account_claim($1,$2,120)", [business, randomUUID()]), { code: "42501" });
    } finally { await session.query("rollback"); await session.end(); }
  });
  await check(`${database}: 2T manager token: a reference into the encrypted store, same business only (#521)`, async () => {
    const mine = await token(business, owner), theirs = await token(otherBusiness, other);
    await service("update public.managed_meta_accounts set manager_user_id='6100000000009', manager_token_id=$2 where business_id=$1 returning 1 as ok", [business, mine]);
    await assert.rejects(service("update public.managed_meta_accounts set manager_token_id=$2 where business_id=$1 returning 1 as ok", [business, theirs]), { code: "23503" });
    await assert.rejects(service("update public.managed_meta_accounts set manager_user_id='not-an-id' where business_id=$1 returning 1 as ok", [business]), { code: "23514" });
    await db.query("delete from private.meta_tokens where id=$1", [mine]);
    assert.deepEqual((await db.query("select manager_token_id, manager_user_id from public.managed_meta_accounts where business_id=$1", [business])).rows,
      [{ manager_token_id: null, manager_user_id: "6100000000009" }], "deleting the token clears only the reference");
  });
}

// #521 fixture tenant: the exact writes provisionManagedAccount and runManagedProvisioning make, in
// order, as the service role, so the code and the ledger can't disagree on a real customer.
async function verifyProvisioningWalk(db, database) {
  const owner = randomUUID(), business = randomUUID(), lease = randomUUID();
  await db.query("insert into auth.users(id) values ($1)", [owner]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Fixture tenant')", [business, owner]);
  await check(`${database}: 2T provisioning walk: Page link, lease, failed child, resume, account, manager token, grant (#521)`, async () => {
    const session = client(database);
    await session.connect();
    const q = (sql, values = []) => session.query(sql, values);
    const row = async () => (await q("select state, child_business_id, ad_account_id, manager_user_id, manager_token_id, step_keys, last_error, provision_lease_id from public.managed_meta_accounts where business_id=$1", [business])).rows[0];
    const event = (step, outcome, extra = {}) => q(`insert into public.managed_meta_account_events(business_id,step,outcome,request_id,idempotency_key,meta_object_id,error_code)
      values ($1,$2,$3,$4,$5,$6,$7)`, [business, step, outcome, randomUUID(), extra.key ?? null, extra.object ?? null, extra.error ?? null]);
    const token = async (subject) => {
      const id = randomUUID();
      await q(`select public.meta_token_insert($1,$2,$3,$4,'business_system_user',$5,$6,$7,'k1','v1',array['ads_management','business_management'],'[]'::jsonb,null,now(),null)`,
        [id, business, owner, subject, "\\x00", `\\x${"00".repeat(12)}`, `\\x${"00".repeat(16)}`]);
      return id;
    };
    try {
      await q("set role service_role");
      // #537: the Page step inserts at requested, then links.
      await q("insert into public.managed_meta_accounts(business_id,page_id,state) values ($1,'5210000000111','requested')", [business]);
      await q("update public.managed_meta_accounts set page_id='5210000000111', state='page_linked' where business_id=$1", [business]);
      await event("page", "succeeded", { object: "5210000000111" });
      // #577: the run holds the lease before any Meta call.
      assert.equal((await q("select public.managed_meta_account_claim($1,$2,300) as ok", [business, lease])).rows[0].ok, true);
      // A lost child response: failed with a code, nothing recorded.
      const childKey = `child:${business}`;
      await event("child_business", "started", { key: childKey });
      await q("update public.managed_meta_accounts set state='failed', last_error='META_TIMEOUT' where business_id=$1", [business]);
      await event("child_business", "failed", { error: "META_TIMEOUT" });
      // Resume: found by external id, recorded with its step key.
      await q(`update public.managed_meta_accounts set state='child_created', child_business_id='7521000000001', step_keys=$2::jsonb, last_error=null where business_id=$1`,
        [business, JSON.stringify({ child_business: childKey })]);
      await event("child_business", "succeeded", { key: childKey, object: "7521000000001" });
      const accountKey = `account:${business}`;
      await q(`update public.managed_meta_accounts set state='ad_account_created', ad_account_id='act_8521000000001', step_keys=$2::jsonb, last_error=null where business_id=$1`,
        [business, JSON.stringify({ child_business: childKey, ad_account: accountKey })]);
      await event("ad_account", "succeeded", { key: accountKey, object: "act_8521000000001" });
      // The child's own system user: token in the encrypted store, the ledger keeps only a reference.
      const first = await token("6521000000009");
      const managerKey = `manager:${business}`;
      await q(`update public.managed_meta_accounts set manager_user_id='6521000000009', manager_token_id=$2, step_keys=$3::jsonb, last_error=null where business_id=$1`,
        [business, first, JSON.stringify({ child_business: childKey, ad_account: accountKey, manager: managerKey })]);
      await event("ad_account", "succeeded", { key: managerKey, object: "6521000000009" });
      // A re-mint (old token revoked): the new reference is written, then the old token deleted.
      const second = await token("6521000000009");
      await q("update public.managed_meta_accounts set manager_token_id=$2 where business_id=$1", [business, second]);
      assert.equal((await q("select public.meta_token_delete($1,$2) as ok", [first, business])).rows[0].ok, true);
      const grantKey = `grant:${business}`;
      await q(`update public.managed_meta_accounts set state='ad_account_created', step_keys=$2::jsonb, last_error=null where business_id=$1`,
        [business, JSON.stringify({ child_business: childKey, ad_account: accountKey, manager: managerKey, grant: grantKey })]);
      await event("ad_account", "succeeded", { key: grantKey, object: "act_8521000000001" });
      assert.equal((await q("select public.managed_meta_account_release($1,$2) as ok", [business, lease])).rows[0].ok, true);
      const done = await row();
      assert.deepEqual({ ...done, step_keys: Object.keys(done.step_keys).sort() }, {
        state: "ad_account_created", child_business_id: "7521000000001", ad_account_id: "act_8521000000001",
        manager_user_id: "6521000000009", manager_token_id: second, step_keys: ["ad_account", "child_business", "grant", "manager"],
        last_error: null, provision_lease_id: null,
      });
      // The owner sees their own progress and step log (#526 reads these).
      await q("reset role");
      await q("begin");
      await q("set local role authenticated");
      await q("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      assert.equal((await q("select state from public.managed_meta_accounts where business_id=$1", [business])).rows[0].state, "ad_account_created");
      assert.equal((await q("select count(*)::int n from public.managed_meta_account_events where business_id=$1", [business])).rows[0].n, 7, "page, child started/failed/succeeded, account, manager, grant");
      await q("rollback");
    } finally { await session.end(); }
  });
}

async function verifyAdvisorHardening(db, database) {
  await check(`${database}: advisor hardening reapplies cleanly and leaves the expected catalog (#359)`, async () => {
    await db.query(advisorsMigration);
    const fn = (await db.query(`select
      (select prosecdef from pg_proc where oid = 'public.owns_business(uuid)'::regprocedure) as owns_definer,
      has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') as trigger_auth,
      has_function_privilege('anon', 'public.handle_new_user()', 'execute') as trigger_anon,
      (select proconfig from pg_proc where oid = 'public.set_updated_at()'::regprocedure) as touch_config`)).rows[0];
    assert.deepEqual(fn, { owns_definer: false, trigger_auth: false, trigger_anon: false, touch_config: ['search_path=""'] });
    const bare = (await db.query(`select count(*)::int n from pg_policies where schemaname = 'public'
      and (coalesce(qual, '') ~ 'auth\\.uid\\(\\)' or coalesce(with_check, '') ~ 'auth\\.uid\\(\\)')
      and not (coalesce(qual, '') || coalesce(with_check, '')) ~ 'SELECT auth\\.uid\\(\\)'`)).rows[0].n;
    assert.equal(bare, 0, "every policy calling auth.uid() wraps it in (select auth.uid())");
  });
  await check(`${database}: new users still get a profile, and owns_business answers per caller (#359)`, async () => {
    const owner = randomUUID(), other = randomUUID(), business = randomUUID();
    await db.query("insert into auth.users(id,email) values ($1,'advisor-owner@example.invalid'),($2,'advisor-other@example.invalid')", [owner, other]);
    assert.equal((await db.query("select count(*)::int n from public.profiles where id = any($1)", [[owner, other]])).rows[0].n, 2);
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Advisor fixture')", [business, owner]);
    const ask = async (role, user) => {
      const session = client(database);
      await session.connect();
      try {
        await session.query("begin");
        if (user) await session.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
        await session.query(`set local role ${role}`);
        return (await session.query("select public.owns_business($1) as owns", [business])).rows[0].owns;
      } finally { await session.query("rollback").catch(() => {}); await session.end(); }
    };
    assert.equal(await ask("authenticated", owner), true);
    assert.equal(await ask("authenticated", other), false);
    assert.equal(await ask("anon"), false);
  });
}

async function verifyScheduler(db, database) {
  const call = async (path) => (await db.query("select private.call_cron_route($1) as id", [path])).rows[0].id;
  await check(`${database}: without pg_cron no job is scheduled, and the helper is a no-op without Vault (#274)`, async () => {
    assert.equal((await db.query("select to_regnamespace('cron') as cron")).rows[0].cron, null);
    assert.equal(await call("/api/cron/enforce-spend"), null);
  });
  await check(`${database}: the scheduler helper calls only cron routes, with the Vault secret (#274)`, async () => {
    await db.query("begin");
    try {
      await db.query(`create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text);
        create schema net; create table net.calls(url text, headers jsonb, timeout int);
        create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
          returns bigint language sql as 'insert into net.calls values (url, headers, timeout_milliseconds) returning 7::bigint'`);
      assert.equal(await call("/api/cron/enforce-spend"), null);
      await db.query("insert into vault.decrypted_secrets values ('adbrain_cron_secret', 'fixture-cron-value')");
      assert.equal(await call("/api/cron/sync-leads"), "7");
      for (const path of ["/api/leads", "/api/cron/../leads", "https://example.invalid/api/cron/x"]) assert.equal(await call(path), null);
      assert.deepEqual((await db.query("select url, headers, timeout from net.calls")).rows,
        [{ url: "https://adbrain.vanshul.com/api/cron/sync-leads", headers: { Authorization: "Bearer fixture-cron-value" }, timeout: 70000 }]);
    } finally {
      await db.query("rollback");
    }
  });
  await check(`${database}: browser and service roles cannot call the scheduler helper (#274)`, async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const session = client(database);
      await session.connect();
      try {
        await session.query(`set role ${role}`);
        await assert.rejects(session.query("select private.call_cron_route('/api/cron/enforce-spend')"), { code: "42501" });
      } finally { await session.end(); }
    }
  });
}

async function verifyOperatorFunded(db, database) {
  const service = async (sql, values) => {
    const session = client(database);
    await session.connect();
    try { await session.query("set role service_role"); return (await session.query(sql, values)).rows[0]?.result; }
    finally { await session.end(); }
  };
  const business = async (name) => {
    const owner = randomUUID(), id = randomUUID(), campaign = randomUUID();
    await db.query("insert into auth.users(id) values ($1)", [owner]);
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,$3)", [id,owner,name]);
    await db.query("insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id,page_id) values ($1,1,'connected','act_123','123')", [id]);
    await db.query("insert into public.campaigns(id,business_id,status,daily_budget,meta_campaign_id,meta_ad_account_id,meta_page_id,meta_connection_generation) values ($1,$2,'paused',280,$3,'act_123','123',1)", [campaign,id,`meta_${campaign}`]);
    return { id, owner, activate: () => db.query("update public.campaigns set status='active' where id=$1", [campaign]) };
  };
  const operator = randomUUID(), stranger = randomUUID(), expired = randomUUID();
  await db.query("insert into auth.users(id) values ($1),($2),($3)", [operator,stranger,expired]);
  await db.query("insert into private.production_payment_operators(user_id,approval_reference,can_refund,expires_at) values ($1,$2,false,now()+interval '1 hour'),($3,$4,false,now()-interval '1 minute')",
    [operator,randomUUID(),expired,randomUUID()]);
  const set = (businessId, enabled, actor = operator, reason = "Owner funds this business on Meta (#245)") =>
    service("select public.operator_funding_set($1,$2,$3,$4) as result", [businessId,actor,enabled,reason]);
  const funded = (businessId) => service("select public.operator_funded($1) as result", [businessId]);
  await check(`${database}: an operator-funded business activates with no payment or reservation; a customer business still needs one (#245)`, async () => {
    const owned = await business("Synthetic operator-funded");
    const customer = await business("Synthetic customer");
    assert.deepEqual(await set(owned.id, true), { businessId: owned.id, operatorFunded: true });
    assert.equal(await funded(owned.id), true);
    assert.equal(await funded(customer.id), false);
    await owned.activate();
    await assert.rejects(customer.activate(), {code:'23514'});
  });
  await check(`${database}: only a live payment operator sets operator funding, with a reason; roles and tables stay closed (#245)`, async () => {
    const target = await business("Synthetic operator mark");
    for (const actor of [stranger, expired, target.owner]) await assert.rejects(set(target.id, true, actor), {code:'42501'});
    await assert.rejects(set(target.id, true, operator, "  "), {code:'23514'});
    await assert.rejects(set(randomUUID(), true), {code:'23514'});
    assert.equal(await funded(target.id), false);
    await assert.rejects(target.activate(), {code:'23514'});
    for (const role of ["anon","authenticated"]) {
      const session = client(database);
      await session.connect();
      try {
        await session.query(`set role ${role}`);
        await assert.rejects(session.query("select public.operator_funding_set($1,$2,true,'Self-service attempt')", [target.id,target.owner]), {code:'42501'});
        await assert.rejects(session.query("select public.operator_funded($1)", [target.id]), {code:'42501'});
      } finally { await session.end(); }
    }
    for (const table of ["operator_funded_businesses","operator_funding_audit"]) {
      await assert.rejects(service(`select count(*) as result from private.${table}`), {code:'42501'});
    }
  });
  await check(`${database}: setting and clearing operator funding is audited, and clearing restores the customer gate (#245)`, async () => {
    const target = await business("Synthetic audited mark");
    await set(target.id, true, operator, "Owner funds Solaride on Meta");
    await set(target.id, false, operator, "Back to the customer allowance");
    assert.equal(await funded(target.id), false);
    await assert.rejects(target.activate(), {code:'23514'});
    const audit = (await db.query("select actor_id, enabled, reason from private.operator_funding_audit where business_id=$1 order by created_at", [target.id])).rows;
    assert.deepEqual(audit, [
      { actor_id: operator, enabled: true, reason: "Owner funds Solaride on Meta" },
      { actor_id: operator, enabled: false, reason: "Back to the customer allowance" },
    ]);
  });
}

async function verifyCreativeGenerationAdmission(db, database) {
  const owner = randomUUID();
  const otherOwner = randomUUID();
  const business = randomUUID();
  const otherBusiness = randomUUID();
  await db.query("insert into auth.users(id,email) values ($1,'author@example.invalid'),($2,'other@example.invalid')", [owner,otherOwner]);
  await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Author'),($3,$4,'Other')", [business,owner,otherBusiness,otherOwner]);
  async function service(sql, values) {
    const session = client(database);
    await session.connect();
    try {
      await session.query("set role service_role");
      return (await session.query(sql,values)).rows[0]?.result;
    } finally { await session.end(); }
  }
  const admit=(id, tenant=business, user=owner, hash='a'.repeat(64), tokens=100, limit=150, imageFloor=10) =>
    service("select public.creative_generation_admit($1,$2,$3,$4,1,$5,$6,$7) as result",[tenant,user,id,hash,tokens,imageFloor,limit]);
  const status=(id, tenant=business, user=owner) =>
    service("select public.creative_generation_status($1,$2,$3) as result",[tenant,user,id]);
  await check(`${database}: generation admission migration is private and service-only`, async () => {
    const { rows } = await db.query(`select
      has_table_privilege('authenticated','private.creative_generation_intents','SELECT') as can_read,
      has_function_privilege('authenticated','public.creative_generation_admit(uuid,uuid,uuid,text,integer,bigint,bigint,bigint)','EXECUTE') as can_admit`);
    assert.deepEqual(rows, [{ can_read: false, can_admit: false }]);
  });
  await check(`${database}: concurrent identity claims admit one producer and reject rebinds`, async () => {
    const id=randomUUID();
    const results=await Promise.all([admit(id),admit(id)]);
    assert.deepEqual(results.map(result=>result.action).sort(),['recover','start']);
    assert.equal((await admit(id,business,owner,'b'.repeat(64))).action,'conflict');
    assert.equal((await admit(id,otherBusiness,otherOwner)).action,'missing');
    assert.equal((await status(id,otherBusiness,otherOwner)).status,'unknown');
    assert.equal((await status(randomUUID())).status,'unknown');
    assert.equal((await status(id)).status,'processing');
  });
  await check(`${database}: concurrent tenants cannot exceed the remaining quota`, async () => {
    const results=await Promise.all([admit(randomUUID(),otherBusiness,otherOwner),admit(randomUUID(),otherBusiness,otherOwner)]);
    assert.deepEqual(results.map(result=>result.action).sort(),['quota','start']);
  });
  await check(`${database}: an unknown recovery lookup fences a delayed producer`, async () => {
    const id=randomUUID();
    const freshBusiness=randomUUID();
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Delayed producer')",[freshBusiness,owner]);
    assert.equal((await status(id,freshBusiness,owner)).status,'unknown');
    assert.equal((await admit(id,freshBusiness,owner)).action,'missing');
    assert.equal((await status(id,freshBusiness,owner)).status,'unknown');
    const racedId=randomUUID();
    const [lookup,claim]=await Promise.all([status(racedId,freshBusiness,owner),admit(racedId,freshBusiness,owner)]);
    assert.deepEqual([lookup.status,claim.action].sort(),
      lookup.status==='unknown' ? ['missing','unknown'] : ['processing','start']);
  });
  await check(`${database}: verified usage releases only its accounted share`, async () => {
    const first=(await db.query("select generation_id from private.creative_generation_intents where business_id=$1",[business])).rows[0].generation_id;
    await db.query("insert into public.llm_usage_events(business_id,user_id,route,provider,model,total_tokens) values ($1,$2,'creatives.generate','fixture','fixture',40)",[business,owner]);
    const progress=await service("select public.creative_generation_progress($1,$2,$3,40,false,false,false) as result",[business,owner,first]);
    assert.equal(progress.status,'processing');
    assert.equal((await admit(randomUUID(),business,owner,'b'.repeat(64),51)).action,'quota');
    assert.equal((await admit(randomUUID(),business,owner,'b'.repeat(64),50)).action,'start');
    await db.query("insert into public.creatives(business_id,brief,variant_group) values ($1,'Fixture',$2)",[business,first]);
    assert.equal((await service("select public.creative_generation_progress($1,$2,$3,0,true,false,false) as result",[business,owner,first])).status,'complete');
    assert.equal((await admit(randomUUID(),business,owner,'c'.repeat(64),60)).action,'quota');
    assert.equal((await admit(randomUUID(),business,owner,'c'.repeat(64),50)).action,'start');
    assert.equal((await admit(first)).action,'recover');
  });
  await check(`${database}: timeout and uncertain provider outcome retain identity and hold`, async () => {
    const id=(await db.query("select generation_id from private.creative_generation_intents where business_id=$1 and state='processing' limit 1",[otherBusiness])).rows[0].generation_id;
    await db.query("update private.creative_generation_intents set updated_at=clock_timestamp()-interval '6 minutes' where generation_id=$1",[id]);
    assert.equal((await status(id,otherBusiness,otherOwner)).status,'unresolved');
    assert.equal((await admit(id,otherBusiness,otherOwner)).action,'recover');
    assert.equal((await service("select public.creative_generation_progress($1,$2,$3,0,false,true,false) as result",[otherBusiness,otherOwner,id])).status,'unresolved');
    assert.equal((await status(id,otherBusiness,otherOwner)).status,'unresolved');
  });
  await check(`${database}: only service operators can reconcile an evidenced unresolved intent`, async () => {
    const id=(await db.query("select generation_id from private.creative_generation_intents where business_id=$1 and state='unresolved' limit 1",[otherBusiness])).rows[0].generation_id;
    const procedure='public.creative_generation_reconcile(uuid,uuid,uuid,text,text,text,bigint,bigint,bigint)';
    const {rows}=await db.query(`select has_function_privilege('authenticated',$1,'EXECUTE') as can_reconcile,
      has_table_privilege('authenticated','private.creative_generation_reconciliations','SELECT') as can_read`,[procedure]);
    assert.deepEqual(rows,[{can_reconcile:false,can_read:false}]);
    const reconcile=(tenant,user,verified=40,accounted=0,reserved=100,evidence='case-verified-123',outcome='failed') =>
      service("select public.creative_generation_reconcile($1,$2,$3,$4,$5,$6,$7,$8,$9) as result",
        [tenant,user,id,'operator-fixture',evidence,outcome,verified,accounted,reserved]);
    await assert.rejects(reconcile(otherBusiness,owner),{code:'42501'});
    await assert.rejects(reconcile(otherBusiness,otherOwner,null),{code:'22023'});
    await assert.rejects(reconcile(otherBusiness,otherOwner,40,0,100,'private?token=secret'),{code:'22023'});
    await db.query("insert into public.llm_usage_events(business_id,user_id,route,provider,model,total_tokens,metadata) values ($1,$2,'creatives.generate','fixture','fixture',20,$3)",
      [otherBusiness,otherOwner,JSON.stringify({generationId:id,providerFinalStatus:'completed'})]);
    await assert.rejects(reconcile(otherBusiness,otherOwner,10),{code:'23514'});
    assert.equal((await status(id,otherBusiness,otherOwner)).status,'unresolved');
    assert.equal((await reconcile(otherBusiness,otherOwner)).status,'failed');
    assert.equal((await status(id,otherBusiness,otherOwner)).status,'failed');
    const {rows: after}=await db.query("select reserved_tokens,accounted_tokens from private.creative_generation_intents where generation_id=$1",[id]);
    assert.deepEqual(after.map(row=>({reserved:Number(row.reserved_tokens),accounted:Number(row.accounted_tokens)})),[{reserved:40,accounted:40}]);
    const {rows: audit}=await db.query("select count(*)::int as count from private.creative_generation_reconciliations where generation_id=$1",[id]);
    assert.equal(audit[0].count,1);
    const {rows: adjustment}=await db.query("select total_tokens from public.llm_usage_events where business_id=$1 and metadata->>'operatorAdjustment'='true'",[otherBusiness]);
    assert.deepEqual(adjustment.map(row=>row.total_tokens),[20]);
    await assert.rejects(service("insert into public.llm_usage_events(business_id,user_id,route,provider,model,total_tokens,metadata) values ($1,$2,'creatives.generate','late-provider','fixture',15,$3)",
      [otherBusiness,otherOwner,JSON.stringify({generationId:id,providerFinalStatus:'completed'})]),{code:'23514'});
    await assert.rejects(service("update public.llm_usage_events set metadata='{}'::jsonb where business_id=$1 and metadata->>'generationId'=$2",
      [otherBusiness,id]),{code:'23514'});
    await assert.rejects(service("delete from public.llm_usage_events where business_id=$1 and metadata->>'generationId'=$2",
      [otherBusiness,id]),{code:'23514'});
    assert.equal((await service("select public.creative_generation_progress($1,$2,$3,100,false,false,false) as result",[otherBusiness,otherOwner,id])).status,'failed');
    assert.deepEqual((await db.query("select reserved_tokens,accounted_tokens from private.creative_generation_intents where generation_id=$1",[id])).rows.map(row=>({reserved:Number(row.reserved_tokens),accounted:Number(row.accounted_tokens)})),[{reserved:40,accounted:40}]);
    await assert.rejects(reconcile(otherBusiness,otherOwner),{code:'23505'});
  });
  await check(`${database}: reconciled failure cannot gain a late saved creative`, async () => {
    const {rows}=await db.query("select generation_id from private.creative_generation_reconciliations where business_id=$1 and outcome='failed' limit 1",[otherBusiness]);
    assert.equal(rows.length,1);
    await assert.rejects(service("insert into public.creatives(business_id,brief,variant_group) values ($1,'Late saved',$2)",
      [otherBusiness,rows[0].generation_id]),{code:'23514'});
  });
  await check(`${database}: old intents remain held without generation-bound provider evidence`, async () => {
    const freshBusiness=randomUUID(),id=randomUUID();
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Legacy hold')",[freshBusiness,owner]);
    await db.query("insert into private.creative_generation_intents(generation_id,business_id,user_id,request_hash,expected_count,month_start,reserved_tokens,image_floor_tokens,state,receipt_version) values ($1,$2,$3,$4,1,date_trunc('month',now())::date,100,10,'unresolved',0)",
      [id,freshBusiness,owner,'e'.repeat(64)]);
    await assert.rejects(service("select public.creative_generation_reconcile($1,$2,$3,'operator-fixture','case-verified-123','failed',40,0,100) as result",[freshBusiness,owner,id]),{code:'23514'});
    assert.equal((await status(id,freshBusiness,owner)).status,'unresolved');
  });
  await check(`${database}: attested zero-charge failure releases an empty ledger without replay`, async () => {
    const freshBusiness=randomUUID(),id=randomUUID();
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'No-charge outcome')",[freshBusiness,owner]);
    assert.equal((await admit(id,freshBusiness,owner)).action,'start');
    assert.equal((await service("select public.creative_generation_progress($1,$2,$3,0,false,true,false) as result",[freshBusiness,owner,id])).status,'unresolved');
    assert.equal((await service("select public.creative_generation_reconcile($1,$2,$3,'operator-fixture','case-no-charge-123','failed',0,0,100) as result",
      [freshBusiness,owner,id])).status,'failed');
    assert.deepEqual((await db.query("select reserved_tokens,accounted_tokens from private.creative_generation_intents where generation_id=$1",[id])).rows.map(row=>({reserved:Number(row.reserved_tokens),accounted:Number(row.accounted_tokens)})),[{reserved:0,accounted:0}]);
    assert.equal((await admit(id,freshBusiness,owner)).action,'recover');
  });
  await check(`${database}: reconciled partial remains terminal through late callbacks`, async () => {
    const freshBusiness=randomUUID(),id=randomUUID();
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Partial reconciliation')",[freshBusiness,owner]);
    assert.equal((await service("select public.creative_generation_admit($1,$2,$3,$4,2,100,10,150) as result",
      [freshBusiness,owner,id,'f'.repeat(64)])).action,'start');
    await db.query("insert into public.creatives(business_id,brief,variant_group) values ($1,'One saved',$2)",[freshBusiness,id]);
    assert.equal((await service("select public.creative_generation_progress($1,$2,$3,0,false,true,false) as result",[freshBusiness,owner,id])).status,'unresolved');
    assert.equal((await service("select public.creative_generation_reconcile($1,$2,$3,'operator-fixture','case-partial-123','partial',30,0,100) as result",
      [freshBusiness,owner,id])).status,'partial');
    assert.equal((await service("select public.creative_generation_progress($1,$2,$3,40,true,false,false) as result",[freshBusiness,owner,id])).status,'partial');
    assert.equal((await status(id,freshBusiness,owner)).status,'partial');
    assert.equal((await admit(id,freshBusiness,owner,'f'.repeat(64))).action,'conflict');
    assert.deepEqual((await db.query("select reserved_tokens,accounted_tokens from private.creative_generation_intents where generation_id=$1",[id])).rows.map(row=>({reserved:Number(row.reserved_tokens),accounted:Number(row.accounted_tokens)})),[{reserved:40,accounted:30}]);
    assert.equal(await service("update public.creatives set headline='Edited' where business_id=$1 and variant_group=$2 returning 1 as result",[freshBusiness,id]),1);
    await assert.rejects(service("update public.creatives set variant_group=$3 where business_id=$1 and variant_group=$2",
      [freshBusiness,id,randomUUID()]),{code:'23514'});
  });
  await check(`${database}: known pre-provider failure frees unused quota but not identity`, async () => {
    const freshBusiness=randomUUID();
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'No provider call')",[freshBusiness,owner]);
    const id=randomUUID();
    assert.equal((await admit(id,freshBusiness,owner)).action,'start');
    assert.equal((await service("select public.creative_generation_progress($1,$2,$3,0,true,false,true) as result",[freshBusiness,owner,id])).status,'failed');
    assert.equal((await status(id,freshBusiness,owner)).status,'failed');
    assert.equal((await admit(id,freshBusiness,owner)).action,'recover');
    assert.equal((await admit(randomUUID(),freshBusiness,owner,'b'.repeat(64),150)).action,'start');
  });
  await check(`${database}: one failed angle cannot release another in-flight angle's quota`, async () => {
    const freshBusiness=randomUUID();
    const id=randomUUID();
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Parallel angles')",[freshBusiness,owner]);
    const first=await service("select public.creative_generation_admit($1,$2,$3,$4,2,100,10,150) as result",
      [freshBusiness,owner,id,'d'.repeat(64)]);
    assert.equal(first.action,'start');
    await service("select public.creative_generation_progress($1,$2,$3,0,false,false,true) as result",[freshBusiness,owner,id]);
    const second=await admit(randomUUID(),freshBusiness,owner,'e'.repeat(64),100);
    await db.query("insert into public.creatives(business_id,brief,variant_group) values ($1,'Still running',$2)",[freshBusiness,id]);
    const late=await service("select public.creative_generation_progress($1,$2,$3,0,false,false,false) as result",[freshBusiness,owner,id]);
    assert.deepEqual({ nextAdmission: second.action, lateProgress: late.status }, { nextAdmission: 'quota', lateProgress: 'partial' });
  });
  await check(`${database}: nine settled partial runs never lock a business out (#138)`, async () => {
    const freshBusiness=randomUUID();
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Partial runs')",[freshBusiness,owner]);
    // Production admission: 3 angles x (50k + 2 x 18k) reserved, 3 x 10k image floor, 2M monthly limit.
    const reserve=186_000,floor=30_000,limit=2_000_000,used=31_000;
    const admitRun=(id,hash)=>service("select public.creative_generation_admit($1,$2,$3,$4,3,$5,$6,$7) as result",
      [freshBusiness,owner,id,hash,reserve,floor,limit]);
    const hold=async (id)=>(await db.query("select reserved_tokens,accounted_tokens from private.creative_generation_intents where generation_id=$1",[id]))
      .rows.map(row=>({reserved:Number(row.reserved_tokens),accounted:Number(row.accounted_tokens)}))[0];
    // A run with unknown usage (like #54) keeps its whole hold.
    const unknown=randomUUID();
    assert.equal((await admitRun(unknown,'0'.repeat(64))).action,'start');
    assert.equal((await service("select public.creative_generation_progress($1,$2,$3,0,true,true,false) as result",[freshBusiness,owner,unknown])).status,'unresolved');
    for (let run=1;run<=9;run++) {
      const id=randomUUID();
      assert.equal((await admitRun(id,String(run).repeat(64))).action,'start',`run ${run}`);
      await db.query("insert into public.llm_usage_events(business_id,user_id,route,provider,model,total_tokens) values ($1,$2,'creatives.generate','fixture','fixture',$3)",[freshBusiness,owner,used]);
      await db.query("insert into public.creatives(business_id,brief,variant_group) values ($1,'One of three',$2)",[freshBusiness,id]);
      assert.equal((await service("select public.creative_generation_progress($1,$2,$3,$4,false,false,false) as result",[freshBusiness,owner,id,used])).status,'partial');
      assert.deepEqual(await hold(id),{reserved:reserve,accounted:used},'an in-flight run keeps its hold');
      assert.equal((await service("select public.creative_generation_progress($1,$2,$3,0,true,false,false) as result",[freshBusiness,owner,id])).status,'partial');
      assert.deepEqual(await hold(id),{reserved:used+floor/3,accounted:used},'a settled run keeps only its usage and saved image share');
    }
    assert.equal((await admitRun(randomUUID(),'a'.repeat(64))).action,'start');
    assert.deepEqual(await hold(unknown),{reserved:reserve,accounted:0});
  });
}

async function verify(database, source, integrityMigration, customerOnly = false) {
  const admin = client();
  await admin.connect();
  await admin.query(`create database ${database}`);
  await admin.end();
  const db = client(database);
  await db.connect();
  try {
    await db.query(bootstrap);
    await db.query(source);
    if (process.argv.includes("--analytics-only") || database.startsWith("analytics_")) {
      const installed = (await db.query("select to_regclass('public.product_event_daily') is not null as installed")).rows[0].installed;
      if (!installed) {
        await db.query("insert into public.product_events(event_id,request_id,version,kind,name,outcome) values(gen_random_uuid(),gen_random_uuid(),1,'system','analytics.before_migration','success')");
        await check(`${database}: upgrade preserves existing raw events and ledger replay`,async () => {
          assert.equal(await applyMigration(db,"20260928_product_event_rollups.sql",productRollupMigration),'applied');
          assert.equal(await applyMigration(db,"20260928_product_event_rollups.sql",productRollupMigration),'already_applied');
          assert.equal((await db.query("select count(*)::int as count from public.product_events where name='analytics.before_migration'")).rows[0].count,1);
        });
      }
      await verifyProductAnalytics(db,database);
      return;
    }
    if (process.argv.includes("--pricing-only") || database.startsWith("pricing_")) {
      const installed = (await db.query("select to_regprocedure('private.production_payment_quote(bigint,boolean)') is not null as installed")).rows[0].installed;
      if (!installed) {
        const owner = randomUUID(),business = randomUUID(),order = randomUUID();
        const policy = JSON.parse(operatorPaymentMigration.split("$policy$")[1]);
        await db.query("insert into auth.users(id) values ($1)",[owner]);
        await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Synthetic previous price')",[business,owner]);
        const value = { version:'inr-annual-total-v1',merchantDisplay:'Vanshul Goyal',currency:'INR',totalPaise:1000000,
          serviceAllocationPaise:200000,metaAllocationPaise:800000,additionalCustomerTaxPaise:0,
          metaTaxTreatment:'included-in-meta-allocation',gatewayFees:'absorbed-by-adbrain',automaticRenewal:false };
        await db.query("insert into private.production_payment_orders(id,business_id,user_id,request_key,account_id,key_id,quote,terms,terms_hash,provider_order_id,payment_id,captured_paise) values ($1,$2,$3,$4,'acc_upgrade','rzp_live_upgrade',$5,$6,$7,'order_upgrade','pay_upgrade',1000000)",[order,business,owner,randomUUID(),value,policy,'f'.repeat(64)]);
        const before = (await db.query("select to_jsonb(payment) as saved from private.production_payment_orders payment where id=$1",[order])).rows[0].saved;
        await check(`${database}: migration ledger applies once and safely skips replay`,async () => {
          assert.equal(await applyMigration(db,"20260927_configurable_payment_quotes.sql",configurablePaymentMigration),'applied');
          assert.equal(await applyMigration(db,"20260927_configurable_payment_quotes.sql",configurablePaymentMigration),'already_applied');
        });
        const after = (await db.query("select to_jsonb(payment)-'purpose' as saved from private.production_payment_orders payment where id=$1",[order])).rows[0].saved;
        await check(`${database}: existing accepted order is preserved by migration`,async () => assert.deepEqual(after,before));
      }
      if (!(await db.query("select to_regprocedure('public.production_payment_webhook_health(text)') is not null as installed")).rows[0].installed) {
        await check(`${database}: webhook health migration applies once and skips replay`,async () => {
          assert.equal(await applyMigration(db,"20261022_payment_webhook_health.sql",webhookHealthMigration),'applied');
          assert.equal(await applyMigration(db,"20261022_payment_webhook_health.sql",webhookHealthMigration),'already_applied');
        });
      }
      if (!(await db.query("select exists(select 1 from information_schema.columns where table_schema='private' and table_name='production_payment_orders' and column_name='superseded_at') as installed")).rows[0].installed) {
        await check(`${database}: custom payment amount migration applies once and skips replay`,async () => {
          assert.equal(await applyMigration(db,"20261023_custom_payment_amount.sql",customAmountMigration),'applied');
          assert.equal(await applyMigration(db,"20261023_custom_payment_amount.sql",customAmountMigration),'already_applied');
        });
      }
      if (!(await db.query("select to_regprocedure('private.production_payment_priced_policy_v2(jsonb,jsonb)') is not null as installed")).rows[0].installed) {
        await check(`${database}: payment terms v2 migration applies once and skips replay (#1235)`,async () => {
          assert.equal(await applyMigration(db,"20261028_payment_terms_v2.sql",paymentTermsV2Migration),'applied');
          assert.equal(await applyMigration(db,"20261028_payment_terms_v2.sql",paymentTermsV2Migration),'already_applied');
        });
      }
      await verifyConfigurablePayments(db,database);
      return;
    }
    if (process.argv.includes("--generation-only")) {
      await db.query(creativeIntentMigration);
      await db.query(creativeIntentMigration);
      await db.query(creativeReconcileMigration);
      await db.query(creativeReconcileMigration);
      await db.query(creativeSettleMigration);
      await db.query(creativeSettleMigration);
      await verifyCreativeGenerationAdmission(db, database);
      return;
    }
    await db.query(operatorPaymentMigration);
    await db.query(operatorPaymentMigration);
    if (customerOnly) {
      await db.query("drop function if exists public.customer_ad_reserve(uuid,uuid,text,uuid,text,bigint,bigint,text,boolean,bigint)");
      await db.query(customerAllowanceMigration);
      await db.query(customerAllowanceMigration);
      const priced = (await db.query("select exists(select 1 from information_schema.columns where table_schema='private' and table_name='production_payment_orders' and column_name='purpose') as installed")).rows[0].installed;
      if (!priced) await db.query(configurablePaymentMigration);
      await db.query(cappedBoundMigration);
      await db.query(cappedBoundMigration);
      await db.query(metaCostMigration);
      await db.query(metaCostMigration);
      await db.query(metaSettleMigration);
      await db.query(metaSettleMigration);
      await db.query(operatorFundedMigration);
      await db.query(operatorFundedMigration);
      await verifyCustomerAllowance(db,database);
      await verifyCappedRunBound(db,database);
      await verifyOperatorFunded(db,database);
      await db.query(schedulerMigration);
      await db.query(schedulerMigration);
      await verifyScheduler(db,database);
      await db.query(managedAccountsMigration);
      await db.query(managedAccountsMigration);
      await verifyManagedAccounts(db,database);
      await db.query(provisionLeaseMigration);
      await db.query(provisionLeaseMigration);
      await verifyProvisionLease(db,database);
      await verifyProvisioningWalk(db,database);
      await verifyManagedAccountsTenantQA(db,database);
      await db.query(managedSpendCapsMigration);
      await db.query(managedSpendCapsMigration);
      await verifyManagedSpendCaps(db,database);
      await db.query(managedWhatsAppMigration);
      await db.query(managedWhatsAppMigration);
      await verifyManagedWhatsAppPageLink(db,database);
      await db.query(whatsappBindingsMigration);
      await db.query(whatsappBindingsMigration);
      await verifyWhatsAppBindings(db,database);
      await db.query(learningsMigration);
      await db.query(learningsMigration);
      await verifyCampaignLearnings(db,database);
      await db.query(editOperationsMigration);
      await db.query(editOperationsMigration);
      await verifyCampaignEditOperations(db,database);
      await db.query(editAdCreativeMigration);
      await db.query(editAdCreativeMigration);
      await verifyEditAdCreativeKind(db,database);
      await db.query(adResultsMigration);
      await db.query(adResultsMigration);
      await verifyCampaignAdsAndResults(db,database);
      await db.query(ownerAlertsMigration);
      await db.query(ownerAlertsMigration);
      await verifyOwnerWhatsAppAlerts(db,database);
      await db.query(ownerAlertSendsMigration);
      await db.query(ownerAlertSendsMigration);
      await verifyOwnerAlertSends(db,database);
      await db.query(planPeriodsMigration);
      await db.query(planPeriodsMigration);
      await verifyPlanPeriods(db,database);
      await db.query(leadCustomerMigration);
      await db.query(leadCustomerMigration);
      if ((await db.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='workflow_status') as installed")).rows[0].installed) {
        await verifyLeadCustomerStatus(db,database);
        await db.query(leadFirstContactedMigration);
        await db.query(leadFirstContactedMigration);
        await verifyLeadFirstContacted(db,database);
      }
      await db.query(tokenSearchPathMigration);
      await db.query(tokenSearchPathMigration);
      await verifyTokenSearchPath(db,database);
      await verifyMetaTokenPurge(db,database);
      await verifyMetaRevocationTarget(db,database);
      await db.query(whatsappTemplateMigration);
      await db.query(whatsappTemplateMigration);
      await verifyWhatsAppTemplate(db,database);
      if ((await db.query("select to_regclass('public.privacy_requests') is not null as installed")).rows[0].installed) {
        await db.query(metaDeletionMigration);
        await db.query(metaDeletionMigration);
        await verifyMetaDeletionRequests(db,database);
      }
      await db.query(hardeningMigration);
      await db.query(hardeningMigration);
      await verifyLegacyCredentialsAndBuckets(db,database);
      await db.query(reauthMigration);
      await db.query(reauthMigration);
      await verifyConnectionReauth(db,database);
      if ((await db.query("select to_regclass('public.lead_sync_runs') is not null as installed")).rows[0].installed) {
        await db.query(leadCampaignLinkMigration);
        await db.query(leadCampaignLinkMigration);
        await db.query(leadSharedPageMigration);
        await db.query(leadSharedPageMigration);
        // #1761 (QA): the erase migration redefines the checkpoint last, so every check below runs on the final function.
        await db.query(leadEraseMigration);
        await db.query(leadEraseMigration);
        await verifyLeadCampaignLink(db,database);
        await verifySharedPageLeads(db,database);
        await verifyLeadErase(db,database);
      }
      if (database === "customer_fresh") await verifyAdvisorHardening(db,database);
      await verifyBusinessTransfer(db,database);
      await verifyMetaThrottle(db,database);
      return;
    }
    if (integrityMigration) {
      await check(`${database}: invalid legacy evidence is preserved and blocks validation`, async () => {
        await db.query("begin");
        try {
          const owner = randomUUID();
          const business = randomUUID();
          const foreignBusiness = randomUUID();
          const campaign = randomUUID();
          await db.query("insert into auth.users(id) values ($1)", [owner]);
          await db.query("insert into public.businesses(id,owner_id,name) values ($1,$3,'Legacy'),($2,$3,'Foreign')", [business,foreignBusiness,owner]);
          await db.query("insert into public.campaigns(id,business_id,daily_budget) values ($1,$2,-1)", [campaign,business]);
          await db.query("insert into public.campaign_results(campaign_id,spend) values ($1,-1)", [campaign]);
          await db.query("insert into public.leads(business_id,campaign_id,meta_lead_id) values ($1,$2,'legacy-cross-business')", [foreignBusiness,campaign]);
          await db.query(integrityMigration);
          for (const [table, constraint, code] of [
            ["campaigns", "campaigns_budget_finite_nonnegative", "23514"],
            ["campaign_results", "campaign_results_costs_finite_nonnegative", "23514"],
            ["leads", "leads_same_business_campaign", "23503"],
          ]) {
            await db.query("savepoint validation");
            await assert.rejects(db.query(`alter table public.${table} validate constraint ${constraint}`), { code });
            await db.query("rollback to savepoint validation");
          }
          assert.equal(Number((await db.query("select spend from public.campaign_results where campaign_id=$1", [campaign])).rows[0].spend), -1);
          assert.equal((await db.query("select campaign_id from public.leads where meta_lead_id='legacy-cross-business'")).rows[0].campaign_id, campaign);
        } finally { await db.query("rollback"); }
      });
      await db.query(integrityMigration);
    }
    console.log(`PASS ${database}: schema executes`);
    if (database === "ordered_upgrade") {
      await check("ordered_upgrade: existing enquiry receives follow-up defaults", async () => {
        const { rows } = await db.query("select workflow_status, follow_up_note, full_name from public.leads where meta_lead_id='legacy-follow-up'");
        assert.deepEqual(rows, [{ workflow_status: "new", follow_up_note: "", full_name: "Legacy enquiry" }]);
      });
    }
    await check(`${database}: reporting identity is explicit and migration history is immutable`, async () => {
      const columns = await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='campaign_results' and column_name in ('destination', 'period_start', 'period_end') order by column_name");
      assert.deepEqual(columns.rows.map(row => row.column_name), ["destination", "period_end", "period_start"]);
      const name = "20260919_ledger_test.sql";
      assert.equal(await applyMigration(db, name, "select 1"), "applied");
      assert.equal(await applyMigration(db, name, "select 1"), "already_applied");
      await assert.rejects(applyMigration(db, name, "select 2"), /checksum changed/);
      await assert.rejects(applyMigration(db, "20260919_failure_test.sql", "select missing_column"));
      const failed = await db.query("select count(*)::int as total from private.schema_migrations where name = '20260919_failure_test.sql'");
      assert.equal(failed.rows[0].total, 0);
    });
    await check(`${database}: nullable WhatsApp result fields and nonnegative checks exist`, async () => {
      const { rows } = await db.query("select column_name, is_nullable from information_schema.columns where table_schema='public' and table_name='campaign_results' and column_name in ('conversations', 'cost_per_conversation') order by column_name");
      assert.deepEqual(rows, [{ column_name: "conversations", is_nullable: "YES" }, { column_name: "cost_per_conversation", is_nullable: "YES" }]);
      const checks = await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.campaign_results'::regclass and contype='c'");
      assert.ok(checks.rows.some(row => /conversations >= 0/.test(row.definition)));
      assert.ok(checks.rows.some(row => /cost_per_conversation >=/.test(row.definition)));
    });
    if (database === "ordered_upgrade") {
      await check("ordered_upgrade: legacy OAuth privileges and owner policy survive", async () => {
        const { rows } = await db.query(`select
          has_table_privilege('authenticated', 'public.meta_credentials', 'SELECT,INSERT,UPDATE,DELETE') as allowed,
          exists(select 1 from pg_policies where schemaname = 'public'
            and tablename = 'meta_credentials' and policyname = 'meta_credentials: all own') as owner_policy`);
        assert.equal(rows[0].allowed, true);
        assert.equal(rows[0].owner_policy, true);
      });
    }
    const ownerId = randomUUID();
    const businessId = randomUUID();
    const draftId = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, 'db-test@example.invalid')", [ownerId]);
    await db.query("insert into public.businesses (id, owner_id, name) values ($1, $2, 'Isolated DB test')", [businessId, ownerId]);
    await db.query("insert into public.campaign_drafts (id, business_id, owner_id, input, expires_at) values ($1, $2, $3, '{}', now() + interval '1 day')", [draftId, businessId, ownerId]);
    await db.query("insert into public.meta_connections (business_id, generation, authorization_status) values ($1, 1, 'connected')", [businessId]);

    const otherOwnerId = randomUUID();
    const otherBusinessId = randomUUID();
    const campaignId = randomUUID();
    const otherCampaignId = randomUUID();
    await db.query("insert into auth.users(id) values ($1)", [otherOwnerId]);
    await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Other fixture')", [otherBusinessId, otherOwnerId]);
    await db.query("insert into public.campaigns(id,business_id,daily_budget) values ($1,$2,200),($3,$4,200)", [campaignId, businessId, otherCampaignId, otherBusinessId]);
    for (const [label, sql, parameters, code] of [
      ["DB-01 owner cannot forge campaign state", "update public.campaigns set status='active', daily_budget=1, meta_campaign_id='forged' where id=$1", [campaignId], "42501"],
      ["DB-01 owner cannot forge results", "insert into public.campaign_results(campaign_id,spend) values ($1,1)", [campaignId], "42501"],
      ["DB-02 negative and reversed results reject", "insert into public.campaign_results(campaign_id,spend,impressions,period_start,period_end) values ($1,-1,-1,'2026-09-26','2026-09-01')", [campaignId], "23514"],
      ["DB-03 lead campaign belongs to same business", "insert into public.leads(business_id,campaign_id,meta_lead_id) values ($1,$2,'cross-business')", [businessId, otherCampaignId], "23503"],
      ["DB-04 owner cannot forge draft version or expiry", "update public.campaign_drafts set version=999, expires_at=now()+interval '100 days' where id=$1", [draftId], "42501"],
      ["DB-05 owner cannot spoof audit actor", "insert into public.audit_log(business_id,actor_id,action,entity_type) values ($1,$2,'campaign.activate','campaign')", [businessId, otherOwnerId], "42501"],
      ["DB-02 zero weekly cap rejects", "insert into public.spend_limits(business_id,weekly_cap_rupees,auto_pause) values ($1,0,true)", [businessId], "23514"],
    ]) {
      await check(`${database}: ${label}`, async () => {
        const session = client(database);
        await session.connect();
        try {
          await session.query("begin");
          if (!label.startsWith("DB-02 negative")) {
            await session.query("set local role authenticated");
            await session.query("select set_config('request.jwt.claim.sub',$1,true)", [ownerId]);
          }
          await assert.rejects(session.query(sql, parameters), { code });
        } finally {
          await session.query("rollback");
          await session.end();
        }
      });
    }

    await check(`${database}: DB-335 owners log WhatsApp enquiries without a Meta lead ID, only for their own business`, async () => {
      const installed = (await db.query("select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='leads' and column_name='source'")).rows[0].n === 1;
      if (!installed) {
        // Upgrade path: existing Meta form leads stay valid and become source 'meta_form'.
        assert.ok(!database.includes("fresh"), "A fresh schema must include the manual enquiry migration");
        await db.query("insert into public.leads(business_id,meta_lead_id) values ($1,'before-335')", [businessId]);
        assert.equal(await applyMigration(db, "20261024_manual_whatsapp_enquiries.sql", manualEnquiryMigration), "applied");
        assert.deepEqual((await db.query("select source from public.leads where meta_lead_id='before-335'")).rows, [{ source: "meta_form" }]);
        await db.query("delete from public.leads where meta_lead_id='before-335'");
      }
      const session = client(database);
      await session.connect();
      try {
        await session.query("begin");
        await session.query("set local role authenticated");
        await session.query("select set_config('request.jwt.claim.sub',$1,true)", [ownerId]);
        const manual = "insert into public.leads(business_id,campaign_id,source,full_name,created_time) values ($1,$2,'whatsapp_manual',$3,now()) returning meta_lead_id";
        assert.deepEqual((await session.query(manual, [businessId, campaignId, "First chat"])).rows, [{ meta_lead_id: null }]);
        assert.equal((await session.query(manual, [businessId, campaignId, "Second chat"])).rowCount, 1);
        assert.equal((await session.query("select count(*)::int as n from public.leads where campaign_id=$1 and source='whatsapp_manual'", [campaignId])).rows[0].n, 2);
        await session.query("savepoint other");
        await assert.rejects(session.query(manual, [otherBusinessId, otherCampaignId, "Not yours"]), { code: "42501" });
        await session.query("rollback to savepoint other");
        await assert.rejects(session.query("insert into public.leads(business_id,source,meta_lead_id) values ($1,'whatsapp_manual','forged')", [businessId]), { code: "23514" });
        await session.query("rollback to savepoint other");
        await assert.rejects(session.query("insert into public.leads(business_id) values ($1)", [businessId]), { code: "23514" });
        await session.query("rollback to savepoint other");
        await assert.rejects(session.query("insert into public.leads(business_id,source) values ($1,'sms')", [businessId]), { code: "23514" });
      } finally {
        await session.query("rollback");
        await session.end();
      }
    });

    await check(`${database}: DB-A independent numeric bounds and relationship delete semantics`, async () => {
      for (const values of ["impressions=-1", "clicks=-1", "leads=9007199254740992", "conversations=9007199254740992",
        "spend='NaN'", "cpl='NaN'", "cost_per_conversation='NaN'", "cpl=-1",
        "period_start='2026-09-26',period_end='2026-09-01'", "period_start='2026-09-26'", "fetched_at='infinity'"]) {
        await db.query("begin");
        try {
          const result = await db.query("insert into public.campaign_results(campaign_id) values ($1) returning id", [campaignId]);
          await assert.rejects(db.query(`update public.campaign_results set ${values} where id=$1`, [result.rows[0].id]), { code: "23514" });
        } finally { await db.query("rollback"); }
      }
      await db.query("begin");
      try {
        await db.query("insert into public.leads(business_id,campaign_id,meta_lead_id) values ($1,$2,'owned-delete')", [businessId,campaignId]);
        await db.query("delete from public.campaigns where id=$1", [campaignId]);
        const lead = (await db.query("select business_id,campaign_id from public.leads where meta_lead_id='owned-delete'")).rows[0];
        assert.deepEqual(lead, { business_id: businessId, campaign_id: null });
      } finally { await db.query("rollback"); }
    });

    await check(`${database}: DB-A draft insertion and clocks are server assigned`, async () => {
      const session = client(database);
      await session.connect();
      try {
        await session.query("begin");
        await session.query("set local role authenticated");
        await session.query("select set_config('request.jwt.claim.sub',$1,true)", [ownerId]);
        const row = (await session.query(`insert into public.campaign_drafts(business_id,owner_id,input,version,expires_at)
          values ($1,$2,'{}',999,now()+interval '100 days') returning *, expires_at = now()+interval '7 days' as bounded`, [businessId,ownerId])).rows[0];
        assert.equal(Number(row.version), 1);
        assert.equal(row.bounded, true);
        const updated = (await session.query("select * from public.update_campaign_draft_if_version($1,$2,$3,1,'{}','2000-01-01')", [row.id,businessId,ownerId])).rows[0];
        assert.equal(Number(updated.version), 2);
        assert.equal(updated.updated_at.getTime(), row.created_at.getTime());
        assert.equal((await session.query("select * from public.delete_campaign_draft_if_version($1,1)", [row.id])).rowCount, 0);
        assert.equal((await session.query("select * from public.delete_campaign_draft_if_version($1,2)", [row.id])).rowCount, 1);
        await session.query("reset role");
        const expiredId = randomUUID();
        await session.query("insert into public.campaign_drafts(id,business_id,owner_id,input,expires_at) values ($1,$2,$3,'{}','2001-01-01')", [expiredId,businessId,ownerId]);
        await session.query("set local role authenticated");
        assert.equal((await session.query("select * from public.update_campaign_draft_if_version($1,$2,$3,1,'{}','2000-01-01')", [expiredId,businessId,ownerId])).rowCount, 0);
        await session.query("select set_config('request.jwt.claim.sub',$1,true)", [otherOwnerId]);
        await assert.rejects(session.query("select * from public.update_campaign_draft_if_version($1,$2,$3,1,'{}')", [draftId,businessId,ownerId]), { code: "42501" });
      } finally { await session.query("rollback"); await session.end(); }
    });

    await check(`${database}: enquiry paging, follow-up persistence and tenant isolation`, async () => {
      await db.query(`insert into public.leads (business_id, meta_lead_id, full_name, phone, created_time)
        select $1, 'inbox-' || number, case when number > 220 then null else 'Enquiry ' || lpad(number::text, 3, '0') end,
          case when number % 2 = 0 then '+910000000000' else '  ' end,
          case when number > 210 then null else '2026-09-01'::timestamptz + (number % 3) * interval '1 day' + (number % 2) * interval '1 microsecond' end
        from generate_series(1, 225) number`, [businessId]);
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role authenticated");
        await session.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
        const page = async (sort = 'newest', after = null, query = '', status = 'all', contact = 'all') =>
          (await session.query("select public.get_lead_page($1,$2,$3,$4,$5,50,$6,$7,$8) as page",
            [businessId, query, status, contact, sort, after?.id ?? null, after?.key ?? '', after?.missing ?? false])).rows[0].page;
        for (const sort of ['newest', 'oldest', 'name']) {
          const seen = [];
          let cursor = null;
          for (let batch = 0; batch < 6; batch++) {
            const result = await page(sort, cursor);
            assert.equal(result.total, 225);
            assert.ok(result.leads.length <= 50);
            seen.push(...result.leads);
            cursor = result.nextCursor;
            if (!cursor) break;
          }
          assert.equal(cursor, null);
          assert.equal(seen.length, 225);
          assert.equal(new Set(seen.map(lead => lead.id)).size, 225);
          const ordering = sort === 'name' ? 'lower(full_name) collate "C" asc nulls last'
            : `created_time ${sort === 'newest' ? 'desc' : 'asc'} nulls last`;
          const expected = await db.query(`select id from public.leads where business_id=$1 order by ${ordering}, id`, [businessId]);
          assert.deepEqual(seen.map(lead => lead.id), expected.rows.map(lead => lead.id));
          assert.equal(sort === 'name' ? seen.at(-1).full_name : seen.at(-1).created_time, null);
          assert.ok(seen.every(lead => lead.workflow_status === 'new' && lead.follow_up_note === ''));
        }
        const found = await page('newest', null, 'Enquiry 219');
        assert.equal(found.total, 1);
        const leadId = found.leads[0].id;
        await session.query("update public.leads set workflow_status='booked', follow_up_note='Synthetic follow-up' where id=$1", [leadId]);
        await session.query(`insert into public.leads (business_id, meta_lead_id, full_name) values ($1, 'inbox-219', 'Enquiry 219')
          on conflict (business_id, meta_lead_id) do update set full_name=excluded.full_name`, [businessId]);
        const booked = await page('newest', null, '', 'booked');
        assert.equal(booked.total, 1);
        assert.equal(booked.leads[0].follow_up_note, 'Synthetic follow-up');
        assert.equal((await page('newest', null, '', 'all', 'ready')).total, 112);
        assert.equal((await page('newest', null, '', 'all', 'missing')).total, 113);
        await assert.rejects(session.query("update public.leads set follow_up_note=repeat('x',2001) where id=$1", [leadId]), { code: '23514' });
        await assert.rejects(session.query("update public.leads set workflow_status='invalid' where id=$1", [leadId]), { code: '23514' });
        await session.query("select set_config('request.jwt.claim.sub', $1, false)", [randomUUID()]);
        await assert.rejects(page(), { code: '42501' });
        assert.equal((await session.query("update public.leads set follow_up_note='foreign' where id=$1 returning id", [leadId])).rowCount, 0);
        assert.equal((await session.query("select id from public.leads where business_id=$1", [businessId])).rowCount, 0);
        await session.query("set role anon");
        await assert.rejects(page(), { code: '42501' });
      } finally {
        await session.end();
      }
    });
    await check(`${database}: DB-A read isolation, delete denial and authentic audit identity`, async () => {
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role authenticated");
        await session.query("select set_config('request.jwt.claim.sub',$1,false)", [ownerId]);
        assert.equal((await session.query("select id from public.campaigns where id=$1", [campaignId])).rowCount, 1);
        assert.equal((await session.query("select id from public.campaigns where id=$1", [otherCampaignId])).rowCount, 0);
        for (const table of ["campaigns", "campaign_results", "audit_log", "campaign_drafts", "businesses"]) {
          await assert.rejects(session.query(`delete from public.${table}`), { code: "42501" });
        }
        const append = actor => session.query("select public.append_verified_audit_event($1,$2,'campaign.pause','campaign') as id", [businessId, actor]);
        await assert.rejects(append(ownerId), { code: "42501" });
        await session.query("set role anon");
        await assert.rejects(append(ownerId), { code: "42501" });
        await session.query("set role service_role");
        await assert.rejects(append(otherOwnerId), { code: "42501" });
        await assert.rejects(append(null), { code: "23514" });
        const eventId = (await append(ownerId)).rows[0].id;
        const event = (await session.query("select * from public.audit_log where id=$1", [eventId])).rows[0];
        assert.equal(event.actor_id, ownerId);
        assert.equal(event.actor_label, "db-test@example.invalid");
        assert.equal(event.authority, "server");
        for (const mutation of ["delete from public.audit_log", "update public.audit_log set action='forged'",
          "insert into public.audit_log(action,entity_type) values ('forged','campaign')"]) {
          await assert.rejects(session.query(mutation), { code: "42501" });
        }
      } finally { await session.end(); }
    });

    await check(`${database}: Razorpay test orders isolate owners and claim once under concurrency`, async () => {
      const requestKey = randomUUID();
      const claim = async (userId, key = "rzp_test_fixture") => {
        const session = client(database);
        await session.connect();
        try {
          await session.query("set role service_role");
          return (await session.query("select public.razorpay_test_order_claim($1,$2,$3,$4,$5,$6) as result",
            [businessId,userId,requestKey,randomUUID(),"acc_fixture",key])).rows[0].result;
        } finally { await session.end(); }
      };
      await assert.rejects(claim(randomUUID()), { code: "23514" });
      await assert.rejects(claim(ownerId, "rzp_live_fixture"), { code: "23514" });
      const claims = await Promise.all(Array.from({ length: 4 }, () => claim(ownerId)));
      assert.equal(claims.filter(result => result.claimed).length, 1);
      assert.equal(new Set(claims.map(result => result.order.id)).size, 1);
      const order = claims[0].order;
      assert.equal(order.amount_paise, 1000000);
      assert.equal(order.environment, "test");
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role service_role");
        await assert.rejects(session.query("select * from private.razorpay_test_orders"), { code: "42501" });
        const get = async userId => (await session.query("select public.razorpay_test_order_get($1,$2) as result", [order.id,userId])).rows[0].result;
        assert.equal(await get(randomUUID()), null);
        await session.query("select public.razorpay_test_order_result($1,'order_fixture')", [order.id]);
        const observe = async (event, hash, outcome, payment = "pay_fixture") => (await session.query(
          "select public.razorpay_test_order_observe($1,'acc_fixture','rzp_test_fixture',$2,$3,$4,$5) as result",
          [order.id,event,hash,payment,outcome])).rows[0].result;
        assert.equal((await observe("event_1","a".repeat(64),"captured")).state,"captured");
        assert.equal((await observe("event_1","a".repeat(64),"captured")).state,"captured");
        assert.equal((await observe("event_2","b".repeat(64),"pending")).state,"captured");
        assert.equal((await observe("event_1","c".repeat(64),"captured")).state,"needs_reconciliation");
        assert.equal((await observe("event_3","d".repeat(64),"captured")).state,"needs_reconciliation");
        assert.equal((await get(ownerId)).payment_id,"pay_fixture");
        await session.query("set role authenticated");
        await assert.rejects(get(ownerId), { code: "42501" });
        await assert.rejects(session.query("select public.razorpay_test_order_result($1,null)", [order.id]), { code: "42501" });
        await session.query("set role anon");
        await assert.rejects(get(ownerId), { code: "42501" });
      } finally { await session.end(); }
      assert.equal((await db.query("select count(*)::int as count from private.razorpay_test_events where order_id=$1 and event_id='event_1'",[order.id])).rows[0].count,1);
    });
    await check(`${database}: lead sync checkpoints preserve owner follow-up and reject foreign/stale bindings`, async () => {
      await db.query("update public.meta_connections set ad_account_id='act_sync', page_id='page_sync' where business_id=$1", [businessId]);
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role service_role");
        const start = async (owner = ownerId, sync = null, generation = 1) => (await session.query(
          "select * from public.lead_sync_start($1,$2,$3,$4,'act_sync','page_sync')", [businessId, owner, sync, generation])).rows[0];
        const run = await start();
        assert.equal((await start()).id, run.id);
        const save = async (version, rows, progress = run.progress) => (await session.query(
          "select public.lead_sync_checkpoint($1,$2,$3,1,'act_sync','page_sync',$4,$5,$6) as saved",
          [businessId, ownerId, run.id, version, JSON.stringify(rows), JSON.stringify(progress)])).rows[0].saved;
        const first = await save(0, [{ meta_lead_id: 'sync-lead', full_name: 'Original', form_id: 'form-original',
          form_name: 'Original form', phone: '+910000000000', email: 'synthetic@example.invalid', city: 'Jaipur',
          field_data: { synthetic: true }, created_time: '2026-09-01T00:00:00.000001Z' }]);
        assert.equal(first.imported, 1);
        assert.equal(first.run.version, 1);
        await db.query("update public.leads set campaign_id=$1 where business_id=$2 and meta_lead_id='sync-lead'", [campaignId, businessId]);
        await session.query("set role authenticated");
        await session.query("select set_config('request.jwt.claim.sub',$1,false)", [ownerId]);
        const confirmed = (await session.query("update public.leads set workflow_status='qualified', follow_up_note='Synthetic saved note' where business_id=$1 and meta_lead_id='sync-lead' returning *", [businessId])).rows[0];
        assert.equal(confirmed.workflow_status, 'qualified');
        const viewedAt = (await session.query("select clock_timestamp()::text as viewed_at")).rows[0].viewed_at;
        await session.query("set role service_role");
        await assert.rejects(save(0, [{ meta_lead_id: 'stale-lead' }]), { code: '40001' });
        const duplicate = await save(1, [{ meta_lead_id: 'sync-lead', full_name: 'Overwrite', form_id: 'changed-form',
          phone: '+919999999999', email: 'changed@example.invalid', city: 'Changed', field_data: {},
          created_time: '2026-09-02T00:00:00Z', workflow_status: 'new', follow_up_note: '' }]);
        assert.equal(duplicate.imported, 0);
        assert.deepEqual((await session.query("select * from public.leads where business_id=$1 and meta_lead_id='sync-lead'", [businessId])).rows[0], confirmed);
        await session.query("set role authenticated");
        const filtered = (await session.query("select public.get_lead_page($1,'Original','qualified') as page", [businessId])).rows[0].page;
        assert.equal(filtered.total, 1);
        assert.equal(filtered.leads[0].id, confirmed.id);
        assert.equal(filtered.leads[0].follow_up_note, 'Synthetic saved note');
        assert.equal(filtered.leads[0].campaign_id, campaignId);
        await session.query("set role service_role");
        await assert.rejects(save(2, [{ meta_lead_id: 'rolled-back' }, { meta_lead_id: null }]));
        assert.equal(Number((await start(ownerId, run.id)).version), 2);
        assert.equal((await session.query("select count(*)::int as count from public.leads where meta_lead_id in ('rolled-back','stale-lead')")).rows[0].count, 0);
        const competing = client(database);
        await competing.connect();
        try {
          await competing.query("set role service_role");
          const attempts = await Promise.allSettled([
            save(2, [{ meta_lead_id: 'race-first' }]),
            competing.query("select public.lead_sync_checkpoint($1,$2,$3,1,'act_sync','page_sync',2,$4,$5)",
              [businessId, ownerId, run.id, JSON.stringify([{ meta_lead_id: 'race-second' }]), JSON.stringify(run.progress)]),
          ]);
          assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1);
          assert.equal(attempts.find(attempt => attempt.status === 'rejected').reason.code, '40001');
        } finally { await competing.end(); }
        const completed = await save(3, [], { ...run.progress, formsDone: true });
        assert.equal(completed.run.state, 'complete');
        const nextRun = await start();
        assert.notEqual(nextRun.id, run.id);
        const late = (await session.query(
          "select public.lead_sync_checkpoint($1,$2,$3,1,'act_sync','page_sync',0,$4,$5) as saved",
          [businessId, ownerId, nextRun.id, JSON.stringify([
            { meta_lead_id: 'sync-lead', full_name: 'Overwrite', form_id: 'form-original' },
            { meta_lead_id: 'late-lead', full_name: 'Late arrival', form_id: 'form-original',
              created_time: '2026-08-31T00:00:00Z' },
          ]), JSON.stringify({ ...nextRun.progress, formsDone: true })])).rows[0].saved;
        assert.equal(late.imported, 1);
        assert.equal(late.run.state, 'complete');
        assert.equal((await session.query("select workflow_status,follow_up_note from public.leads where business_id=$1 and meta_lead_id='sync-lead'", [businessId])).rows[0].follow_up_note, 'Synthetic saved note');
        await session.query("set role authenticated");
        const unseen = (await session.query("select count(*)::int as count from public.leads where business_id=$1 and created_at > $2 and meta_lead_id in ('sync-lead','late-lead')", [businessId, viewedAt])).rows[0].count;
        assert.equal(unseen, 1);
        await session.query("select set_config('request.jwt.claim.sub',$1,false)", [otherOwnerId]);
        await assert.rejects(session.query("select public.get_lead_page($1) as page", [businessId]), { code: '42501' });
        assert.equal((await session.query("select id from public.leads where business_id=$1", [businessId])).rowCount, 0);
        assert.equal((await session.query("update public.leads set follow_up_note='foreign' where id=$1 returning id", [confirmed.id])).rowCount, 0);
        await session.query("set role service_role");
        await assert.rejects(start(otherOwnerId, nextRun.id), { code: '42501' });
        const otherBusinessId = randomUUID();
        await db.query("insert into public.businesses(id, owner_id, name) values ($1,$2,'Other synthetic business')", [otherBusinessId, ownerId]);
        await db.query("insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id,page_id) values ($1,1,'connected','act_sync','page_sync')", [otherBusinessId]);
        await assert.rejects(session.query("select * from public.lead_sync_start($1,$2,$3,1,'act_sync','page_sync')", [otherBusinessId, ownerId, run.id]), { code: 'P0002' });
        await assert.rejects(start(randomUUID(), run.id), { code: '42501' });
        await assert.rejects(start(ownerId, randomUUID()), { code: 'P0002' });
        await db.query("update public.meta_connections set generation=2 where business_id=$1", [businessId]);
        await assert.rejects(start(ownerId, run.id, 2), { code: '40001' });
        await session.query("set role authenticated");
        await assert.rejects(start(), { code: '42501' });
        await assert.rejects(session.query("select * from public.lead_sync_runs"), { code: '42501' });
      } finally {
        await session.end();
        await db.query("update public.meta_connections set generation=1, ad_account_id=null, page_id=null where business_id=$1", [businessId]);
      }
    });
  if (process.argv.includes("--leads-only")) return;

    await check(`${database}: production payment claims and financial effects survive competing clients and restart recovery`, async () => {
      const payerBusinessId = randomUUID();
      const evidenceId = randomUUID();
      const profileId = randomUUID();
      const requestKey = randomUUID();
      const webhookId = randomUUID();
      const quote = { version: "inr-annual-total-v1", merchantDisplay: "Vanshul Goyal", currency: "INR", totalPaise: 1000000,
        serviceAllocationPaise: 200000, metaAllocationPaise: 800000, additionalCustomerTaxPaise: 0,
        metaTaxTreatment: "included-in-meta-allocation", gatewayFees: "absorbed-by-adbrain", automaticRenewal: false };
      const policy = { version: "synthetic-policy-v1", approvalReference: randomUUID(), automaticFundingApprovalReference: randomUUID(),
        approvedAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
        serviceScope: "Synthetic finite scope", invoiceTerms: "Synthetic invoice policy", refundTerms: "Synthetic refund policy" };
      const terms = JSON.stringify(policy);
      const termsHash = createHash("sha256").update(terms).digest("hex");
      const funding = { version: 1, businessId: payerBusinessId, environment: "live", connectionGeneration: 1, evidenceId,
        verifiedAt: policy.approvedAt, expiresAt: policy.expiresAt, revokedAt: null,
        setup: { method: "recurring_card", accountId: "act_4567891", expectedOwnerBusinessId: "456", ownerBusinessId: "456",
          currency: "INR", country: "IN", accountActive: true, billingMode: "automatic", paymentMethod: "verified",
          recurringAuthorisation: "verified", spendControls: "verified", ownerAcceptedMetaInitiatedPayments: true } };
      await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Synthetic payments fixture')", [payerBusinessId,ownerId]);
      await db.query("insert into public.meta_connections(business_id,generation,authorization_status,ad_account_id) values ($1,1,'connected','act_4567891')", [payerBusinessId]);
      await db.query("insert into public.meta_billing_profiles(id,business_id,environment,ad_account_id,owner_business_id,created_by) values ($1,$2,'live','act_4567891','456',$3)", [profileId,payerBusinessId,ownerId]);
      await db.query("insert into public.meta_funding_evidence(id,profile_id,verified_by,source,source_reference,verified_at,record) values ($1,$2,$3,'operator_review',$4,now(),$5)", [evidenceId,profileId,ownerId,randomUUID(),funding]);
      const asService = async run => {
        const session = client(database);
        await session.connect();
        try { await session.query("set role service_role"); return await run(session); }
        finally { await session.end(); }
      };
      const claim = (overrides = {}) => asService(async session => {
        const input = { business: payerBusinessId, owner: ownerId, request: requestKey, key: "rzp_live_fixture", quote, terms, hash: termsHash, funding: evidenceId, ...overrides };
        return (await session.query("select public.production_payment_order_claim($1,$2,$3,$4,'acc_fixture',$5,$6,$7,$8,$9) as result",
          [input.business,input.owner,input.request,randomUUID(),input.key,input.quote,input.terms,input.hash,input.funding])).rows[0].result;
      });
      await assert.rejects(claim({ owner: otherOwnerId }), { code: "23514" });
      await assert.rejects(claim({ key: "rzp_test_fixture" }), { code: "23514" });
      await assert.rejects(claim({ hash: "0".repeat(64) }), { code: "23514" });
      await assert.rejects(claim({ funding: randomUUID() }), { code: "23514" });
      await assert.rejects(claim({ quote: { ...quote, totalPaise: 1 } }), { code: "23514" });
      const competingClaims = await Promise.all(Array.from({ length: 4 }, () => claim()));
      assert.equal(competingClaims.filter(result => result.claimed).length,1);
      assert.equal(new Set(competingClaims.map(result => result.order.id)).size,1);
      const order = competingClaims[0].order;
      assert.equal(order.environment,"live");
      assert.equal(order.amount_paise,1000000);
      assert.deepEqual(order.quote,quote);
      assert.deepEqual(order.terms,policy);
      assert.equal(order.terms_hash,termsHash);
      assert.equal((await claim({ request: randomUUID() })).order.id,order.id);
      await assert.rejects(claim({ hash: "1".repeat(64) }), { code: "23514" });
      const result = providerOrderId => asService(async session => (await session.query(
        "select public.production_payment_order_result($1,'acc_fixture','rzp_live_fixture',$2) as result", [order.id,providerOrderId])).rows[0].result);
      assert.equal((await result(null)).state,"needs_reconciliation");
      assert.equal((await claim()).claimed,false);
      assert.equal((await result("order_production")).state,"created");
      assert.equal((await result(null)).provider_order_id,"order_production");
      const fundingValid = async session => (await session.query(
        "select public.production_payment_funding_valid($1,$2) as valid",[payerBusinessId,evidenceId])).rows[0].valid;
      assert.equal(await asService(fundingValid),true);
      const rejectsInvalidFunding = async (statement, parameters) => {
        await db.query("begin");
        try {
          await db.query(statement,parameters);
          await db.query("set local role service_role");
          assert.equal(await fundingValid(db),false);
          const history = (await db.query("select public.production_payment_order_get($1,$2) as result",[order.id,ownerId])).rows[0].result;
          assert.equal(history.id,order.id);
          assert.equal(history.provider_order_id,"order_production");
          assert.equal(history.funding_evidence_id,evidenceId);
          for (const replayKey of [requestKey,randomUUID()]) {
            await db.query("savepoint replay_check");
            await assert.rejects(db.query("select public.production_payment_order_claim($1,$2,$3,$4,'acc_fixture','rzp_live_fixture',$5,$6,$7,$8)",
              [payerBusinessId,ownerId,replayKey,randomUUID(),quote,terms,termsHash,evidenceId]),{ code: "23514" });
            await db.query("rollback to savepoint replay_check");
          }
        } finally { await db.query("rollback"); }
      };
      await rejectsInvalidFunding("insert into public.meta_funding_revocations(evidence_id,revoked_by,reason) values ($1,$2,'mandate_revoked')",[evidenceId,ownerId]);
      await rejectsInvalidFunding("update public.meta_funding_evidence set record=jsonb_set(record,'{expiresAt}',to_jsonb((now()-interval '1 second')::text)) where id=$1",[evidenceId]);
      await rejectsInvalidFunding("update public.meta_connections set authorization_status='disconnected' where business_id=$1",[payerBusinessId]);
      await rejectsInvalidFunding("update public.meta_connections set generation=generation+1 where business_id=$1",[payerBusinessId]);
      await rejectsInvalidFunding("update public.meta_connections set ad_account_id='act_4567892' where business_id=$1",[payerBusinessId]);
      const replacementEvidence = randomUUID();
      await rejectsInvalidFunding("insert into public.meta_funding_evidence(id,profile_id,verified_by,source,source_reference,verified_at,record) values ($1,$2,$3,'operator_review',$4,now(),$5)",
        [replacementEvidence,profileId,ownerId,randomUUID(),{ ...funding, evidenceId: replacementEvidence, verifiedAt: new Date().toISOString() }]);
      assert.equal(await asService(fundingValid),true);
      assert.equal((await claim()).order.id,order.id);
      const operatorBusinessId = randomUUID();
      const operatorPolicy = JSON.parse(operatorPaymentMigration.split("$policy$")[1]);
      const operatorTerms = JSON.stringify(operatorPolicy);
      const operatorHash = createHash("sha256").update(operatorTerms).digest("hex");
      await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Operator-managed fixture')",[operatorBusinessId,ownerId]);
      const operatorInput = { business: operatorBusinessId, funding: null, terms: operatorTerms, hash: operatorHash };
      for (const invalid of [{ owner: otherOwnerId }, { key: "rzp_test_fixture" }, { funding: evidenceId },
        { hash: "0".repeat(64) }, { quote: { ...quote, totalPaise: 1 } }]) {
        await assert.rejects(claim({ ...operatorInput, ...invalid }),{ code: "23514" });
      }
      const alteredTerms = JSON.stringify({ ...operatorPolicy, refundTerms: "Service earned at capture" });
      await assert.rejects(claim({ ...operatorInput, terms: alteredTerms, hash: createHash("sha256").update(alteredTerms).digest("hex") }),{ code: "23514" });
      const operatorClaims = await Promise.all(Array.from({ length: 4 },() => claim(operatorInput)));
      assert.equal(operatorClaims.filter(value => value.claimed).length,1);
      const operatorOrder = operatorClaims[0].order;
      assert.equal(operatorOrder.funding_evidence_id,null);
      assert.deepEqual(operatorOrder.terms,operatorPolicy);
      assert.equal((await claim({ ...operatorInput, request: randomUUID() })).order.id,operatorOrder.id);
      assert.equal((await db.query("select count(*)::int as count from public.meta_connections where business_id=$1",[operatorBusinessId])).rows[0].count,0);
      assert.equal((await db.query("select count(*)::int as count from public.meta_billing_profiles where business_id=$1",[operatorBusinessId])).rows[0].count,0);
      await asService(session => session.query("select public.production_payment_order_result($1,'acc_fixture','rzp_live_fixture','order_operator')",[operatorOrder.id]));
      for (let attempt = 0; attempt < 2; attempt++) {
        const observed = await asService(async session => (await session.query("select public.production_payment_observe($1,'acc_fixture','rzp_live_fixture','pay_operator',true,0,false,$2) as result",[operatorOrder.id,"a".repeat(64)])).rows[0].result);
        assert.equal(observed.captured_paise,1000000);
        assert.equal(observed.review_required,false);
      }
      assert.equal((await db.query("select count(*)::int as count from private.production_payment_effects where order_id=$1 and kind='capture'",[operatorOrder.id])).rows[0].count,1);
      await db.query(operatorPaymentMigration);
      assert.deepEqual((await claim()).order.terms,policy);
      assert.equal((await claim()).order.funding_evidence_id,evidenceId);
      await assert.rejects(claim({ ...operatorInput, business: payerBusinessId }),{ code: "23514" });
      const refundRequest = randomUUID();
      const refundApproval = randomUUID();
      const claimRefund = (amount = 500, request = refundRequest) => asService(async session => (await session.query(
        "select public.production_payment_refund_claim($1,'acc_fixture','rzp_live_fixture',$2,$3,$4,$5,$6,$7,'Synthetic approved refund') as result",
        [order.id,ownerId,request,randomUUID(),amount,termsHash,refundApproval])).rows[0].result);
      await assert.rejects(claimRefund(),{ code: "42501" });
      await db.query("insert into private.production_payment_operators(user_id,approval_reference,can_refund,expires_at) values ($1,$2,true,now()+interval '1 hour')",[ownerId,randomUUID()]);
      await assert.rejects(claimRefund(),{ code: "23514" });
      const earlyRefund = await asService(async session => (await session.query(
        "select public.production_payment_observe($1,'acc_fixture','rzp_live_fixture','pay_production',false,100,false,$2,'rfnd_early',100,'processed') as result",
        [order.id,"d".repeat(64)])).rows[0].result);
      assert.equal(earlyRefund.captured_paise,0);
      assert.equal(earlyRefund.refunded_paise,100);
      assert.equal(earlyRefund.refund_hold,true);
      await asService(session => session.query("select public.production_payment_observe($1,'acc_fixture','rzp_live_fixture','pay_production',true,0,false,$2)",[order.id,"e".repeat(64)]));
      const refundClaims = await Promise.all(Array.from({length: 4},() => claimRefund()));
      assert.equal(refundClaims.filter(value => value.claimed).length,1);
      const refundOperation = refundClaims[0].refund;
      await assert.rejects(claimRefund(501),{ code: "23514" });
      await assert.rejects(claimRefund(500,randomUUID()),{ code: "23514" });
      await asService(session => session.query("select public.production_payment_refund_result($1,'acc_fixture','rzp_live_fixture',null)",[refundOperation.id]));
      assert.equal((await claimRefund()).refund.state,"needs_reconciliation");
      assert.equal((await claimRefund()).claimed,false);
      await asService(session => session.query("select public.production_payment_refund_result($1,'acc_fixture','rzp_live_fixture','rfnd_requested')",[refundOperation.id]));
      await asService(session => session.query("select public.production_payment_observe($1,'acc_fixture','rzp_live_fixture','pay_production',true,500,false,$2,'rfnd_requested',500,'processed')",[order.id,"f".repeat(64)]));
      await asService(session => session.query("select public.production_payment_refund_observed($1,'acc_fixture','rfnd_requested',500,'processed')",[refundOperation.id]));
      assert.equal((await claimRefund()).refund.state,"processed");
      await assert.rejects(claimRefund(1000000,randomUUID()),{ code: "23514" });
      const receive = (event, kind, hash = "a".repeat(64), payment = "pay_production") => asService(async session => (await session.query(
        "select public.production_payment_event_receive('acc_fixture','rzp_live_fixture',$1,$2,$3,$4,'order_production',$5,$6) as result",
        [webhookId,event,hash,payment,kind === "refund" ? "rfnd_production" : null,kind])).rows[0].result);
      const observe = (captured, refunded = 0, refundId = null, refundAmount = null, refundStatus = null) => asService(async session => (await session.query(
        "select public.production_payment_observe($1,'acc_fixture','rzp_live_fixture','pay_production',$2,$3,false,$4,$5,$6,$7) as result",
        [order.id,captured,refunded,"b".repeat(64),refundId,refundAmount,refundStatus])).rows[0].result);
      const pending = await receive("event_refund_first","refund");
      assert.equal(pending.processed_at,null);
      const afterRefund = await observe(false,1000,"rfnd_production",1000,"processed");
      assert.equal(afterRefund.refunded_paise,1600);
      assert.equal(afterRefund.captured_paise,1000000);
      assert.equal(afterRefund.refund_hold,true);
      await Promise.all([receive("event_capture_1","capture"), receive("event_capture_2","capture")]);
      const race = await Promise.all([observe(true),observe(true,1000,"rfnd_production",1000,"processed"),observe(true)]);
      assert.ok(race.every(value => value.captured_paise === 1000000 && value.refunded_paise === 1600 && value.refund_hold));
      assert.equal((await db.query("select count(*)::int as count from private.production_payment_effects where order_id=$1 and kind='capture'",[order.id])).rows[0].count,1);
      assert.equal((await db.query("select count(*)::int as count from private.production_payment_effects where order_id=$1 and kind='refund'",[order.id])).rows[0].count,3);
      assert.equal((await receive("event_capture_1","capture","c".repeat(64))).conflicted,true);
      await asService(session => session.query("select public.production_payment_event_receive('acc_fixture','rzp_live_fixture',$1,'event_capture_1',$2,'pay_unmatched','order_unmatched',null,'capture')",
        [webhookId,"d".repeat(64)]));
      const unmatchedConflict = await db.query("select payment_id,provider_order_id from private.production_payment_event_conflicts where account_id='acc_fixture' and event_id='event_capture_1' and payload_hash=$1",["d".repeat(64)]);
      assert.deepEqual(unmatchedConflict.rows,[{ payment_id: "pay_unmatched", provider_order_id: "order_unmatched" }]);
      assert.equal((await observe(true)).state,"review_required");
      await receive("event_dispute","dispute");
      assert.equal((await observe(true)).review_required,true);
      await asService(async session => {
        const get = async user => (await session.query("select public.production_payment_order_get($1,$2) as result",[order.id,user])).rows[0].result;
        assert.equal(await get(otherOwnerId),null);
        assert.equal((await get(ownerId)).id,order.id);
        for (const table of ["production_payment_orders","production_payment_events","production_payment_event_conflicts","production_payment_effects","production_payment_refunds","production_payment_operators"]) {
          await assert.rejects(session.query(`select * from private.${table}`), { code: "42501" });
          await assert.rejects(session.query(`delete from private.${table}`), { code: "42501" });
        }
        await session.query("set role authenticated");
        await assert.rejects(get(ownerId), { code: "42501" });
        await assert.rejects(fundingValid(session), { code: "42501" });
        await session.query("set role anon");
        await assert.rejects(get(ownerId), { code: "42501" });
        await assert.rejects(fundingValid(session), { code: "42501" });
      });
      await db.query("update public.businesses set owner_id=$2 where id=$1",[payerBusinessId,otherOwnerId]);
      assert.equal(await asService(async session => (await session.query("select public.production_payment_order_get($1,$2) as result",[order.id,ownerId])).rows[0].result),null);
    });

    await check(`${database}: managed billing isolates tenants and preserves evidence history`, async () => {
      const profileId = randomUUID();
      const evidenceId = randomUUID();
      const record = {
        version: 1, businessId, environment: "test", connectionGeneration: 1, evidenceId,
        verifiedAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(), revokedAt: null,
        setup: { method: "upi_auto_reload", accountId: "act_123", expectedOwnerBusinessId: "456",
          ownerBusinessId: "456", currency: "INR", country: "IN", accountActive: true,
          billingMode: "available_funds", paymentMethod: "verified", recurringAuthorisation: "verified",
          spendControls: "verified", ownerAcceptedMetaInitiatedPayments: true },
      };
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role service_role");
        await session.query(`insert into public.meta_billing_profiles
          (id,business_id,environment,ad_account_id,owner_business_id,created_by)
          values ($1,$2,'test','act_123','456',$3)`, [profileId, businessId, ownerId]);
        const insertEvidence = (input, source = "test_fixture", targetProfile = profileId) => session.query(`insert into public.meta_funding_evidence
          (id,profile_id,verified_by,source,source_reference,record) values ($1,$2,$3,$4,$5,$6)`,
        [input.evidenceId, targetProfile, ownerId, source, randomUUID(), input]);
        await insertEvidence(record);
        const latestRecord = async () => (await session.query("select public.meta_funding_latest_record($1,'test') as record", [businessId])).rows[0].record;
        assert.deepEqual(await latestRecord(), record);
        assert.equal((await session.query("select public.meta_funding_latest_record($1,'test') as record", [randomUUID()])).rows[0].record, null);
        await insertEvidence({ ...record, evidenceId: randomUUID(), verifiedAt: new Date(Date.now() - 120_000).toISOString() });
        assert.equal((await latestRecord()).evidenceId, evidenceId);
        await assert.rejects(insertEvidence(record), { code: "23505" });
        for (const override of [{ businessId: randomUUID() }, { environment: "live" },
          { connectionGeneration: -1 }, { revokedAt: new Date().toISOString() },
          { setup: { ...record.setup, accountId: "act_999" } },
          { setup: { ...record.setup, ownerBusinessId: "789" } },
          { setup: { ...record.setup, accessToken: "not-a-real-token" } },
          { verifiedAt: new Date(Date.now() + 60_000).toISOString() },
          { expiresAt: record.verifiedAt },
        ]) {
          await assert.rejects(insertEvidence({ ...record, ...override, evidenceId: randomUUID() }), { code: "23514" });
        }
        for (const table of ["meta_billing_profiles", "meta_funding_evidence", "meta_funding_revocations"]) {
          await assert.rejects(session.query(`delete from public.${table}`), { code: "42501" });
        }
        await assert.rejects(session.query("update public.meta_billing_profiles set ad_account_id='act_999'"), { code: "42501" });
        await assert.rejects(session.query("update public.meta_funding_evidence set record='{}'"), { code: "42501" });
        await session.query(`insert into public.meta_funding_revocations(evidence_id,revoked_by,reason)
          values ($1,$2,'mandate_revoked')`, [evidenceId, ownerId]);
        await assert.rejects(session.query("update public.meta_funding_revocations set reason='operator_hold'"), { code: "42501" });
        assert.equal((await session.query("select record from public.meta_funding_evidence where id=$1", [evidenceId])).rows[0].record.revokedAt, null);
        assert.equal((await session.query("select count(*)::int as total from public.meta_funding_revocations where evidence_id=$1", [evidenceId])).rows[0].total, 1);
        assert.ok(Date.parse((await latestRecord()).revokedAt) >= Date.parse(record.verifiedAt));
        const delayedRecord = { ...record, evidenceId: randomUUID(), verifiedAt: new Date(Date.now() - 30_000).toISOString() };
        await insertEvidence(delayedRecord);
        assert.equal((await latestRecord()).evidenceId, delayedRecord.evidenceId);
        assert.ok((await latestRecord()).revokedAt, "A pre-revocation snapshot cannot restore readiness");
        const liveProfile = randomUUID();
        await session.query(`insert into public.meta_billing_profiles
          (id,business_id,environment,ad_account_id,owner_business_id,created_by)
          values ($1,$2,'live','act_123','456',$3)`, [liveProfile, businessId, ownerId]);
        await assert.rejects(insertEvidence({ ...record, environment: "live", evidenceId: randomUUID() }, "test_fixture", liveProfile), { code: "23514" });
        await session.query("set role authenticated");
        await assert.rejects(session.query("select public.meta_funding_latest_record($1,'test')", [businessId]), { code: "42501" });
        await session.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
        assert.equal((await session.query("select id from public.meta_billing_profiles")).rowCount, 2);
        await assert.rejects(session.query(`insert into public.meta_billing_profiles
          (business_id,environment,ad_account_id,owner_business_id,created_by)
          values ($1,'test','act_999','456',$2)`, [businessId, ownerId]), { code: "42501" });
        for (const table of ["meta_funding_evidence", "meta_funding_revocations"]) {
          await assert.rejects(session.query(`select * from public.${table}`), { code: "42501" });
        }
        await session.query("select set_config('request.jwt.claim.sub', $1, false)", [randomUUID()]);
        assert.equal((await session.query("select id from public.meta_billing_profiles")).rowCount, 0);
        await session.query("set role anon");
        await assert.rejects(session.query("select public.meta_funding_latest_record($1,'test')", [businessId]), { code: "42501" });
        await assert.rejects(session.query("select * from public.meta_billing_profiles"), { code: "42501" });
      } finally { await session.end(); }
    });

    await check(`${database}: Meta charge observations dedupe atomically and quarantine conflicts`, async () => {
      const observation = {
        version: 1, businessId, environment: "test", accountId: "act_123", sourceEventId: "event_1",
        chargeId: "charge_1", status: "succeeded", amountPaise: 100000, taxPaise: null, currency: "INR",
        occurredAt: new Date(Date.now() - 60000).toISOString(), payloadHash: "a".repeat(64),
      };
      const record = async (input, source = "test_fixture") => {
        const session = client(database);
        await session.connect();
        try {
          await session.query("set role service_role");
          return (await session.query("select public.meta_billing_event_record($1,$2,$3,$4,$5,$6) as outcome",
            [businessId, input.environment, input, ownerId, source, randomUUID()])).rows[0].outcome;
        } finally { await session.end(); }
      };
      const outcomes = await Promise.all(Array.from({ length: 4 }, () => record(observation)));
      assert.equal(outcomes.filter(outcome => outcome === "recorded").length, 1);
      assert.equal(outcomes.filter(outcome => outcome === "duplicate").length, 3);
      assert.equal(await record({ ...observation, sourceEventId: "pending_1", status: "pending" }), "recorded");
      const conflict = { ...observation, amountPaise: 100001 };
      assert.equal(await record(conflict), "conflict");
      assert.equal(await record(conflict), "conflict");
      assert.equal((await db.query("select count(*)::int as total from public.meta_billing_event_conflicts")).rows[0].total, 1);
      assert.equal(await record({ ...observation, chargeId: "charge_other" }), "conflict");
      for (const override of [{ accountId: "act_999" }, { businessId: randomUUID() },
        { environment: "live" }, { amountPaise: 0 }, { amountPaise: -1 }, { amountPaise: 0.5 },
        { amountPaise: 9007199254740992 }, { amountPaise: "100000" }, { taxPaise: -1 },
        { taxPaise: 100001 }, { currency: "USD" }, { sourceEventId: null }, { payloadHash: 12345 },
        { occurredAt: "infinity" }, { occurredAt: new Date(Date.now() + 60000).toISOString() },
        { accessToken: "not-a-real-token" },
      ]) await assert.rejects(record({ ...observation, ...override }), { code: "23514" });
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role service_role");
        const read = async (tenant, environment, charge) => (await session.query(
          "select public.meta_billing_charge_observations($1,$2,$3) as observations", [tenant, environment, charge])).rows[0].observations;
        const stored = await read(businessId, "test", "charge_1");
        assert.equal(stored.events.length, 2);
        assert.equal(stored.events.find(event => event.sourceEventId === "event_1").amountPaise, 100000);
        assert.equal(stored.hasConflicts, true);
        assert.deepEqual(await read(businessId, "test", "charge_other"), { events: [], hasConflicts: true });
        assert.deepEqual(await read(randomUUID(), "test", "charge_1"), { events: [], hasConflicts: false });
        assert.deepEqual(await read(businessId, "live", "charge_1"), { events: [], hasConflicts: false });
        for (const table of ["meta_billing_events", "meta_billing_event_conflicts"]) {
          await assert.rejects(session.query(`delete from public.${table}`), { code: "42501" });
          await assert.rejects(session.query(`update public.${table} set source='operator_review'`), { code: "42501" });
          const grants = await session.query("select has_table_privilege('service_role',$1,'INSERT') as allowed", [`public.${table}`]);
          assert.equal(grants.rows[0].allowed, false);
        }
        for (const role of ["anon", "authenticated"]) {
          await session.query(`set role ${role}`);
          await assert.rejects(session.query("select * from public.meta_billing_events"), { code: "42501" });
          await assert.rejects(session.query("select * from public.meta_billing_event_conflicts"), { code: "42501" });
          await assert.rejects(session.query("select public.meta_billing_charge_observations($1,'test','charge_1')", [businessId]), { code: "42501" });
          await assert.rejects(session.query("select public.meta_billing_event_record($1,'test',$2,$3,'test_fixture',$4)",
            [businessId, observation, ownerId, randomUUID()]), { code: "42501" });
        }
      } finally { await session.end(); }
    });

    await check(`${database}: concurrent customers cannot claim the same managed ad account`, async () => {
      const businessIds = [randomUUID(), randomUUID()];
      for (const tenantId of businessIds) await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Funding isolation fixture')", [tenantId, ownerId]);
      const assignments = await Promise.allSettled(businessIds.map(async tenantId => {
        const session = client(database);
        await session.connect();
        try {
          await session.query("set role service_role");
          await session.query(`insert into public.meta_billing_profiles(business_id,environment,ad_account_id,owner_business_id,created_by)
            values ($1,'test','act_777','456',$2)`, [tenantId, ownerId]);
        } finally { await session.end(); }
      }));
      assert.equal(assignments.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(assignments.filter(result => result.status === "rejected" && result.reason.code === "23505").length, 1);
    });

    await check(`${database}: worker queue has server-only atomic claims and never replays interrupted mutations`, async () => {
      for (const role of ["anon", "authenticated"]) {
        const privileges = await db.query("select has_function_privilege($1, 'public.claim_next_campaign_job()', 'EXECUTE') as claim, has_function_privilege($1, 'public.enqueue_campaign_operation(uuid,jsonb,text)', 'EXECUTE') as enqueue", [role]);
        assert.deepEqual(privileges.rows[0], { claim: false, enqueue: false });
      }
      const queuedDraft = randomUUID();
      const operationId = randomUUID();
      await db.query("insert into public.campaign_drafts (id, business_id, owner_id, input, expires_at) values ($1,$2,$3,'{}',now()+interval '1 day')", [queuedDraft, businessId, ownerId]);
      const input = { businessId, draftId: queuedDraft, draftVersion: 1, connectionGeneration: 1, idempotencyKey: randomUUID(), planHash: "a".repeat(64) };
      const queued = await db.query("select * from public.enqueue_campaign_operation($1,$2,$3)", [operationId, input, "b".repeat(64)]);
      assert.equal(queued.rows[0].state, "pending");
      const claims = await Promise.all(Array.from({ length: 4 }, async () => {
        const worker = client(database);
        await worker.connect();
        try {
          await worker.query("set role service_role");
          return (await worker.query("select * from public.claim_next_campaign_job()")).rows;
        } finally { await worker.end(); }
      }));
      assert.equal(claims.flat().filter(row => row.id === operationId).length, 1);
      await db.query("update public.campaign_operations set lease_until=now()-interval '1 second', external_ids='[\"remote-id\"]' where id=$1", [operationId]);
      assert.equal((await db.query("select * from public.claim_next_campaign_job()")).rows.length, 0);
      const expired = await db.query("select state,external_ids from public.campaign_operations where id=$1", [operationId]);
      assert.deepEqual(expired.rows[0], { state: "needs_reconciliation", external_ids: ["remote-id"] });
    });

    await check(`${database}: product telemetry is server-only and retention is bounded`, async () => {
      for (const role of ["anon", "authenticated"]) {
        const { rows } = await db.query(`select
          has_table_privilege($1, 'public.product_events', 'SELECT') as can_read,
          has_table_privilege($1, 'public.product_events', 'INSERT') as can_write,
          has_function_privilege($1, 'public.prune_product_events()', 'EXECUTE') as can_prune`, [role]);
        assert.deepEqual(rows[0], { can_read: false, can_write: false, can_prune: false });
      }
      const oldId = randomUUID();
      const recentId = randomUUID();
      await db.query(`insert into public.product_events(event_id, request_id, version, user_id, business_id, kind, name, outcome, created_at)
        values ($1, $1, 1, $3, $4, 'request', 'http.request', 'success', now() - interval '91 days'),
               ($2, $2, 1, $3, $4, 'request', 'http.request', 'failed', now())`, [oldId, recentId, ownerId, businessId]);
      await db.query("set role service_role");
      try {
        const { rows } = await db.query("select public.prune_product_events() as removed");
        assert.equal(rows[0].removed, 1);
        const remaining = await db.query("select event_id from public.product_events");
        assert.deepEqual(remaining.rows, [{ event_id: recentId }]);
      } finally {
        await db.query("reset role");
      }
    });

    await check(`${database}: quota ledger and limiter are server-only`, async () => {
      for (const role of ["anon", "authenticated"]) {
        const { rows } = await db.query(`select
          has_table_privilege($1, 'public.llm_usage_events', 'INSERT') as can_insert,
          has_function_privilege($1, 'public.check_rate_limit(text,integer,integer)', 'EXECUTE') as can_limit`, [role]);
        assert.equal(rows[0].can_insert, false);
        assert.equal(rows[0].can_limit, false);
      }
    });
    await check(`${database}: negative usage cannot lower the quota ledger`, async () => {
      await assert.rejects(db.query(`insert into public.llm_usage_events
        (business_id, user_id, route, provider, model, total_tokens)
        values ($1, $2, 'test', 'test', 'test', -1)`, [businessId, ownerId]),
      { code: "23514" });
    });
    await check(`${database}: quota totals include all rows and enforce tenant RLS`, async () => {
      await db.query(`insert into public.llm_usage_events
        (business_id, user_id, route, provider, model, total_tokens)
        select $1, $2, 'test', 'test', 'test', 2 from generate_series(1, 1100)`, [businessId, ownerId]);
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role authenticated");
        await session.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
        const owned = await session.query("select public.monthly_token_usage($1, now() - interval '1 day') as total", [businessId]);
        assert.equal(Number(owned.rows[0].total), 2200);
        await session.query("select set_config('request.jwt.claim.sub', $1, false)", [randomUUID()]);
        const foreign = await session.query("select public.monthly_token_usage($1, now() - interval '1 day') as total", [businessId]);
        assert.equal(Number(foreign.rows[0].total), 0);
      } finally {
        await session.end();
      }
    });
    await check(`${database}: concurrent rate checks cannot exceed capacity`, async () => {
      const key = `rate-test:${randomUUID()}`;
      const results = await Promise.all(Array.from({ length: 12 }, async () => {
        const session = client(database);
        await session.connect();
        try {
          await session.query("set role service_role");
          return (await session.query("select * from public.check_rate_limit($1, 3, 60000)", [key])).rows[0];
        } finally {
          await session.end();
        }
      }));
      assert.equal(results.filter(result => result.allowed).length, 3);
      assert.ok(results.filter(result => !result.allowed).every(result => result.retry_after_ms > 0));
    });
    await check(`${database}: invalid rate windows fail without inserting`, async () => {
      await assert.rejects(db.query("select * from public.check_rate_limit('invalid', 1, 0)"), { code: "22023" });
      const { rows } = await db.query("select count(*)::int as count from public.rate_limit_hits where key = 'invalid'");
      assert.equal(rows[0].count, 0);
    });

    const operationDrafts = new Map();
    const claim = async (key, operationId = randomUUID(), targetDraftId) => {
      if (!targetDraftId) {
        if (!operationDrafts.has(key)) operationDrafts.set(key, db.query("insert into public.campaign_drafts (business_id, owner_id, input, expires_at) values ($1, $2, '{}', now() + interval '1 day') returning id", [businessId, ownerId]).then(result => result.rows[0].id));
        targetDraftId = await operationDrafts.get(key);
      }
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role service_role");
        return (await session.query(`select * from public.claim_campaign_operation(
          $1, $2, $3, (select version from public.campaign_drafts where id = $3), 1, 'campaign_create', $4, $5, now() + interval '1 minute')`,
        [operationId, businessId, targetDraftId, key, "a".repeat(64)])).rows;
      } finally {
        await session.end();
      }
    };

    await check(`${database}: browser roles cannot access encrypted tokens`, async () => {
      for (const role of ["anon", "authenticated"]) {
        const { rows } = await db.query("select has_schema_privilege($1, 'private', 'usage') as allowed", [role]);
        assert.equal(rows[0].allowed, false);
      }
    });
    await check(`${database}: browser roles cannot mutate operation ledger`, async () => {
      for (const role of ["anon", "authenticated"]) {
        for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
          const { rows } = await db.query("select has_table_privilege($1, 'public.campaign_operations', $2) as allowed", [role, privilege]);
          assert.equal(rows[0].allowed, false, `${role} retains ${privilege}`);
        }
      }
    });
    await check(`${database}: operation mutation RPCs are service-only`, async () => {
      const { rows } = await db.query(`select proname from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('claim_campaign_operation', 'checkpoint_campaign_operation', 'finish_campaign_operation', 'fail_campaign_operation', 'expire_campaign_operation')
          and (has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute'))`);
      assert.deepEqual(rows, []);
    });
    await check(`${database}: draft version race has one winner`, async () => {
      const update = async () => {
        const session = client(database);
        await session.connect();
        try {
          await session.query("set role authenticated");
          await session.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
          return (await session.query("select * from public.update_campaign_draft_if_version($1, $2, $3, 1, '{}')", [draftId, businessId, ownerId])).rowCount;
        } finally {
          await session.end();
        }
      };
      assert.deepEqual((await Promise.all([update(), update()])).sort(), [0, 1]);
    });
    await check(`${database}: concurrent operation claims have one winner`, async () => {
      const results = await Promise.allSettled([claim("concurrent-key"), claim("concurrent-key")]);
      assert.ok(results.every(result => result.status === "fulfilled"), "Concurrent claims must not throw unique violations");
      assert.equal(results.flatMap(result => result.value ?? []).filter(row => row.state === "running").length, 1);
    });
    await check(`${database}: two request keys cannot submit the same draft twice`, async () => {
      const results = await Promise.all([claim("draft-key-first", randomUUID(), draftId), claim("draft-key-second", randomUUID(), draftId)]);
      assert.equal(results.flat().length, 1);
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role authenticated");
        await session.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
        const editable = await session.query("select * from public.update_campaign_draft_if_version($1, $2, $3, 2, '{}')", [draftId, businessId, ownerId]);
        assert.equal(editable.rowCount, 0);
        // ON DELETE RESTRICT: 23503 up to PostgreSQL 17, 23001 restrict_violation from PostgreSQL 18 (ubuntu-26.04 runners).
        await assert.rejects(session.query("select * from public.delete_campaign_draft_if_version($1,2)", [draftId]), { code: /^(23503|23001)$/ });
      } finally { await session.end(); }
    });
    await check(`${database}: expired running operation requires reconciliation`, async () => {
      const [operation] = await claim("expired-key");
      await db.query("update public.campaign_operations set lease_until = now() - interval '1 second' where id = $1", [operation.id]);
      const [reclaimed] = await claim("expired-key");
      assert.equal(reclaimed?.state, "needs_reconciliation");
    });
    await check(`${database}: stale connection generation cannot checkpoint`, async () => {
      const [operation] = await claim("generation-key");
      await db.query("update public.meta_connections set generation = 2 where business_id = $1", [businessId]);
      const { rows } = await db.query(`select * from public.checkpoint_campaign_operation(
        $1, $2, 1, 'adset', now() + interval '1 minute', '[]')`, [operation.id, businessId]);
      assert.equal(rows.length, 0);
    });
    await check(`${database}: expiry is durable and cannot overwrite success`, async () => {
      await db.query("update public.meta_connections set generation = 1 where business_id = $1", [businessId]);
      const [operation] = await claim("status-expiry-key");
      await db.query("update public.campaign_operations set lease_until = now() - interval '1 second' where id = $1", [operation.id]);
      const expired = await db.query("select * from public.expire_campaign_operation($1, $2)", [operation.id, businessId]);
      assert.equal(expired.rows[0].state, "needs_reconciliation");
      await db.query("update public.campaign_operations set state = 'succeeded', phase = 'complete' where id = $1", [operation.id]);
      const preserved = await db.query("select * from public.expire_campaign_operation($1, $2)", [operation.id, businessId]);
      assert.equal(preserved.rows[0].state, "succeeded");
      assert.equal((await db.query("select * from public.expire_campaign_operation($1, $2)", [operation.id, randomUUID()])).rowCount, 0);
    });
    await check(`${database}: failure preserves known IDs and fences terminal and tenant changes`, async () => {
      const [operation] = await claim("failure-fence-key");
      await db.query("update public.campaign_operations set external_ids = '[\"first-id\"]' where id = $1", [operation.id]);
      const fail = (owner, generation, ids) => db.query("select * from public.fail_campaign_operation($1, $2, $3, 'failed', $4, null, 'fixture failure')", [operation.id, owner, generation, JSON.stringify(ids)]);
      assert.equal((await fail(randomUUID(), 1, ["foreign-id"])).rowCount, 0);
      assert.equal((await fail(businessId, 2, ["stale-id"])).rowCount, 0);
      const failed = await fail(businessId, 1, ["second-id"]);
      assert.equal(failed.rows[0].state, "needs_reconciliation");
      assert.deepEqual(failed.rows[0].external_ids.sort(), ["first-id", "second-id"]);
      await db.query("update public.campaign_operations set state = 'succeeded', phase = 'complete' where id = $1", [operation.id]);
      assert.equal((await fail(businessId, 1, ["late-id"])).rowCount, 0);
      await db.query("update public.meta_connections set generation = 2 where business_id = $1", [businessId]);
    });
    const seedAttempt = async (expectedGeneration, expired = false) => {
      const tokenId = randomUUID();
      const attemptId = randomUUID();
      await db.query(`insert into private.meta_tokens
        (id, business_id, authorized_by, subject_id, token_kind, ciphertext, nonce, auth_tag, key_id)
        values ($1, $2, $3, 'fixture-subject', 'user', $4, $5, $6, 'fixture-key')`,
      [tokenId, businessId, ownerId, Buffer.from("encrypted-fixture"), Buffer.alloc(12), Buffer.alloc(16)]);
      const candidates = [{ pairId: "fixture-pair", eligible: true, assets: {
        metaBusinessId: null, adAccountId: "act_fixture", pageId: "page_fixture", accountName: "Fixture",
        pageName: "Fixture Page", currency: "INR", timezoneName: "Asia/Kolkata",
      } }];
      await db.query(`insert into private.meta_connection_attempts
        (id, business_id, user_id, token_id, state_hash, browser_binding_hash, status, intent,
          expected_generation, discovered_assets, discovery_complete, expires_at)
        values ($1, $2, $3, $4, $5, 'fixture-browser-hash', 'selection_required', '{"kind":"setup"}',
          $6, $7, true, now() + $8::interval)`,
      [attemptId, businessId, ownerId, tokenId, randomUUID(), expectedGeneration, JSON.stringify(candidates), expired ? "-1 day" : "1 day"]);
      return attemptId;
    };
    await check(`${database}: stale OAuth attempt cannot replace a newer connection`, async () => {
      const attemptId = await seedAttempt(1);
      const { rows } = await db.query("select public.meta_attempt_commit_selection($1, $2, 'fixture-pair', 0, true) as committed", [attemptId, ownerId]);
      assert.equal(rows[0].committed, false);
    });
    await check(`${database}: expired OAuth attempt cannot commit`, async () => {
      const { rows: connection } = await db.query("select generation from public.meta_connections where business_id = $1", [businessId]);
      const attemptId = await seedAttempt(Number(connection[0].generation), true);
      const { rows } = await db.query("select public.meta_attempt_commit_selection($1, $2, 'fixture-pair', 0, true) as committed", [attemptId, ownerId]);
      assert.equal(rows[0].committed, false);
    });
    await check(`${database}: valid competing OAuth selections have one winner`, async () => {
      const { rows } = await db.query("select generation from public.meta_connections where business_id = $1", [businessId]);
      const attemptIds = await Promise.all([seedAttempt(Number(rows[0].generation)), seedAttempt(Number(rows[0].generation))]);
      const commit = async attemptId => {
        const session = client(database);
        await session.connect();
        try {
          await session.query("set role service_role");
          return (await session.query("select public.meta_attempt_commit_selection($1, $2, 'fixture-pair', 0, true) as committed", [attemptId, ownerId])).rows[0].committed;
        } finally {
          await session.end();
        }
      };
      assert.deepEqual((await Promise.all(attemptIds.map(commit))).sort(), [false, true]);
    });
    await check(`${database}: partial discovery cannot commit and complete snapshots can`, async () => {
      const { rows: connection } = await db.query("select generation from public.meta_connections where business_id = $1", [businessId]);
      const attemptId = await seedAttempt(Number(connection[0].generation));
      const { rows: attempts } = await db.query("select discovered_assets from private.meta_connection_attempts where id = $1", [attemptId]);
      const snapshot = { kind: "asset_snapshot", complete: false, candidates: attempts[0].discovered_assets };
      await db.query("update private.meta_connection_attempts set status = 'discovering' where id = $1", [attemptId]);
      await db.query("select public.meta_attempt_discovery_result($1, $2, 'action_required', 'DISCOVERY_INCOMPLETE')", [attemptId, snapshot]);
      const { rows } = await db.query("select * from public.meta_attempt_get($1, $2)", [attemptId, ownerId]);
      assert.equal(rows[0].discovery_complete, false);
      assert.equal((await db.query("select public.meta_attempt_commit_selection($1, $2, 'fixture-pair', 1, true) as committed", [attemptId, ownerId])).rows[0].committed, false);
      await db.query("update private.meta_connection_attempts set status = 'discovering' where id = $1", [attemptId]);
      await db.query("select public.meta_attempt_discovery_result($1, $2, 'selection_required', null)", [attemptId, { ...snapshot, complete: true }]);
      assert.equal((await db.query("select public.meta_attempt_commit_selection($1, $2, 'fixture-pair', 2, true) as committed", [attemptId, ownerId])).rows[0].committed, true);
    });
    await check(`${database}: token RPC preserves bytea and rejects tenant mismatch`, async () => {
      const { rows: tokens } = await db.query("select id from private.meta_tokens where business_id = $1 limit 1", [businessId]);
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role service_role");
        const { rows } = await session.query("select * from public.meta_token_get($1, $2)", [tokens[0].id, businessId]);
        assert.ok(rows[0].ciphertext.equals(Buffer.from("encrypted-fixture")));
        assert.equal(rows[0].nonce.length, 12);
        assert.equal(rows[0].auth_tag.length, 16);
        assert.deepEqual(rows[0].granted_scopes, []);
        assert.equal((await session.query("select * from public.meta_token_get($1, $2)", [tokens[0].id, randomUUID()])).rowCount, 0);
        await session.query("set role authenticated");
        await assert.rejects(session.query("select * from public.meta_token_get($1, $2)", [tokens[0].id, businessId]), { code: "42501" });
      } finally {
        await session.end();
      }
    });
    await check(`${database}: discovery retry checks revision, owner, expiry and claims once`, async () => {
      const { rows } = await db.query("select generation from public.meta_connections where business_id = $1", [businessId]);
      const attemptId = await seedAttempt(Number(rows[0].generation));
      await db.query("update private.meta_connection_attempts set status = 'failed' where id = $1", [attemptId]);
      const claim = async (userId, revision) => (await db.query("select public.meta_attempt_retry_claim($1,$2,$3) as claimed", [attemptId, userId, revision])).rows[0].claimed;
      assert.equal(await claim(randomUUID(), 0), false);
      assert.equal(await claim(ownerId, 99), false);
      assert.equal(await claim(ownerId, 0), true);
      assert.equal(await claim(ownerId, 0), false);
      await db.query("update private.meta_connection_attempts set status = 'failed', expires_at = now() - interval '1 second' where id = $1", [attemptId]);
      assert.equal(await claim(ownerId, 1), false);
    });
    await check(`${database}: disconnect revokes referenced tokens and rejects another owner`, async () => {
      assert.equal((await db.query("select public.meta_disconnect($1, $2) as disconnected", [businessId, randomUUID()])).rows[0].disconnected, false);
      assert.equal((await db.query("select public.meta_disconnect($1, $2) as disconnected", [businessId, ownerId])).rows[0].disconnected, true);
      assert.equal((await db.query("select id from private.meta_tokens where business_id = $1 and revoked_at is null", [businessId])).rowCount, 0);
      const { rows } = await db.query("select token_id, authorization_status from public.meta_connections where business_id = $1", [businessId]);
      assert.equal(rows[0].token_id, null);
      assert.equal(rows[0].authorization_status, "revoked");
    });
    await check(`${database}: owners can read but cannot tamper with operation rows`, async () => {
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role authenticated");
        await session.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
        assert.ok((await session.query("select id from public.campaign_operations")).rowCount > 0);
        await assert.rejects(session.query("update public.campaign_operations set state = 'succeeded'"), { code: "42501" });
        await session.query("select set_config('request.jwt.claim.sub', $1, false)", [randomUUID()]);
        assert.equal((await session.query("select id from public.campaign_operations")).rowCount, 0);
      } finally {
        await session.end();
      }
    });
    await check(`${database}: clean fixtures pass rollout preflight and final constraint validation`, async () => {
      const results = await db.query(await readFile(join(root, "db/preflight/20260926_campaign_integrity.sql"), "utf8"));
      assert.ok(results[1].rows.every(row => Number(row.rows) === 0));
      await db.query(await readFile(join(root, "db/migrations/20260926_validate_campaign_integrity.sql"), "utf8"));
    });
  } finally {
    await db.end();
  }
}

try {
  execFileSync(join(bin, "initdb"), ["-D", cluster, "--auth=trust", "--encoding=UTF8", "--locale=C"], { stdio: "pipe" });
  execFileSync(join(bin, "pg_ctl"), ["-D", cluster, "-l", join(directory, "postgres.log"), "-o", `-k ${directory} -c listen_addresses=''`, "-w", "start"], { stdio: "pipe", env: { ...process.env, LC_ALL: "C" } });
  started = true;
  const admin = client();
  await admin.connect();
  await admin.query("create role anon; create role authenticated; create role service_role bypassrls");
  await admin.end();
  if (process.argv.includes("--rollback-only")) {
    await verifyRollback();
  } else {
  const schema = buildSchema(root);
  const baseline = execFileSync("git", ["show", "d8d789071c74a7a93b1f270a0c4f119aff79aa34:db/schema.sql"], { cwd: root, encoding: "utf8" });
  const metaMigration = await readFile(join(root, "db/migrations/20260907_meta_instant_connect.sql"), "utf8");
  const campaignMigration = await readFile(join(root, "db/migrations/20260907_campaign_connect.sql"), "utf8");
  const trustedUsageMigration = await readFile(join(root, "db/migrations/20260916_trusted_usage_and_rate_limits.sql"), "utf8");
  const productEventsMigration = await readFile(join(root, "db/migrations/20260918_product_events.sql"), "utf8");
  const whatsappMigration = await readFile(join(root, "db/migrations/20260918_whatsapp_results.sql"), "utf8");
  const reportingMigration = await readFile(join(root, "db/migrations/20260919_campaign_reporting_identity.sql"), "utf8");
  const workerMigration = await readFile(join(root, "db/migrations/20260919_campaign_worker.sql"), "utf8");
  const billingMigration = await readFile(join(root, "db/migrations/20260924_managed_billing.sql"), "utf8");
  const billingEventsMigration = await readFile(join(root, "db/migrations/20260924_meta_billing_events.sql"), "utf8");
  const leadFollowUpMigration = await readFile(join(root, "db/migrations/20260926_lead_follow_up.sql"), "utf8");
  const leadSyncMigration = await readFile(join(root, "db/migrations/20260926_lead_sync_progress.sql"), "utf8");
  const legacyLead = `insert into auth.users (id, email) values ('30000000-0000-4000-8000-000000000001', 'legacy@example.invalid');
    insert into public.businesses (id, owner_id, name) values ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Legacy fixture');
    insert into public.leads (business_id, meta_lead_id, full_name) values ('30000000-0000-4000-8000-000000000002', 'legacy-follow-up', 'Legacy enquiry');`;
  const testPaymentsMigration = await readFile(join(root, "db/migrations/20260926_razorpay_test_orders.sql"), "utf8");
  const productionPaymentsMigration = await readFile(join(root, "db/migrations/20260926_production_payment_orders.sql"), "utf8");
  const integrityMigration = await readFile(join(root, "db/migrations/20260926_campaign_integrity.sql"), "utf8");
  const draftAuthorityMigration = await readFile(join(root, "db/migrations/20260926_draft_authority.sql"), "utf8");
  const trustedCampaignMigration = await readFile(join(root, "db/migrations/20260926_trusted_campaign_writes.sql"), "utf8");
  const privacyMigration = await readFile(join(root, "db/migrations/20260930_privacy_requests.sql"), "utf8");
  assert.ok(schema.includes(billingMigration.trim()), "Canonical schema must include the exact managed billing dependency");
  assert.ok(schema.includes(productionPaymentsMigration.trim()), "Canonical schema must include the exact production payment migration");
  assert.ok(schema.indexOf(billingMigration.trim()) < schema.indexOf(productionPaymentsMigration.trim()), "Managed billing must precede production payments");
  assert.ok(schema.includes(operatorPaymentMigration.trim()), "Canonical schema must include the exact operator-managed payment migration");
  assert.ok(schema.includes(customerAllowanceMigration.trim()), "Canonical schema must include the exact customer allowance migration");
  assert.ok(schema.includes(creativeIntentMigration.trim()), "Canonical schema must include the exact creative generation intent migration");
  assert.ok(schema.includes(creativeReconcileMigration.trim()), "Canonical schema must include the exact creative reconciliation migration");
  assert.ok(schema.indexOf(creativeReconcileMigration.trim()) < schema.indexOf(creativeSettleMigration.trim()), "Canonical schema must include the exact settle-holds migration after reconciliation");
  assert.ok(schema.includes(configurablePaymentMigration.trim()), "Canonical schema must include the exact configurable pricing migration");
  assert.ok(schema.indexOf(configurablePaymentMigration.trim()) < schema.indexOf(webhookHealthMigration.trim()), "Canonical schema must include the exact webhook health migration after configurable pricing");
  assert.ok(schema.indexOf(webhookHealthMigration.trim()) < schema.indexOf(cappedBoundMigration.trim()), "Canonical schema must include the exact capped bound migration after webhook health");
  assert.ok(schema.includes(customAmountMigration.trim()), "Canonical schema must include the exact custom payment amount migration");
  assert.ok(schema.indexOf(webhookHealthMigration.trim()) < schema.indexOf(customAmountMigration.trim()), "Canonical schema must include the custom payment amount migration after webhook health");
  assert.ok(schema.indexOf(customAmountMigration.trim()) < schema.indexOf(metaCostMigration.trim()), "Canonical schema must include the exact Meta cost observation migration after the custom payment amount");
  assert.ok(schema.indexOf(metaCostMigration.trim()) < schema.indexOf(metaSettleMigration.trim()), "Canonical schema must include the exact Meta cost settle migration after the Meta cost observation");
  assert.ok(readBaseSchema(root).trimEnd().endsWith(`${productRollupMigration.trimEnd()}\n\n${privacyMigration.trimEnd()}`), "Frozen base schema must end with the exact product rollup and privacy migrations");
  let previousPosition = readBaseSchema(root).length;
  for (const name of appendedMigrations(root)) {
    const position = schema.indexOf((await readFile(join(root, "db/migrations", name), "utf8")).trim(), previousPosition);
    assert.ok(position >= previousPosition, `Generated schema must append ${name} after the base in filename order`);
    previousPosition = position;
  }
  if (process.argv.includes("--analytics-only")) {
    await verify("analytics_fresh",schema);
    await verify("analytics_upgrade",`${baseline}\n${metaMigration}\n${productEventsMigration}`);
  } else if (process.argv.includes("--pricing-only")) {
    await verify("pricing_fresh",schema);
    await verify("pricing_upgrade",schema.slice(0,schema.lastIndexOf(configurablePaymentMigration.trim())));
  } else if (process.argv.includes("--generation-only")) {
    await verify("generation_fresh",schema);
    await verify("generation_upgrade",`${baseline}\n${metaMigration}\n${campaignMigration}\n${trustedUsageMigration}`);
  } else if (!process.argv.includes("--customer-only")) {
    await verify("fresh_install", `${schema}\n${trustedUsageMigration}\n${productEventsMigration}\n${whatsappMigration}\n${billingEventsMigration}\n${testPaymentsMigration}`);
    await verify("ordered_upgrade", `${baseline}\n${metaMigration}\n${campaignMigration}\n${trustedUsageMigration}\n${trustedUsageMigration}\n${productEventsMigration}\n${productEventsMigration}\n${whatsappMigration}\n${whatsappMigration}\n${reportingMigration}\n${reportingMigration}\n${workerMigration}\n${workerMigration}\n${billingMigration}\n${billingMigration}\n${billingEventsMigration}\n${billingEventsMigration}\n${testPaymentsMigration}\n${testPaymentsMigration}\n${productionPaymentsMigration}\n${productionPaymentsMigration}\n${draftAuthorityMigration}\n${trustedCampaignMigration}\n${legacyLead}\n${leadFollowUpMigration}\n${leadFollowUpMigration}\n${leadSyncMigration}\n${leadSyncMigration}`, integrityMigration);
  }
  if (!process.argv.includes("--analytics-only") && !process.argv.includes("--pricing-only") && !process.argv.includes("--leads-only") && !process.argv.includes("--generation-only")) {
    await verify("customer_fresh",schema,undefined,true);
    await verify("customer_upgrade",`${baseline}\n${metaMigration}\n${campaignMigration}\n${billingMigration}\n${productionPaymentsMigration}\n${trustedCampaignMigration}`,undefined,true);
    if (!process.argv.includes("--customer-only")) {
      await verify("pricing_fresh",schema);
      await verify("pricing_upgrade",schema.slice(0,schema.lastIndexOf(configurablePaymentMigration.trim())));
      await verify("analytics_fresh",schema);
      await verify("analytics_upgrade",`${baseline}\n${metaMigration}\n${productEventsMigration}`);
    }
  }
  }
} catch (error) {
  failures.push("database harness");
  console.error(`FAIL database harness: ${error.message}`);
  if (!started) console.error(await readFile(join(directory, "postgres.log"), "utf8").catch(() => "No PostgreSQL startup log available."));
} finally {
  if (started) execFileSync(join(bin, "pg_ctl"), ["-D", cluster, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
  await rm(directory, { recursive: true, force: true });
}

console.log(`Isolated PostgreSQL verification: ${failures.length ? `${failures.length} failure(s)` : "PASS"}. No remote database used.`);
process.exitCode = failures.length ? 1 : 0;