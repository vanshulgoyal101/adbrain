// Customer-only product events (#379). Read-only.
//   node scripts/product-events.mjs [--days 7] [--include-internal]
//     counts per event name and outcome
//   node scripts/product-events.mjs "select ... from events ..." [--include-internal]
//     any one SELECT/WITH over `events`: public.product_events of real customers only
//     (by user, or by business owner for background events; system rows left out)
// Internal accounts are defined once in scripts/lib/internal-accounts.mjs.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { customerFilterSql, localInternalEmails } from "./lib/internal-accounts.mjs";
import { readOnlyQuery } from "./lib/prod-query.mjs";

export function eventsSql(query, emails, { includeInternal = false } = {}) {
  const sql = String(query ?? "").trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(sql) || sql.includes(";")) throw new Error("Pass one SELECT or WITH statement over `events`.");
  const events = includeInternal
    ? "events as (select * from public.product_events)"
    // A customer's own events, or background events for a customer's business; never system rows.
    : `events as (select * from public.product_events where ${customerFilterSql("user_id", "business_id", emails)})`;
  return /^with\b/i.test(sql) ? `with ${events}, ${sql.replace(/^with\s+/i, "")}` : `with ${events} ${sql}`;
}

export function summarySql(days) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("--days must be a whole number from 1 to 365.");
  return `select name, outcome, count(*)::int as events, count(distinct user_id)::int as users from events
where created_at > now() - make_interval(days => ${days}) and name <> 'http.request'
group by 1, 2 order by 3 desc`;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    days: { type: "string", default: "7" }, "include-internal": { type: "boolean", default: false },
  } });
  const includeInternal = values["include-internal"];
  const query = positionals[0] ?? summarySql(Number(values.days));
  const rows = await readOnlyQuery(eventsSql(query, await localInternalEmails(), { includeInternal }));
  if (positionals[0]) console.log(JSON.stringify(rows));
  else {
    console.log(`Product events in the last ${values.days} days, ${includeInternal ? "everyone" : "customers only"} (http.request left out):`);
    for (const row of rows) console.log(`  ${String(row.events).padStart(6)}  ${String(row.users).padStart(3)} users  ${row.name} ${row.outcome}`);
    if (!rows.length) console.log("  none");
  }
  if (!includeInternal) console.log("Internal accounts are excluded; add --include-internal to see them.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Query failed.");
    process.exitCode = 1;
  });
}
