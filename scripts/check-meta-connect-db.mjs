import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { applyMigration } from "./database-migrations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

async function verify(database, source) {
  const admin = client();
  await admin.connect();
  await admin.query(`create database ${database}`);
  await admin.end();
  const db = client(database);
  await db.connect();
  try {
    await db.query(bootstrap);
    await db.query(source);
    console.log(`PASS ${database}: schema executes`);
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

    await check(`${database}: lead sync pages commit atomically, deduplicate and reject foreign/stale bindings`, async () => {
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
        const first = await save(0, [{ meta_lead_id: 'sync-lead', full_name: 'Original' }]);
        assert.equal(first.imported, 1);
        assert.equal(first.run.version, 1);
        await assert.rejects(save(0, [{ meta_lead_id: 'stale-lead' }]), { code: '40001' });
        const duplicate = await save(1, [{ meta_lead_id: 'sync-lead', full_name: 'Overwrite' }]);
        assert.equal(duplicate.imported, 0);
        assert.equal((await session.query("select full_name from public.leads where business_id=$1 and meta_lead_id='sync-lead'", [businessId])).rows[0].full_name, 'Original');
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
      const editable = await db.query("select * from public.update_campaign_draft_if_version($1, $2, $3, 2, '{}')", [draftId, businessId, ownerId]);
      assert.equal(editable.rowCount, 0);
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
  const leadSyncMigration = await readFile(join(root, "db/migrations/20260926_lead_sync_progress.sql"), "utf8");
  await verify("fresh_install", `${schema}\n${trustedUsageMigration}\n${productEventsMigration}\n${whatsappMigration}\n${billingMigration}\n${billingEventsMigration}\n${leadSyncMigration}`);
  await verify("ordered_upgrade", `${baseline}\n${metaMigration}\n${campaignMigration}\n${trustedUsageMigration}\n${trustedUsageMigration}\n${productEventsMigration}\n${productEventsMigration}\n${whatsappMigration}\n${whatsappMigration}\n${reportingMigration}\n${reportingMigration}\n${workerMigration}\n${workerMigration}\n${billingMigration}\n${billingMigration}\n${billingEventsMigration}\n${billingEventsMigration}\n${leadSyncMigration}\n${leadSyncMigration}`);
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