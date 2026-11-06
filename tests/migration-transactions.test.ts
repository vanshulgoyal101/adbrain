import { describe, expect, it, vi } from "vitest";
import { applyMigration, managementMigrationSql } from "../scripts/database-migrations.mjs";

const name = "20261103_transaction_test.sql";
const unsafe = [
  ["commit without a final semicolon", "begin;\nselect 1;\ncommit"],
  ["an inline commit", "select 1; commit;"],
  ["commit and chain", "select 1;\ncommit and chain;"],
  ["commented commit syntax", "select 1; commit /* comment */ work;"],
  ["a misplaced begin", "select 1;\nbegin;\nselect 2;\n"],
  ["a misplaced commit", "begin;\nselect 1;\ncommit;\nselect 2;\n"],
  ["a prepared transaction", "select 1;\nprepare transaction 'fixture';"],
  ["set transaction", "set transaction read only;\nselect 1;"],
  ["set session characteristics", "set session characteristics as transaction read only;\nselect 1;"],
  ["rollback without a final semicolon", "select 1;\nrollback"],
  ["rollback and chain", "select 1;\nrollback and chain;"],
  ["inline rollback", "select 1; rollback;"],
  ["ordinary begin/atomic identifiers before a commit", "select begin atomic from (select 1 as begin) fixture; commit;"],
  ["an ambiguous backslash before a quote", String.raw`select '\'; commit;`],
] as const;

const procedure = `create procedure public.runner_procedure() language plpgsql as $body$
begin
  commit;
end;
$body$;`;

const atomicFunction = `create function public.runner_answer() returns integer language sql
begin atomic
  select case when true then 42 else 0 end;
end;`;

const safeStatements = [
  ["a quoted procedure body", procedure],
  ["an SQL-standard atomic function", atomicFunction],
  ["nested comments", "/* outer /* nested */\ncommit;\n*/\nselect 1;"],
  ["a Unicode dollar quote", "do $सुरक्षित$\nbegin\n  perform 1;\nend;\n$सुरक्षित$;"],
  ["an escaped string", String.raw`select E'escaped \'; commit; -- still literal';`],
] as const;

describe.each(["CLI", "Management API"] as const)("%s migration transaction safety", (transport) => {
  it.each(unsafe)("rejects %s before executing the migration", async (_description, sql) => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const run = () => transport === "CLI"
      ? applyMigration({ query }, name, sql)
      : managementMigrationSql(name, sql, { commit: false });

    await expect(Promise.resolve().then(run)).rejects.toThrow(/controls its own transaction|ambiguous SQL string/);
    expect(query).not.toHaveBeenCalledWith(sql);
    expect(query.mock.calls.some(([statement]) => statement.startsWith("insert into private.schema_migrations"))).toBe(false);
  });

  it.each(safeStatements)("preserves %s without interpreting its contents as transaction control", async (_description, sql) => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    if (transport === "CLI") {
      expect(await applyMigration({ query }, name, sql)).toBe("applied");
      expect(query).toHaveBeenCalledWith(sql);
    } else {
      expect(managementMigrationSql(name, sql, { commit: false })).toContain(sql);
    }
  });

  it("strips only the actual outer wrapper, not transaction words inside comments", async () => {
    const comment = "/*\nbegin;\ncommit;\n*/";
    const sql = `${comment}\nbegin;\ncreate table public.runner_fixture (id integer);\ncommit;\n`;
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const body = transport === "CLI"
      ? (await applyMigration({ query }, name, sql), query.mock.calls.find(([statement]) => statement.includes("create table public.runner_fixture"))?.[0])
      : managementMigrationSql(name, sql, { commit: false });

    expect(body).toContain(comment);
    expect(body).toContain("create table public.runner_fixture (id integer);");
    const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, "");
    const controls = withoutComments.match(/^\s*(begin|commit)\s*;/gim) ?? [];
    expect(controls.map((control: string) => control.trim().toLowerCase())).toEqual(transport === "CLI" ? [] : ["begin;"]);
  });

  it("preserves comments following the outer commit", async () => {
    const comment = "/*\ncommit;\n*/";
    const sql = `begin;\nselect 1;\ncommit;\n${comment}\n`;
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const body = transport === "CLI"
      ? (await applyMigration({ query }, name, sql), query.mock.calls.find(([statement]) => statement.includes("select 1;"))?.[0])
      : managementMigrationSql(name, sql, { commit: false });

    expect(body).toContain(comment);
    const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, "");
    const controls = withoutComments.match(/^\s*(begin|commit)\s*;/gim) ?? [];
    expect(controls.map((control: string) => control.trim().toLowerCase())).toEqual(transport === "CLI" ? [] : ["begin;"]);
  });
});
