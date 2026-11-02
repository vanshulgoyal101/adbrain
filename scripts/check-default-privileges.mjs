import assert from "node:assert/strict";

async function privileges(db, table, sequence, routine) {
  return (await db.query(`
    with roles(role) as (values ('anon'), ('authenticated'), ('service_role')),
    checks(kind, privilege) as (
      values ('table', 'SELECT'), ('table', 'INSERT'), ('table', 'UPDATE'),
        ('table', 'DELETE'), ('table', 'TRUNCATE'), ('table', 'REFERENCES'),
        ('table', 'TRIGGER'), ('sequence', 'SELECT'), ('sequence', 'UPDATE'),
        ('sequence', 'USAGE'), ('function', 'EXECUTE')
      union all
      select 'table', 'MAINTAIN' where current_setting('server_version_num')::integer >= 170000
    )
    select role, kind, privilege, case kind
      when 'table' then has_table_privilege(role, $1, privilege)
      when 'sequence' then has_sequence_privilege(role, $2, privilege)
      when 'function' then has_function_privilege(role, $3, privilege)
    end as allowed
    from roles cross join checks order by role, kind, privilege
  `, [table, sequence, routine])).rows;
}

async function defaults(db, role) {
  return (await db.query(`
    select coalesce(n.nspname, '') as schema, d.defaclobjtype, d.defaclacl::text as acl
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclrole = $1::regrole order by schema, d.defaclobjtype
  `, [role])).rows;
}

async function functionPrivileges(db, routine) {
  return (await db.query(`
    select role, has_function_privilege(role, $1, 'EXECUTE') as allowed
    from (values ('anon'), ('authenticated'), ('service_role')) as roles(role)
    order by role
  `, [routine])).rows;
}

export async function createDefaultPrivilegeFixtures(db) {
  await db.query(`
    set role postgres;
    create table public.default_privileges_existing_table (id integer);
    create sequence public.default_privileges_existing_sequence;
    create function public.default_privileges_existing_function() returns integer
      language sql as $$ select 1 $$;
    create schema default_privileges_existing_other;
    create function default_privileges_existing_other.helper() returns integer
      language sql as $$ select 1 $$;
    grant usage on schema default_privileges_existing_other to anon, authenticated, service_role;
    reset role;
  `);
  return {
    existing: await privileges(db, "public.default_privileges_existing_table",
      "public.default_privileges_existing_sequence", "public.default_privileges_existing_function()"),
    existingOther: await functionPrivileges(db, "default_privileges_existing_other.helper()"),
    adminDefaults: await defaults(db, "supabase_admin"),
  };
}

