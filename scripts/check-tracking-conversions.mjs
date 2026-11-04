import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendedMigrations, buildSchema, readBaseSchema } from "./build-schema.mjs";
import { applyMigration, migrationChecksum } from "./database-migrations.mjs";

const migrationName = "20261105_tracking_conversions.sql";
const previousBase = "354e6128dfc9fe03382966f86d25b5e6e5b65a9c";
const tables = ["businesses", "campaigns", "campaign_results", "ad_results"];

async function database(client, bootstrap, name, source) {
  const admin = client();
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const db = client(name);
  await db.connect();
  try {
    await db.query(bootstrap);
    await db.query(source);
    return db;
  } catch (error) {
    await db.end();
    throw error;
  }
}

async function fixture(db) {
  const owner = randomUUID(), other = randomUUID();
  const business = randomUUID(), otherBusiness = randomUUID();
  const campaign = randomUUID(), otherCampaign = randomUUID();
  const result = randomUUID(), otherResult = randomUUID();
  const ad = randomUUID(), otherAd = randomUUID();
  await db.query("insert into auth.users(id) values ($1), ($2)", [owner, other]);
  await db.query(
    "insert into public.businesses(id,owner_id,name) values ($1,$2,'Tracking one'),($3,$4,'Tracking two')",
    [business, owner, otherBusiness, other],
  );
  await db.query(
    "insert into public.campaigns(id,business_id,objective,destination,daily_budget) values ($1,$2,'traffic','website',300),($3,$4,'leads','whatsapp',250)",
    [campaign, business, otherCampaign, otherBusiness],
  );
  await db.query(
    "insert into public.campaign_results(id,campaign_id,destination,impressions,clicks,leads,spend) values ($1,$2,'website',101,7,3,28.50),($3,$4,'whatsapp',33,4,2,12.25)",
    [result, campaign, otherResult, otherCampaign],
  );
  await db.query(
    "insert into public.ad_results(id,business_id,campaign_id,meta_ad_id,delivered,impressions,link_clicks,leads,spend_paise) values ($1,$2,$3,'17',true,101,7,3,2850),($4,$5,$6,'18',true,33,4,2,1225)",
    [ad, business, campaign, otherAd, otherBusiness, otherCampaign],
  );
  return { owner, other, business, otherBusiness, campaign, otherCampaign, result, otherResult, ad, otherAd };
}

async function savedRows(db, ids, withoutNewColumns) {
  const { rows } = await db.query(
    `select
       to_jsonb(b) ${withoutNewColumns ? "- 'meta_pixel_id'" : ""} as business,
       to_jsonb(c) ${withoutNewColumns ? "- 'meta_pixel_id'" : ""} as campaign,
       to_jsonb(r) ${withoutNewColumns ? "- 'conversions' - 'conversion_value'" : ""} as result,
       to_jsonb(a) ${withoutNewColumns ? "- 'conversions' - 'conversion_value'" : ""} as ad
     from public.businesses b
     join public.campaigns c on c.business_id=b.id
     join public.campaign_results r on r.campaign_id=c.id
     join public.ad_results a on a.campaign_id=c.id
     where b.id=$1 and c.id=$2 and r.id=$3 and a.id=$4`,
    [ids.business, ids.campaign, ids.result, ids.ad],
  );
  assert.equal(rows.length, 1);
  return rows[0];
}

async function securityState(db) {
  const relations = await db.query(
    `select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname=any($1::text[]) order by c.relname`,
    [tables],
  );
  const columns = await db.query(
    `select c.relname,a.attname,a.attacl::text
     from pg_attribute a join pg_class c on c.oid=a.attrelid
     join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname=any($1::text[]) and a.attnum>0 and not a.attisdropped
       and a.attname not in ('meta_pixel_id','conversions','conversion_value')
     order by c.relname,a.attname`,
    [tables],
  );
  const policies = await db.query(
    `select tablename,policyname,permissive,roles,cmd,qual,with_check
     from pg_policies where schemaname='public' and tablename=any($1::text[])
     order by tablename,policyname`,
    [tables],
  );
  return { relations: relations.rows, columns: columns.rows, policies: policies.rows };
}

async function assertConstraints(db, ids) {
  for (const [table, id] of [["campaign_results", ids.result], ["ad_results", ids.ad]]) {
    await db.query(
      `update public.${table} set conversions=$1,conversion_value=$2 where id=$3`,
      ["9007199254740991", "999999999999.99", id],
    );
    for (const value of ["-1", "9007199254740992"]) {
      await assert.rejects(db.query(`update public.${table} set conversions=$1 where id=$2`, [value, id]), { code: "23514" });
    }
    await assert.rejects(db.query(`update public.${table} set conversions=null where id=$1`, [id]), { code: "23502" });
    for (const value of ["-0.01", "NaN"]) {
      await assert.rejects(db.query(`update public.${table} set conversion_value=$1 where id=$2`, [value, id]), { code: "23514" });
    }
    await assert.rejects(
      db.query(`update public.${table} set conversion_value=$1 where id=$2`, ["1000000000000", id]),
      { code: "22003" },
    );
    await db.query(`update public.${table} set conversion_value=null where id=$1`, [id]);
    assert.equal((await db.query(`select conversion_value from public.${table} where id=$1`, [id])).rows[0].conversion_value, null);
  }
}

