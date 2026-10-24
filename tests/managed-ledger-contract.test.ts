import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIVATION_FUNDING_STATES, MANAGED_LEDGER_COLUMNS, MANAGED_LEDGER_STATES } from "@/lib/meta/managed-account";

// QA on #536: the resolver must match #533's real ledger, so a mismatch fails CI, not production.
const migration = join(process.cwd(), "db/migrations/20261025_managed_meta_accounts.sql");

describe.runIf(existsSync(migration))("managed account resolver vs the #519 ledger migration (#525)", () => {
  const sql = existsSync(migration) ? readFileSync(migration, "utf8") : "";
  const table = sql.slice(sql.indexOf("create table if not exists public.managed_meta_accounts"), sql.indexOf("create or replace function public.managed_meta_account_guard"));

  it("reads only columns the ledger has", () => {
    for (const column of MANAGED_LEDGER_COLUMNS) expect(table, column).toMatch(new RegExp(`\\n\\s+${column}\\s`));
  });

  it("activates only on funding states the ledger allows, and knows every ledger state", () => {
    const funding = /funding_state text not null default '[a-z_]+' check \(funding_state in \(([^)]*)\)\)/.exec(table)?.[1] ?? "";
    for (const state of ACTIVATION_FUNDING_STATES) expect(funding).toContain(`'${state}'`);
    const states = /state text not null default '[a-z_]+' check \(state in \(([^)]*)\)\)/.exec(table)?.[1].replace(/\s+/g, " ") ?? "";
    expect(states.split(",").map((value) => value.trim().replace(/'/g, "")).sort()).toEqual([...MANAGED_LEDGER_STATES].sort());
  });
});
