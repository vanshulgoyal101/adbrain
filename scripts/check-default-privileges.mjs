import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { applyMigration, managementMigrationSql } from "./database-migrations.mjs";

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

export async function verifyDefaultPrivilegeLedger(db, check, migration, createClient) {
  const name = "20261102_default_public_privileges.sql";
  await check("default privilege migration and its ledger commit or roll back together", async () => {
    await db.query(`
      create schema private;
      create table private.schema_migrations (
        name text primary key, checksum text not null, applied_at timestamptz not null default now()
      );
      create function private.reject_default_privilege_ledger() returns trigger language plpgsql as $$
        begin raise exception 'intentional ledger failure'; end $$;
    `);
    const before = await defaults(db, "postgres");
    await db.query(managementMigrationSql(name, migration, { commit: false }));
    assert.deepEqual(await defaults(db, "postgres"), before, "the release dry run rolls back default privileges");
    assert.equal((await db.query("select count(*)::int as count from private.schema_migrations where name=$1", [name])).rows[0].count, 0);

    await db.query(`create trigger reject_default_privilege_ledger before insert on private.schema_migrations
      for each row execute function private.reject_default_privilege_ledger()`);
    await assert.rejects(applyMigration(db, name, migration), /intentional ledger failure/);
    assert.deepEqual(await defaults(db, "postgres"), before, "a ledger failure rolls back the migration");
    assert.equal((await db.query("select count(*)::int as count from private.schema_migrations where name=$1", [name])).rows[0].count, 0);

    await db.query("drop trigger reject_default_privilege_ledger on private.schema_migrations");
    assert.equal(await applyMigration(db, name, migration), "applied");
    assert.equal(await applyMigration(db, name, migration), "already_applied");
    await assert.rejects(applyMigration(db, name, `${migration}\n-- changed bytes`), /checksum changed/);
    assert.equal((await db.query("select count(*)::int as count from private.schema_migrations where name=$1", [name])).rows[0].count, 1);
  });

  const wrappedName = "20261103_wrapped_runner_test.sql";
  const wrapped = "-- Original migration bytes\nbegin;\ncreate table public.migration_runner_fixture (id integer);\ncommit;\n";
  const state = async () => (await db.query(`
    select to_regclass('public.migration_runner_fixture')::text as relation,
      (select count(*)::int from private.schema_migrations where name = $1) as ledger_count
  `, [wrappedName])).rows[0];
  const cleanup = async () => {
    await db.query("drop table if exists public.migration_runner_fixture");
    await db.query("delete from private.schema_migrations where name = $1", [wrappedName]);
  };

  await check("wrapped migration and ledger both roll back when the ledger insert fails", async () => {
    await db.query(`create trigger reject_wrapped_ledger before insert on private.schema_migrations
      for each row execute function private.reject_default_privilege_ledger()`);
    try {
      try {
        await assert.rejects(db.query(managementMigrationSql(wrappedName, wrapped, { commit: true })), /intentional ledger failure/);
      } finally {
        await db.query("rollback");
      }
      assert.deepEqual(await state(), { relation: null, ledger_count: 0 }, "Management API SQL rolls back both changes");
      await assert.rejects(applyMigration(db, wrappedName, wrapped), /intentional ledger failure/);
      assert.deepEqual(await state(), { relation: null, ledger_count: 0 }, "CLI rolls back both changes");
    } finally {
      await db.query("drop trigger reject_wrapped_ledger on private.schema_migrations");
      await cleanup();
    }
  });

  await check("wrapped CLI migration stores original checksum, skips repeats and rejects drift", async () => {
    try {
      assert.equal(await applyMigration(db, wrappedName, wrapped), "applied");
      assert.deepEqual(await state(), { relation: "migration_runner_fixture", ledger_count: 1 });
      const { rows } = await db.query("select checksum from private.schema_migrations where name = $1", [wrappedName]);
      assert.equal(rows[0].checksum, createHash("sha256").update(wrapped).digest("hex"));
      assert.equal(await applyMigration(db, wrappedName, wrapped), "already_applied");
      await assert.rejects(applyMigration(db, wrappedName, `${wrapped}-- changed bytes\n`), /checksum changed/);
      assert.deepEqual(await state(), { relation: "migration_runner_fixture", ledger_count: 1 });
    } finally {
      await cleanup();
    }
  });

  await check("wrapped migration retains its advisory lock until the ledger insert", async () => {
    const observer = createClient();
    await observer.connect();
    let checkedInsert = false;
    const checkedClient = {
      async query(statement, parameters) {
        if (statement.startsWith("insert into private.schema_migrations")) {
          const { rows } = await observer.query("select pg_try_advisory_xact_lock(hashtextextended('adbrain:migrations', 0)) as acquired");
          assert.equal(rows[0].acquired, false, "another session cannot take the migration lock before the ledger insert");
          checkedInsert = true;
        }
        return db.query(statement, parameters);
      },
    };
    try {
      assert.equal(await applyMigration(checkedClient, wrappedName, wrapped), "applied");
      assert.equal(checkedInsert, true, "the lock was checked at the ledger boundary");
      const { rows } = await observer.query("select pg_try_advisory_xact_lock(hashtextextended('adbrain:migrations', 0)) as acquired");
      assert.equal(rows[0].acquired, true, "the migration lock is released after commit");
    } finally {
      await observer.end();
      await cleanup();
    }
  });

  await check("Management API SQL preserves wrapped dry-run, commit and repeat behavior", async () => {
    try {
      await db.query(managementMigrationSql(wrappedName, wrapped, { commit: false }));
      assert.deepEqual(await state(), { relation: null, ledger_count: 0 });
      await db.query(managementMigrationSql(wrappedName, wrapped, { commit: true }));
      assert.deepEqual(await state(), { relation: "migration_runner_fixture", ledger_count: 1 });
      const { rows } = await db.query("select checksum from private.schema_migrations where name = $1", [wrappedName]);
      assert.equal(rows[0].checksum, createHash("sha256").update(wrapped).digest("hex"));
      try {
        await assert.rejects(db.query(managementMigrationSql(wrappedName, wrapped, { commit: true })), /already applied/);
      } finally {
        await db.query("rollback");
      }
      assert.deepEqual(await state(), { relation: "migration_runner_fixture", ledger_count: 1 });
    } finally {
      await cleanup();
    }
  });

  await check("wrapped migration with intermediate transaction control is rejected without side effects", async () => {
    const unsafe = "begin;\ncreate table public.migration_runner_fixture (id integer);\ncommit;\nselect 1;\ncommit;\n";
    try {
      await assert.rejects(applyMigration(db, wrappedName, unsafe), /controls its own transaction/);
      assert.deepEqual(await state(), { relation: null, ledger_count: 0 });
    } finally {
      await cleanup();
    }
  });

  await check("transaction-control variants are refused before changing the isolated database", async () => {
    const variants = [
      "begin;\ncreate table public.migration_runner_fixture (id integer);\ncommit",
      "begin;\ncreate table public.migration_runner_fixture (id integer);\ncommit and chain;\n",
      "begin;\ncreate table public.migration_runner_fixture (id integer); commit;\n",
      "begin;\ncreate table public.migration_runner_fixture (id integer);\ncommit;\nselect 1;\n",
    ];
    try {
      for (const sql of variants) {
        await assert.rejects(applyMigration(db, wrappedName, sql), /controls its own transaction/);
        assert.throws(() => managementMigrationSql(wrappedName, sql, { commit: false }), /controls its own transaction/);
        assert.deepEqual(await state(), { relation: null, ledger_count: 0 });
      }
    } finally {
      await cleanup();
    }
  });

  await check("ordinary begin/atomic identifiers cannot hide a transaction commit", async () => {
    const select = "select begin atomic from (select 1 as begin) fixture";
    assert.equal((await db.query(select)).rows[0].atomic, 1);
    try {
      await assert.rejects(applyMigration(db, wrappedName, `${select}; commit;`), /controls its own transaction/);
      assert.deepEqual(await state(), { relation: null, ledger_count: 0 });
    } finally {
      await cleanup();
    }
  });

  await check("quoted procedures and SQL-standard function bodies retain their original semantics", async () => {
    const procedureName = "20261103_runner_procedure.sql";
    const functionName = "20261103_runner_function.sql";
    const procedure = `create procedure public.migration_runner_procedure() language plpgsql as $body$
      begin
        commit;
      end;
      $body$;`;
    const fn = `create function public.migration_runner_answer() returns integer language sql
      begin atomic
        select case when true then 42 else 0 end;
      end;`;
    try {
      assert.equal(await applyMigration(db, procedureName, procedure), "applied");
      const { rows } = await db.query("select prosrc from pg_proc where oid = 'public.migration_runner_procedure()'::regprocedure");
      assert.match(rows[0].prosrc, /\bcommit\s*;/i);
      assert.equal(await applyMigration(db, functionName, fn), "applied");
      assert.equal((await db.query("select public.migration_runner_answer() as answer")).rows[0].answer, 42);
      const dryFunction = fn.replace("public.migration_runner_answer()", "public.migration_runner_dry_answer()");
      await db.query(managementMigrationSql("20261103_management_function.sql", dryFunction, { commit: false }));
      assert.equal((await db.query("select to_regprocedure('public.migration_runner_dry_answer()') as routine")).rows[0].routine, null);
    } finally {
      await db.query("drop procedure if exists public.migration_runner_procedure()");
      await db.query("drop function if exists public.migration_runner_answer()");
      await db.query("delete from private.schema_migrations where name = any($1)", [[procedureName, functionName]]);
    }
  });
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
