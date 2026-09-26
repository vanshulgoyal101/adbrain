import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { databaseConfig } from "./database-migrations.mjs";

const queries = {
  identity: `select current_database() as database, current_user as role,
    current_setting('server_version') as version,
    current_setting('transaction_read_only') as read_only,
    inet_server_addr()::text as server_address, inet_server_port() as server_port`,
  schema_privileges: `select namespace.nspname as schema,role.rolname as role,
    has_schema_privilege(role.oid,namespace.oid,'USAGE') as can_use,
    has_schema_privilege(role.oid,namespace.oid,'CREATE') as can_create
    from pg_namespace namespace cross join pg_roles role
    where namespace.nspname in ('public','private','storage')
    and role.rolname in ('anon','authenticated','service_role') order by 1,2`,
  tables: `select namespace.nspname as schema, relation.relname as name,
    relation.relkind as kind, relation.relrowsecurity as rls,
    relation.relforcerowsecurity as force_rls, owner.rolname as owner
    from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
    join pg_roles owner on owner.oid=relation.relowner
    where namespace.nspname in ('public','private','storage') and relation.relkind in ('r','p','v','m','S')
    order by 1,2`,
  columns: `select table_schema,table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,
    md5(coalesce(column_default,'')) as default_hash
    from information_schema.columns where table_schema in ('public','private','storage') order by 1,2,4`,
  policies: `select schemaname,tablename,policyname,permissive,roles,cmd,
    md5(coalesce(qual,'')) as using_hash,md5(coalesce(with_check,'')) as check_hash
    from pg_policies where schemaname in ('public','private','storage') order by 1,2,3`,
  constraints: `select namespace.nspname as schema,relation.relname as table_name,
    constraint_row.conname as name,constraint_row.contype as type,constraint_row.convalidated as validated,
    md5(pg_get_constraintdef(constraint_row.oid)) as definition_hash
    from pg_constraint constraint_row join pg_class relation on relation.oid=constraint_row.conrelid
    join pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname in ('public','private','storage') order by 1,2,3`,
  indexes: `select namespace.nspname as schema,relation.relname as table_name,index_relation.relname as name,
    index_row.indisvalid as valid,index_row.indisready as ready,index_row.indisunique as unique_index,
    md5(pg_get_indexdef(index_row.indexrelid)) as definition_hash
    from pg_index index_row join pg_class relation on relation.oid=index_row.indrelid
    join pg_class index_relation on index_relation.oid=index_row.indexrelid
    join pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname in ('public','private','storage') order by 1,2,3`,
  table_privileges: `select namespace.nspname as schema,relation.relname as name,role.rolname as role,
    has_table_privilege(role.oid,relation.oid,'SELECT') as can_select,
    has_table_privilege(role.oid,relation.oid,'INSERT') as can_insert,
    has_table_privilege(role.oid,relation.oid,'UPDATE') as can_update,
    has_table_privilege(role.oid,relation.oid,'DELETE') as can_delete,
    has_table_privilege(role.oid,relation.oid,'TRUNCATE') as can_truncate
    from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join pg_roles role where namespace.nspname in ('public','private','storage')
    and relation.relkind in ('r','p','v') and role.rolname in ('anon','authenticated','service_role') order by 1,2,3`,
  functions: `select namespace.nspname as schema,function_row.proname as name,
    pg_get_function_identity_arguments(function_row.oid) as arguments,
    function_row.prosecdef as security_definer,owner.rolname as owner,
    array(select setting from unnest(function_row.proconfig) setting where setting like 'search_path=%') as search_path,
    md5(pg_get_functiondef(function_row.oid)) as definition_hash,
    array(select role.rolname from pg_roles role where role.rolname in ('anon','authenticated','service_role')
      and has_function_privilege(role.oid,function_row.oid,'EXECUTE') order by role.rolname) as executable_by
    from pg_proc function_row join pg_namespace namespace on namespace.oid=function_row.pronamespace
    join pg_roles owner on owner.oid=function_row.proowner
    where namespace.nspname in ('public','private','storage') and function_row.prokind in ('f','p') order by 1,2,3`,
  default_privileges: `select owner.rolname as owner,namespace.nspname as schema,acl.defaclobjtype as object_type,
    acl.defaclacl::text as privileges from pg_default_acl acl
    join pg_roles owner on owner.oid=acl.defaclrole left join pg_namespace namespace on namespace.oid=acl.defaclnamespace
    order by 1,2,3`,
  column_privileges: `select namespace.nspname as schema,relation.relname as table_name,
    attribute.attname as column_name,attribute.attacl::text as privileges
    from pg_attribute attribute join pg_class relation on relation.oid=attribute.attrelid
    join pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname in ('public','private','storage') and attribute.attacl is not null
    and not attribute.attisdropped order by 1,2,3`,
  sequence_privileges: `select namespace.nspname as schema,relation.relname as name,role.rolname as role,
    has_sequence_privilege(role.oid,relation.oid,'USAGE') as can_use,
    has_sequence_privilege(role.oid,relation.oid,'UPDATE') as can_update
    from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join pg_roles role where namespace.nspname in ('public','private','storage') and relation.relkind='S'
    and role.rolname in ('anon','authenticated','service_role') order by 1,2,3`,
  triggers: `select namespace.nspname as schema,relation.relname as table_name,trigger_row.tgname as name,
    trigger_row.tgenabled as enabled,md5(pg_get_triggerdef(trigger_row.oid)) as definition_hash
    from pg_trigger trigger_row join pg_class relation on relation.oid=trigger_row.tgrelid
    join pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname in ('public','private','storage') and not trigger_row.tgisinternal order by 1,2,3`,
  role_flags: `select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls
    from pg_roles where rolname in ('anon','authenticated','service_role','authenticator') order by 1`,
  memberships: `select member.rolname as member,granted.rolname as granted_role
    from pg_auth_members membership join pg_roles member on member.oid=membership.member
    join pg_roles granted on granted.oid=membership.roleid order by 1,2`,
  exposed_schema_settings: `select role.rolname as role,setting from pg_db_role_setting settings
    left join pg_roles role on role.oid=settings.setrole cross join lateral unnest(settings.setconfig) setting
    where setting like 'pgrst.db_schemas=%' or setting like 'pgrst.db_extra_search_path=%' order by 1,2`,
};

