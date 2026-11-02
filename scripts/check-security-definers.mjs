import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const authenticatedSignatures = new Set([
  "public.business_transfer_claim(uuid)",
  "public.business_transfer_decline(uuid)",
  "public.business_transfer_mine()",
  "public.change_declared_preferences(uuid, text, bigint, text, text)",
  "public.delete_campaign_draft_if_version(uuid, bigint)",
  "public.owner_alert_prefs_set(uuid, boolean, boolean, text)",
  "public.owner_alert_start_verification(uuid)",
  "public.update_campaign_draft_if_version(uuid, uuid, uuid, bigint, jsonb, timestamp with time zone)",
]);

async function definerViolations(db) {
  const { rows } = await db.query(`
    select format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature,
      p.proconfig is distinct from array['search_path=""']::text[] as bad_path,
      exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE') as public_execute,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
    order by signature
  `);
  const violations = rows.flatMap((row) => {
    const reasons = [];
    if (row.bad_path) reasons.push("search_path");
    if (row.public_execute) reasons.push("PUBLIC");
    if (row.anon_execute) reasons.push("anon");
    if (row.authenticated_execute && !authenticatedSignatures.has(row.signature)) reasons.push("authenticated");
    return reasons.length ? [{ signature: row.signature, reasons }] : [];
  });
  for (const signature of authenticatedSignatures) {
    if (!rows.some((row) => row.signature === signature && row.authenticated_execute)) {
      violations.push({ signature, reasons: ["missing authenticated EXECUTE"] });
    }
  }
  return violations;
}

export async function securityDefinerPrivileges(db) {
  return (await db.query(`
    select format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature,
      p.proowner, p.proacl::text as acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not (n.nspname = 'private' and p.proname in
        ('creative_generation_reconciliation_guard', 'creative_generation_settled_write_guard')
        and p.pronargs = 0)
    order by signature
  `)).rows;
}