async function assertTenantAccess(client, databaseName, ids) {
  const session = client(databaseName);
  await session.connect();
  try {
    await session.query("set role authenticated");
    await session.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.owner]);
    assert.deepEqual((await session.query("select id from public.businesses order by id")).rows, [{ id: ids.business }]);
    assert.deepEqual((await session.query("select id from public.campaigns order by id")).rows, [{ id: ids.campaign }]);
    assert.deepEqual((await session.query("select id from public.campaign_results order by id")).rows, [{ id: ids.result }]);
    assert.deepEqual((await session.query("select id from public.ad_results order by id")).rows, [{ id: ids.ad }]);
    assert.equal((await session.query("update public.businesses set meta_pixel_id='pixel-owner' where id=$1", [ids.business])).rowCount, 1);
    assert.equal((await session.query("update public.businesses set meta_pixel_id='pixel-owner' where id=$1", [ids.otherBusiness])).rowCount, 0);
    await assert.rejects(session.query("update public.campaigns set meta_pixel_id='pixel-owner' where id=$1", [ids.campaign]), { code: "42501" });
    await assert.rejects(session.query("update public.campaign_results set conversions=1 where id=$1", [ids.result]), { code: "42501" });
    await assert.rejects(session.query("update public.ad_results set conversions=1 where id=$1", [ids.ad]), { code: "42501" });
    await session.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.other]);
    assert.equal((await session.query("update public.businesses set meta_pixel_id='pixel-other' where id=$1", [ids.business])).rowCount, 0);
    assert.deepEqual((await session.query("select id from public.campaign_results order by id")).rows, [{ id: ids.otherResult }]);
    assert.deepEqual((await session.query("select id from public.ad_results order by id")).rows, [{ id: ids.otherAd }]);
  } finally {
    await session.end();
  }
}

async function trackingColumns(db) {
  return (await db.query(
    `select table_name,column_name from information_schema.columns
     where table_schema='public' and table_name=any($1::text[])
       and column_name in ('meta_pixel_id','conversions','conversion_value')
     order by table_name,column_name`,
    [tables],
  )).rows;
}

async function ledgerEntryCount(db, name) {
  const exists = (await db.query("select to_regclass('private.schema_migrations') is not null as present")).rows[0].present;
  if (!exists) return 0;
  return (await db.query("select count(*)::int as count from private.schema_migrations where name=$1", [name])).rows[0].count;
}