export async function collectCatalog(client) {
  const report = { captured_at: new Date().toISOString(), scope: "catalog metadata only", sections: {} };
  await client.query("begin read only");
  try {
    await client.query("set local statement_timeout = '10s'");
    await client.query("set local lock_timeout = '2s'");
    for (const [name, sql] of Object.entries(queries)) {
      report.sections[name] = (await client.query(sql)).rows;
    }
    const { rows } = await client.query("select to_regclass('private.schema_migrations') as ledger, to_regclass('storage.buckets') as buckets");
    const migrations = rows[0].ledger
      ? (await client.query("select name,checksum,applied_at from private.schema_migrations order by name")).rows
      : null;
    const storageBuckets = rows[0].buckets
      ? (await client.query("select id,public,file_size_limit,allowed_mime_types from storage.buckets order by id")).rows
      : null;
    return { ...report, sections: { ...report.sections, migrations, storage_buckets: storageBuckets } };
  } finally {
    await client.query("rollback");
  }
}

async function main() {
  const { values } = parseArgs({ options: { target: { type: "string" }, output: { type: "string" } } });
  const config = databaseConfig(process.env, { target: values.target });
  const client = new pg.Client({ ...config, application_name: "adbrain-readonly-catalog" });
  try {
    await client.connect();
    const report = await collectCatalog(client);
    const json = JSON.stringify(report, null, 2);
    if (values.output) {
      await writeFile(values.output, `${json}\n`, { mode: 0o600, flag: "wx" });
      console.log(JSON.stringify({ readOnly: true, sections: Object.keys(report.sections), outputWritten: true }));
    } else console.log(json);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ error: "Catalog inspection failed; no application rows requested.", code: typeof error.code === "string" ? error.code : "INSPECTION_FAILED" }));
    process.exitCode = 1;
  });
}