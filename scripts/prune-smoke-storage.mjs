// #1891: the core smoke generates ads on every guard run and its images filled the free plan's 1 GB of Storage.
// Deletes the smoke business's own creatives older than --days (default 7) that nothing references (campaigns,
// campaign ads, regeneration claims, drafts, operations), keeping the newest --keep (default 20) so the smoke always
// has ads to pick. Then deletes its unreferenced old files under its own folder via the Storage API.
// Only businesses owned by `smokeUserIds` in src/lib/internal-accounts.json are touched.
//   node scripts/prune-smoke-storage.mjs            dry run: counts and MB only
//   node scripts/prune-smoke-storage.mjs --apply    delete, then read back
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "kmzuxrvfrwwpwmoovwcp";
const BUCKET = "creatives";

/** Literal SQL for a list of uuids; anything that isn't a uuid is refused. */
export function uuidList(ids) {
  if (!ids.length || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))) throw new Error("bad uuid list");
  return ids.map((id) => `'${id}'`).join(",");
}

/** The read-only plan: which creatives and files may go. Business ids are uuids from internal-accounts, never user text. */
export function planSql(owners, days, keep) {
  return `with smoke as (select id from public.businesses where owner_id in (${uuidList(owners)})),
refs as (select coalesce(string_agg(t, ' '), '') txt from (
  select d::text t from public.campaign_drafts d where d.business_id in (select id from smoke)
  union all select o::text from public.campaign_operations o where o.business_id in (select id from smoke)
  union all select c::text from public.campaigns c where c.business_id in (select id from smoke)) x),
ranked as (select c.id, c.business_id, c.image_url, c.created_at,
  row_number() over (partition by c.business_id order by c.created_at desc) rn from public.creatives c where c.business_id in (select id from smoke)),
doomed as (select r.* from ranked r, refs where r.rn > ${keep} and r.created_at < now() - interval '${days} days'
  and not exists (select 1 from public.campaign_ads a where a.creative_id = r.id)
  and not exists (select 1 from private.creative_regeneration_claims g where g.creative_id = r.id)
  and position(r.id::text in refs.txt) = 0),
kept as (select coalesce(string_agg(c::text, ' '), '') txt from public.creatives c where c.business_id in (select id from smoke) and c.id not in (select id from doomed)),
files as (select o.name, (o.metadata->>'size')::bigint sz from storage.objects o, refs, kept
  where o.bucket_id = '${BUCKET}' and split_part(o.name, '/', 1) in (select id::text from smoke)
  and o.created_at < now() - interval '${days} days'
  and position(o.name in kept.txt) = 0 and position(o.name in refs.txt) = 0)
select (select coalesce(json_agg(id), '[]') from doomed) creatives,
  (select coalesce(json_agg(name), '[]') from files) files,
  (select coalesce(round(sum(sz) / 1048576.0, 1), 0) from files) mb`;
}

async function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false }, days: { type: "string", default: "7" }, keep: { type: "string", default: "20" } } });
  const days = Number(values.days), keep = Number(values.keep);
  if (!Number.isInteger(days) || days < 2 || !Number.isInteger(keep) || keep < 5) throw new Error("--days ≥ 2 and --keep ≥ 5");
  const internal = JSON.parse(await readFile(join(root, "src/lib/internal-accounts.json"), "utf8"));
  const owners = internal.smokeUserIds ?? [];
  const ops = parseEnv(await readFile(join(homedir(), "Development/copilot/arcade/.env"), "utf8"));
  const app = parseEnv(await readFile(join(homedir(), "Development/copilot/adbrain/.env.local"), "utf8"));
  if (!ops.SUPABASE_TOKEN || !app.SUPABASE_SERVICE_ROLE_KEY || !String(app.NEXT_PUBLIC_SUPABASE_URL).includes(PROJECT)) throw new Error("production credentials unavailable");
  const sql = async (query) => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: "POST", headers: { Authorization: `Bearer ${ops.SUPABASE_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
    if (!response.ok) throw new Error(`SQL ${response.status}`);
    return response.json();
  };
  const [plan] = await sql(planSql(owners, days, keep));
  console.log(`Smoke storage: ${plan.creatives.length} creatives and ${plan.files.length} files (${plan.mb} MB) older than ${days} days and unreferenced; newest ${keep} kept.`);
  if (!values.apply || (!plan.creatives.length && !plan.files.length)) return;

  if (plan.creatives.length) await sql(`delete from public.creatives where id in (${uuidList(plan.creatives)}) and business_id in (select id from public.businesses where owner_id in (${uuidList(owners)}))`);
  for (let i = 0; i < plan.files.length; i += 100) {
    const response = await fetch(`${app.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: "DELETE", headers: { apikey: app.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${app.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: plan.files.slice(i, i + 100) }) });
    if (!response.ok) throw new Error(`Storage delete ${response.status}`);
  }
  const [after] = await sql(`select count(*) n, round(coalesce(sum((metadata->>'size')::bigint), 0) / 1048576.0) mb from storage.objects where bucket_id = '${BUCKET}'`);
  console.log(`Deleted ${plan.creatives.length} creatives and ${plan.files.length} files. Bucket now ${after.n} objects, ${after.mb} MB.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`prune-smoke-storage: ${String(error?.message ?? error).slice(0, 200)}`); process.exitCode = 1; });