export async function verifyDefaultPrivileges(db, database, check, migration, before) {
  try {
    await check(`${database}: new postgres objects require browser grants, preserve service access and existing grants (#2417)`, async () => {
      assert.ok(before.existing.every((row) => row.allowed), "fixture starts with Supabase's existing default grants");
      assert.ok(before.existingOther.every((row) => row.allowed), "the existing other-schema helper starts with PUBLIC execute");
      await db.query(migration);
      const appliedOnce = await defaults(db, "postgres");
      await db.query(migration);
      assert.deepEqual(await defaults(db, "postgres"), appliedOnce, "reapplying the migration is idempotent");
      assert.deepEqual(await defaults(db, "supabase_admin"), before.adminDefaults, "another creator's defaults are untouched");
      assert.deepEqual(await privileges(db, "public.default_privileges_existing_table",
        "public.default_privileges_existing_sequence", "public.default_privileges_existing_function()"),
      before.existing, "privileges on existing objects are unchanged");
      assert.deepEqual(await functionPrivileges(db, "default_privileges_existing_other.helper()"),
        before.existingOther, "the global default change does not change existing other-schema functions");

      await db.query("begin");
      try {
        await db.query(`
          set local role postgres;
          create table public.default_privileges_new_table (id integer);
          create sequence public.default_privileges_new_sequence;
          create function public.default_privileges_new_function() returns integer
            language sql as $$ select 1 $$;
          create function storage.default_privileges_new_function() returns integer
            language sql as $$ select 1 $$;
          grant usage on schema storage to anon, authenticated, service_role;
          create schema default_privileges_other;
          create function default_privileges_other.helper() returns integer
            language sql as $$ select 1 $$;
        `);
        const args = ["public.default_privileges_new_table", "public.default_privileges_new_sequence",
          "public.default_privileges_new_function()"];
        for (const row of await privileges(db, ...args)) {
          assert.equal(row.allowed, row.role === "service_role", `${row.role} ${row.kind} ${row.privilege}`);
        }
        assert.ok((await functionPrivileges(db, "storage.default_privileges_new_function()")).every((row) => row.allowed),
          "explicit defaults for another schema still grant execution");
        for (const role of ["anon", "authenticated", "service_role"]) {
          await db.query(`set local role ${role}`);
          assert.equal((await db.query("select storage.default_privileges_new_function() as result")).rows[0].result, 1);
          assert.equal((await db.query("select default_privileges_existing_other.helper() as result")).rows[0].result, 1);
        }
        await db.query("set local role postgres");
        for (const role of ["anon", "authenticated", "service_role"]) {
          assert.equal((await db.query(`select has_function_privilege($1,
            'default_privileges_other.helper()', 'EXECUTE') as allowed`, [role])).rows[0].allowed, false,
          `the global PUBLIC default no longer grants ${role} execution in another schema`);
        }

        await db.query(`
          grant select on public.default_privileges_new_table to authenticated;
          grant usage on sequence public.default_privileges_new_sequence to authenticated;
          grant execute on function public.default_privileges_new_function() to authenticated;
          grant usage on schema default_privileges_other to authenticated, service_role;
          grant execute on function default_privileges_other.helper() to authenticated, service_role;
        `);
        for (const row of await privileges(db, ...args)) {
          const explicit = row.role === "authenticated" && (
            (row.kind === "table" && row.privilege === "SELECT") ||
            (row.kind === "sequence" && row.privilege === "USAGE") ||
            row.kind === "function"
          );
          assert.equal(row.allowed, row.role === "service_role" || explicit, `${row.role} ${row.kind} ${row.privilege}`);
        }
        for (const role of ["authenticated", "service_role"]) {
          assert.equal((await db.query(`select has_function_privilege($1,
            'default_privileges_other.helper()', 'EXECUTE') as allowed`, [role])).rows[0].allowed, true,
          `an explicit grant restores ${role} access to a helper in another schema`);
          await db.query(`set local role ${role}`);
          assert.equal((await db.query("select public.default_privileges_new_function() as result")).rows[0].result, 1);
          assert.equal((await db.query("select default_privileges_other.helper() as result")).rows[0].result, 1);
        }
        await db.query("set local role postgres");
        await db.query("savepoint denied");
        await db.query("set local role anon");
        await assert.rejects(db.query("select public.default_privileges_new_function()"), { code: "42501" });
        await db.query("rollback to savepoint denied");

        await db.query(`
          set local role supabase_admin;
          create table public.default_privileges_admin_table (id integer);
          create sequence public.default_privileges_admin_sequence;
          create function public.default_privileges_admin_function() returns integer
            language sql as $$ select 1 $$;
        `);
        assert.ok((await privileges(db, "public.default_privileges_admin_table",
          "public.default_privileges_admin_sequence", "public.default_privileges_admin_function()")).every((row) => row.allowed),
        "supabase_admin's separate defaults are outside this migration");
      } finally {
        await db.query("rollback");
      }
    });
  } finally {
    await db.query(`
      drop table public.default_privileges_existing_table;
      drop sequence public.default_privileges_existing_sequence;
      drop function public.default_privileges_existing_function();
      drop function default_privileges_existing_other.helper();
      drop schema default_privileges_existing_other;
    `);
  }
}
