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

async function verify(database, source, integrityMigration) {
  const admin = client();
  await admin.connect();
  await admin.query(`create database ${database}`);
  await admin.end();
  const db = client(database);
  await db.connect();
  try {
    await db.query(bootstrap);
    await db.query(source);
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
    if (process.argv.includes("--leads-only")) return;

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
  const legacyLead = `insert into auth.users (id, email) values ('30000000-0000-4000-8000-000000000001', 'legacy@example.invalid');
    insert into public.businesses (id, owner_id, name) values ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Legacy fixture');
    insert into public.leads (business_id, meta_lead_id, full_name) values ('30000000-0000-4000-8000-000000000002', 'legacy-follow-up', 'Legacy enquiry');`;
  const testPaymentsMigration = await readFile(join(root, "db/migrations/20260926_razorpay_test_orders.sql"), "utf8");
  const integrityMigration = await readFile(join(root, "db/migrations/20260926_campaign_integrity.sql"), "utf8");
  const draftAuthorityMigration = await readFile(join(root, "db/migrations/20260926_draft_authority.sql"), "utf8");
  const trustedCampaignMigration = await readFile(join(root, "db/migrations/20260926_trusted_campaign_writes.sql"), "utf8");
  await verify("fresh_install", `${schema}\n${trustedUsageMigration}\n${productEventsMigration}\n${whatsappMigration}\n${billingMigration}\n${billingEventsMigration}\n${testPaymentsMigration}`);
  await verify("ordered_upgrade", `${baseline}\n${metaMigration}\n${campaignMigration}\n${trustedUsageMigration}\n${trustedUsageMigration}\n${productEventsMigration}\n${productEventsMigration}\n${whatsappMigration}\n${whatsappMigration}\n${reportingMigration}\n${reportingMigration}\n${workerMigration}\n${workerMigration}\n${billingMigration}\n${billingMigration}\n${billingEventsMigration}\n${billingEventsMigration}\n${testPaymentsMigration}\n${testPaymentsMigration}\n${draftAuthorityMigration}\n${trustedCampaignMigration}\n${legacyLead}\n${leadFollowUpMigration}\n${leadFollowUpMigration}`, integrityMigration);
} catch (error) {
  failures.push("database harness");
  console.error(`FAIL database harness: ${error.message}`);
} finally {
  if (started) execFileSync(join(bin, "pg_ctl"), ["-D", cluster, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
  await rm(directory, { recursive: true, force: true });
}

console.log(`Isolated PostgreSQL verification: ${failures.length ? `${failures.length} failure(s)` : "PASS"}. No remote database used.`);
process.exitCode = failures.length ? 1 : 0;