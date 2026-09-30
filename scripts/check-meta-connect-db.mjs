import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { applyMigration } from "./database-migrations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const operatorPaymentMigration = await readFile(join(root, "db/migrations/20260926_production_payment_policy_v2.sql"), "utf8");
const customerAllowanceMigration = await readFile(join(root, "db/migrations/20260926_customer_ad_allowance.sql"), "utf8");
const creativeIntentMigration = await readFile(join(root, "db/migrations/20260927_creative_generation_intents.sql"), "utf8");
const creativeReconcileMigration = await readFile(join(root, "db/migrations/20260930_creative_generation_reconcile.sql"), "utf8");
const configurablePaymentMigration = await readFile(join(root, "db/migrations/20260927_configurable_payment_quotes.sql"), "utf8");
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
  create table storage.buckets (id text primary key, name text, public boolean);
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
  const terms = async (value, verification = null) => (await db.query("select private.production_payment_priced_policy($1,$2) as policy", [value,verification])).rows[0].policy;
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
    for (const [amount,scope] of [[100,null],[1005,null],[50000,null],[999999,null],[1000,verification]]) {
      const settings = { ...environment,PAYMENTS_LIVE_AMOUNT_PAISE:String(amount),...(scope ? {
        PAYMENTS_LIVE_VERIFICATION_ENABLED:'true',PAYMENTS_LIVE_VERIFICATION_AMOUNT_PAISE:String(amount),
        PAYMENTS_LIVE_VERIFICATION_BUSINESS_ID:business,PAYMENTS_LIVE_VERIFICATION_USER_ID:owner,PAYMENTS_LIVE_VERIFICATION_EXPIRES_AT:scope.expiresAt } : {}) };
      const actual = JSON.parse(execFileSync(process.execPath,['--import','tsx','-e',
        'const {getProductionCollectionPolicy}=require("./src/lib/payments/production-config.ts"); const {hash,...policy}=getProductionCollectionPolicy(JSON.parse(process.argv[1]),Date.now(),JSON.parse(process.argv[2])); process.stdout.write(JSON.stringify(policy));',
        JSON.stringify(settings),JSON.stringify({businessId:business,userId:owner})],{cwd:root,encoding:'utf8'}));
      assert.deepEqual(actual,await terms(await quote(amount,Boolean(scope)),scope));
      assert.equal((await db.query("select private.production_payment_contract_valid($1,$2,$3) as valid",[amount,actual.quote,actual])).rows[0].valid,true);
    }
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
    const value = await quote(1005);
    const payment = (await claim(value,await terms(value),randomUUID(),other)).order;
    await complete(payment,'revised');
    await db.query("insert into private.production_payment_operators(user_id,approval_reference,can_refund,expires_at) values ($1,$2,true,clock_timestamp()+interval '1 hour')",[owner,randomUUID()]);
    await service("select public.customer_ad_refund_allocation($1,$2,'acc_pricing',$3,0,0,201,$4) as result",[other,owner,payment.id,randomUUID()]);
    await assert.rejects(service("select public.customer_ad_refund_allocation($1,$2,'acc_pricing',$3,0,0,200000,$4) as result",[other,owner,payment.id,randomUUID()]),{code:'23514'});
    const balance = await service("select public.customer_ad_balance($1,$2,'acc_pricing') as result",[other,owner]);
    assert.equal(balance.serviceAllocationPaise,201);
    assert.equal(balance.advertisingAllocationPaise,804);
    assert.equal(balance.serviceEarnedPaise,201);
    await service("select public.production_payment_observe($1,'acc_pricing','rzp_live_pricing','pay_revised',true,33,false,$2,'rfnd_revised',33,'processed') as result",[payment.id,'e'.repeat(64)]);
    assert.equal((await service("select public.customer_ad_balance($1,$2,'acc_pricing') as result",[other,owner])).held,true);
    await service("select public.customer_ad_refund_allocation($1,$2,'acc_pricing',$3,0,33,201,$4) as result",[other,owner,payment.id,randomUUID()]);
    const adjusted = await service("select public.customer_ad_balance($1,$2,'acc_pricing') as result",[other,owner]);
    assert.equal(adjusted.held,false);
    assert.equal(adjusted.remainingPaise,771);
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
  await check(`${database}: pricing objects remain inaccessible to browser roles`, async () => {
    for (const role of ['anon','authenticated']) {
      const session = client(database);
      await session.connect();
      try {
        await session.query(`set role ${role}`);
        await assert.rejects(session.query("select * from private.production_payment_orders"),{code:'42501'});
        await assert.rejects(session.query("select public.production_payment_orders_list($1,$2)",[business,owner]),{code:'42501'});
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
    assert.equal((await service("select public.creative_generation_progress($1,$2,$3,100,false,false,false) as result",[otherBusiness,otherOwner,id])).status,'failed');
    assert.deepEqual((await db.query("select reserved_tokens,accounted_tokens from private.creative_generation_intents where generation_id=$1",[id])).rows.map(row=>({reserved:Number(row.reserved_tokens),accounted:Number(row.accounted_tokens)})),[{reserved:40,accounted:40}]);
    await assert.rejects(reconcile(otherBusiness,otherOwner),{code:'23505'});
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
      await verifyConfigurablePayments(db,database);
      return;
    }
    if (process.argv.includes("--generation-only")) {
      await db.query(creativeIntentMigration);
      await db.query(creativeIntentMigration);
      await db.query(creativeReconcileMigration);
      await db.query(creativeReconcileMigration);
      await verifyCreativeGenerationAdmission(db, database);
      return;
    }
    await db.query(operatorPaymentMigration);
    await db.query(operatorPaymentMigration);
    if (customerOnly) {
      await db.query(customerAllowanceMigration);
      await db.query(customerAllowanceMigration);
      await verifyCustomerAllowance(db,database);
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
        await assert.rejects(session.query("select * from public.delete_campaign_draft_if_version($1,2)", [draftId]), { code: "23503" });
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
  execFileSync(join(bin, "pg_ctl"), ["-D", cluster, "-l", join(directory, "postgres.log"), "-o", `-k ${directory} -c listen_addresses=''`, "-w", "start"], { stdio: "pipe" });
  started = true;
  const admin = client();
  await admin.connect();
  await admin.query("create role anon; create role authenticated; create role service_role bypassrls");
  await admin.end();
  if (process.argv.includes("--rollback-only")) {
    await verifyRollback();
  } else {
  const schema = await readFile(join(root, "db/schema.sql"), "utf8");
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
  assert.ok(schema.includes(billingMigration.trim()), "Canonical schema must include the exact managed billing dependency");
  assert.ok(schema.includes(productionPaymentsMigration.trim()), "Canonical schema must include the exact production payment migration");
  assert.ok(schema.indexOf(billingMigration.trim()) < schema.indexOf(productionPaymentsMigration.trim()), "Managed billing must precede production payments");
  assert.ok(schema.includes(operatorPaymentMigration.trim()), "Canonical schema must include the exact operator-managed payment migration");
  assert.ok(schema.includes(customerAllowanceMigration.trim()), "Canonical schema must include the exact customer allowance migration");
  assert.ok(schema.includes(creativeIntentMigration.trim()), "Canonical schema must include the exact creative generation intent migration");
  assert.ok(schema.includes(creativeReconcileMigration.trim()), "Canonical schema must include the exact creative reconciliation migration");
  assert.ok(schema.includes(configurablePaymentMigration.trim()), "Canonical schema must include the exact configurable pricing migration");
  assert.ok(schema.trimEnd().endsWith(productRollupMigration.trimEnd()), "Canonical schema must end with the exact product rollup migration");
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