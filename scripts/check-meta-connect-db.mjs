import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

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
    const ownerId = randomUUID();
    const businessId = randomUUID();
    const draftId = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, 'db-test@example.invalid')", [ownerId]);
    await db.query("insert into public.businesses (id, owner_id, name) values ($1, $2, 'Isolated DB test')", [businessId, ownerId]);
    await db.query("insert into public.campaign_drafts (id, business_id, owner_id, input, expires_at) values ($1, $2, $3, '{}', now() + interval '1 day')", [draftId, businessId, ownerId]);
    await db.query("insert into public.meta_connections (business_id, generation, authorization_status) values ($1, 1, 'connected')", [businessId]);

    const claim = async (key, operationId = randomUUID()) => {
      const session = client(database);
      await session.connect();
      try {
        await session.query("set role service_role");
        return (await session.query(`select * from public.claim_campaign_operation(
          $1, $2, $3, 1, 1, 'campaign_create', $4, $5, now() + interval '1 minute')`,
        [operationId, businessId, draftId, key, "a".repeat(64)])).rows;
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
          and proname in ('claim_campaign_operation', 'checkpoint_campaign_operation', 'finish_campaign_operation')
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
  await verify("fresh_install", schema);
  await verify("ordered_upgrade", `${baseline}\n${metaMigration}\n${campaignMigration}`);
} catch (error) {
  failures.push("database harness");
  console.error(`FAIL database harness: ${error.message}`);
} finally {
  if (started) execFileSync(join(bin, "pg_ctl"), ["-D", cluster, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
  await rm(directory, { recursive: true, force: true });
}

console.log(`Isolated PostgreSQL verification: ${failures.length ? `${failures.length} failure(s)` : "PASS"}. No remote database used.`);
process.exitCode = failures.length ? 1 : 0;