export async function verifySecurityDefiners(db, database, check) {
  await check(`${database}: every SECURITY DEFINER has an empty search path and only intended browser grants (#674)`, async () => {
    assert.deepEqual(await definerViolations(db), []);
  });

  await check(`${database}: the SECURITY DEFINER guard detects path, PUBLIC, anon and unexpected authenticated grants`, async () => {
    await db.query("begin");
    try {
      await db.query(`
        create function private.definer_fixture_path() returns integer
          language sql security definer set search_path = public as $$ select 1 $$;
        revoke all on function private.definer_fixture_path() from public, anon, authenticated;
        create function private.definer_fixture_extra_config() returns integer
          language sql security definer set search_path = '' set statement_timeout = '5s' as $$ select 1 $$;
        revoke all on function private.definer_fixture_extra_config() from public, anon, authenticated;
        create function public.definer_fixture_public() returns integer
          language sql security definer set search_path = '' as $$ select 1 $$;
        grant execute on function public.definer_fixture_public() to public;
        create function public.definer_fixture_anon() returns integer
          language sql security definer set search_path = '' as $$ select 1 $$;
        revoke all on function public.definer_fixture_anon() from public, anon, authenticated;
        grant execute on function public.definer_fixture_anon() to anon;
        create function public.business_transfer_mine(integer) returns integer
          language sql security definer set search_path = '' as $$ select 1 $$;
        revoke all on function public.business_transfer_mine(integer) from public, anon, authenticated;
        grant execute on function public.business_transfer_mine(integer) to authenticated;
        create function public.definer_fixture_service() returns integer
          language sql security definer set search_path = '' as $$ select 1 $$;
        revoke all on function public.definer_fixture_service() from public, anon, authenticated;
        grant execute on function public.definer_fixture_service() to service_role;
        create function public.definer_fixture_invoker() returns integer
          language sql security invoker set search_path = public as $$ select 1 $$;
        grant execute on function public.definer_fixture_invoker() to public;
      `);
      const bySignature = new Map((await definerViolations(db)).map((row) => [row.signature, row.reasons]));
      assert.deepEqual(bySignature.get("private.definer_fixture_path()"), ["search_path"]);
      assert.deepEqual(bySignature.get("private.definer_fixture_extra_config()"), ["search_path"]);
      assert.deepEqual(bySignature.get("public.definer_fixture_public()"), ["PUBLIC", "anon", "authenticated"]);
      assert.deepEqual(bySignature.get("public.definer_fixture_anon()"), ["anon"]);
      assert.deepEqual(bySignature.get("public.business_transfer_mine(integer)"), ["authenticated"]);
      assert.equal(bySignature.has("public.definer_fixture_service()"), false);
      assert.equal(bySignature.has("public.definer_fixture_invoker()"), false);
      assert.equal(bySignature.has("public.business_transfer_mine()"), false);
      await db.query("revoke execute on function public.business_transfer_mine() from authenticated");
      const missingAllowed = (await definerViolations(db)).find((row) => row.signature === "public.business_transfer_mine()");
      assert.deepEqual(missingAllowed.reasons, ["missing authenticated EXECUTE"]);
    } finally {
      await db.query("rollback");
    }
  });

  await check(`${database}: hardened trigger, preference, limiter, audit and Meta RPCs still work`, async () => {
    const owner = randomUUID(), otherOwner = randomUUID(), business = randomUUID(), token = randomUUID();
    const attempt = randomUUID(), retryAttempt = randomUUID(), cancelAttempt = randomUUID();
    await db.query("begin");
    try {
      await db.query("insert into auth.users(id,email) values ($1,'definer-fixture@example.invalid')", [owner]);
      await db.query("insert into auth.users(id,email) values ($1,'definer-other@example.invalid')", [otherOwner]);
      assert.equal((await db.query("select count(*)::int as count from public.profiles where id=$1", [owner])).rows[0].count, 1);
      await db.query("insert into public.businesses(id,owner_id,name) values ($1,$2,'Definer fixture')", [business, owner]);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
      await db.query("set local role authenticated");
      assert.equal(Number((await db.query("select public.change_declared_preferences($1,'enable',0) as epoch", [business])).rows[0].epoch), 1);
      assert.equal(Number((await db.query("select public.change_declared_preferences($1,'save',1,'tone','Warm') as epoch", [business])).rows[0].epoch), 2);
      assert.equal(Number((await db.query("select public.change_declared_preferences($1,'save',2,'tone','Friendly') as epoch", [business])).rows[0].epoch), 3);
      const preference = (await db.query("select value,version from public.declared_preferences where business_id=$1", [business])).rows[0];
      assert.deepEqual({ value: preference.value, version: Number(preference.version) }, { value: "Friendly", version: 2 });
      const draft = (await db.query("insert into public.campaign_drafts(business_id,owner_id,input) values ($1,$2,'{}') returning id", [business, owner])).rows[0].id;
      assert.equal(Number((await db.query("select version from public.update_campaign_draft_if_version($1,$2,$3,1,'{}')", [draft, business, owner])).rows[0].version), 2);
      assert.equal((await db.query("select * from public.delete_campaign_draft_if_version($1,1)", [draft])).rowCount, 0);
      assert.equal((await db.query("select * from public.delete_campaign_draft_if_version($1,2)", [draft])).rowCount, 1);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [otherOwner]);
      await db.query("savepoint wrong_owner");
      await assert.rejects(db.query("select public.change_declared_preferences($1,'save',3,'tone','Wrong owner')", [business]), { code: "42501" });
      await db.query("rollback to savepoint wrong_owner");
      await db.query("set local role anon");
      await db.query("savepoint anonymous_rpc");
      await assert.rejects(db.query("select public.meta_attempt_get($1,$2)", [attempt, owner]), { code: "42501" });
      await db.query("rollback to savepoint anonymous_rpc");

      await db.query("set local role service_role");
      assert.equal((await db.query("select allowed from public.check_rate_limit($1,3,60000)", [`definer:${attempt}`])).rows[0].allowed, true);
      assert.ok((await db.query("select public.append_verified_audit_event($1,$2,'campaign.refresh','campaign') as id", [business, owner])).rows[0].id);
      await db.query(`select public.meta_token_insert($1,$2,$3,$4,'user',$5,$6,$7,'k1','v1',
        array['ads_management'],'[]'::jsonb,null,now(),null)`,
      [token, business, owner, `subject:${attempt}`, "\\x01", `\\x${"00".repeat(12)}`, `\\x${"00".repeat(16)}`]);
      const createAttempt = async (id, generation = 0) => (await db.query(`select public.meta_attempt_create($1,$2,$3,$4,'binding','authorizing','{}'::jsonb,$5,
        now() + interval '1 hour') as id`, [id, business, owner, `state:${id}`, generation])).rows[0].id;
      assert.equal(await createAttempt(attempt), attempt);
      assert.equal((await db.query("select attempt_id from public.meta_attempt_claim($1,$2,'binding')", [`state:${attempt}`, owner])).rows[0].attempt_id, attempt);
      assert.equal((await db.query("select id from public.meta_attempt_get($1,$2)", [attempt, owner])).rows[0].id, attempt);
      assert.equal((await db.query("select public.meta_attempt_set_discovering($1,false) as ok", [attempt])).rows[0].ok, true, "start discovery");
      assert.equal((await db.query("select public.meta_attempt_attach_token($1,$2) as ok", [attempt, token])).rows[0].ok, true, "attach token");
      const discovery = { complete: true, candidates: [{ pairId: "fixture-pair", eligible: true, assets: {
        metaBusinessId: "fixture-business", adAccountId: "fixture-account", pageId: "fixture-page", currency: "INR",
      } }] };
      assert.equal((await db.query("select public.meta_attempt_discovery_result($1,$2,'selection_required',null) as ok", [attempt, discovery])).rows[0].ok, true, "save discovery");
      assert.equal((await db.query("select public.meta_attempt_commit_selection($1,$2,'fixture-pair',2,true) as ok", [attempt, owner])).rows[0].ok, true, "commit selection");
      assert.equal(await createAttempt(retryAttempt, 1), retryAttempt);
      assert.equal((await db.query("select public.meta_attempt_set_discovering($1,false) as ok", [retryAttempt])).rows[0].ok, true, "start retry discovery");
      assert.equal((await db.query("select public.meta_attempt_action_required($1,'{}'::jsonb) as ok", [retryAttempt])).rows[0].ok, true, "mark action required");
      assert.equal((await db.query("select public.meta_attempt_retry_claim($1,$2,2) as ok", [retryAttempt, owner])).rows[0].ok, true, "claim retry");
      assert.equal((await db.query("select public.meta_attempt_failed($1,'fixture') as ok", [retryAttempt])).rows[0].ok, true, "mark failed");
      assert.equal(await createAttempt(cancelAttempt), cancelAttempt);
      assert.equal((await db.query("select public.meta_attempt_cancelled($1) as ok", [cancelAttempt])).rows[0].ok, true, "cancel attempt");
      assert.equal((await db.query("select public.meta_revoke_subject($1) as affected", [`subject:${attempt}`])).rows[0].affected, 1);
      assert.equal((await db.query("select authorization_status from public.meta_connections where business_id=$1", [business])).rows[0].authorization_status, "revoked");
      assert.equal((await db.query("select public.meta_disconnect($1,$2) as disconnected", [business, owner])).rows[0].disconnected, true);
      assert.equal((await db.query("select status from public.meta_attempt_get($1,$2)", [retryAttempt, owner])).rows[0].status, "cancelled");
    } finally {
      await db.query("rollback");
    }
  });
}