export async function verifyTrackingConversions({ client, bootstrap, check, root }) {
  const path = join(root, "db/migrations", migrationName);
  assert.ok(existsSync(path), `${migrationName} must exist`);
  const migration = await readFile(path, "utf8");
  const freshSchema = buildSchema(root);
  assert.ok(freshSchema.includes(migration.trim()), "Fresh schema must include the exact tracking migration");
  const oldBase = execFileSync("git", ["show", `${previousBase}:db/schema.sql`], { cwd: root, encoding: "utf8" });
  const earlier = await Promise.all(appendedMigrations(root).filter((name) => name < migrationName)
    .map((name) => readFile(join(root, "db/migrations", name), "utf8")));
  const previousSchema = [oldBase, ...earlier].join("\n\n");

  const base = await database(client, bootstrap, "tracking_base", readBaseSchema(root));
  try {
    await check("tracking: base schema exposes the requested fields on its existing tables", async () => {
      assert.deepEqual(await trackingColumns(base), [
        { table_name: "businesses", column_name: "meta_pixel_id" },
        { table_name: "campaign_results", column_name: "conversion_value" },
        { table_name: "campaign_results", column_name: "conversions" },
        { table_name: "campaigns", column_name: "meta_pixel_id" },
      ]);
    });
  } finally {
    await base.end();
  }

  const upgrade = await database(client, bootstrap, "tracking_upgrade", previousSchema);
  try {
    const ids = await fixture(upgrade);
    const before = await savedRows(upgrade, ids, false);
    const otherIds = { business: ids.otherBusiness, campaign: ids.otherCampaign, result: ids.otherResult, ad: ids.otherAd };
    const otherBefore = await savedRows(upgrade, otherIds, false);
    const beforeSecurity = await securityState(upgrade);
    assert.deepEqual(await trackingColumns(upgrade), [], "Upgrade fixture must predate the new fields");

    await check("tracking: concurrent upgrades serialize and retain the exact ledger checksum", async () => {
      const peer = client("tracking_upgrade");
      await peer.connect();
      try {
        const results = await Promise.all([
          applyMigration(upgrade, migrationName, migration),
          applyMigration(peer, migrationName, migration),
        ]);
        assert.deepEqual(results.sort(), ["already_applied", "applied"]);
      } finally {
        await peer.end();
      }
      assert.equal((await upgrade.query("select checksum from private.schema_migrations where name=$1", [migrationName])).rows[0].checksum, migrationChecksum(migration));
      assert.equal(await applyMigration(upgrade, migrationName, migration), "already_applied");
      await assert.rejects(applyMigration(upgrade, migrationName, `${migration}\n-- checksum changed`), /checksum changed/);
    });
    await check("tracking: old rows survive with zero counts and unknown values", async () => {
      assert.deepEqual(await savedRows(upgrade, ids, true), before);
      assert.deepEqual(await savedRows(upgrade, otherIds, true), otherBefore);
      const { rows } = await upgrade.query(
        `select b.meta_pixel_id as business_pixel,c.meta_pixel_id as campaign_pixel,
          r.conversions::text as campaign_count,r.conversion_value::text as campaign_value,
          a.conversions::text as ad_count,a.conversion_value::text as ad_value
         from public.businesses b join public.campaigns c on c.business_id=b.id
         join public.campaign_results r on r.campaign_id=c.id
         join public.ad_results a on a.campaign_id=c.id
         where b.id=$1 and c.id=$2 and r.id=$3 and a.id=$4`,
        [ids.business, ids.campaign, ids.result, ids.ad],
      );
      assert.deepEqual(rows[0], {
        business_pixel: null, campaign_pixel: null,
        campaign_count: "0", campaign_value: null, ad_count: "0", ad_value: null,
      });
    });
    await check("tracking: policies, table grants and existing column grants are unchanged", async () => {
      assert.deepEqual(await securityState(upgrade), beforeSecurity);
      await assertTenantAccess(client, "tracking_upgrade", ids);
    });
    await check("tracking: both tables enforce safe counts and finite non-negative values", async () => {
      await assertConstraints(upgrade, ids);
      await upgrade.query("update public.campaigns set objective='sales',meta_pixel_id='pixel-fixture' where id=$1", [ids.campaign]);
      await upgrade.query("update public.businesses set meta_pixel_id='pixel-fixture' where id=$1", [ids.business]);
      assert.deepEqual((await upgrade.query("select objective,meta_pixel_id from public.campaigns where id=$1", [ids.campaign])).rows[0],
        { objective: "sales", meta_pixel_id: "pixel-fixture" });
      const saved = await savedRows(upgrade, ids, false);
      await upgrade.query("begin");
      try {
        await upgrade.query(migration);
        await upgrade.query("commit");
      } catch (error) {
        await upgrade.query("rollback");
        throw error;
      }
      assert.deepEqual(await savedRows(upgrade, ids, false), saved, "A direct repeat must not change stored data");
    });
  } finally {
    await upgrade.end();
  }

  const fresh = await database(client, bootstrap, "tracking_fresh", freshSchema);
  try {
    const ids = await fixture(fresh);
    await check("tracking: fresh installs enforce the same data and tenant boundaries", async () => {
      await assertConstraints(fresh, ids);
      await fresh.query("update public.campaigns set objective='sales' where id=$1", [ids.campaign]);
      assert.equal((await fresh.query("select objective from public.campaigns where id=$1", [ids.campaign])).rows[0].objective, "sales");
      await assertTenantAccess(client, "tracking_fresh", ids);
    });
  } finally {
    await fresh.end();
  }

  const failed = await database(client, bootstrap, "tracking_failure", previousSchema);
  try {
    await check("tracking: incompatible pre-existing columns fail without partial changes", async () => {
      await failed.query("alter table public.ad_results add column conversions integer not null default 0");
      await assert.rejects(applyMigration(failed, migrationName, migration), /incompatible.*ad_results.*conversions/i);
      assert.deepEqual(await trackingColumns(failed), [{ table_name: "ad_results", column_name: "conversions" }]);
      assert.equal(await ledgerEntryCount(failed, migrationName), 0);
      await failed.query("alter table public.ad_results drop column conversions");
    });
    await check("tracking: failed SQL rolls back every new column and its ledger entry", async () => {
      const name = "20261105_tracking_failure.sql";
      await assert.rejects(applyMigration(failed, name, `${migration}\nselect 1 / 0;`), { code: "22012" });
      assert.deepEqual(await trackingColumns(failed), []);
      assert.equal(await ledgerEntryCount(failed, name), 0);
    });
  } finally {
    await failed.end();
  }
}
