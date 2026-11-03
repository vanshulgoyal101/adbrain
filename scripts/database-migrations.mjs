import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function databaseConfig(env, { localOnly = false, target = "" } = {}) {
  const host = env.PGHOST;
  const database = env.PGDATABASE;
  const user = env.PGUSER;
  const port = Number(env.PGPORT ?? 5432);
  if (!host || !database || !user || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Explicit PGHOST, PGDATABASE, PGUSER and a valid port are required.");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (localOnly && !local) throw new Error("Full-schema application is restricted to loopback databases.");
  const identity = `${host}:${port}/${database}@${user}`;
  if (!local && target !== identity) throw new Error("Remote migrations require an exact --target host:port/database@user confirmation.");
  if (!local && ["disable", "allow", "prefer", "require", "no-verify"].includes(env.PGSSLMODE)) {
    throw new Error("Remote migrations require certificate verification, not an insecure PGSSLMODE.");
  }
  return {
    host, port, database, user, password: env.PGPASSWORD,
    connectionTimeoutMillis: 10_000,
    ssl: local ? false : { rejectUnauthorized: true, ...(env.PGSSLROOTCERT ? { ca: readFileSync(env.PGSSLROOTCERT, "utf8") } : {}) },
    application_name: "adbrain-migrations",
  };
}

export function migrationChecksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

function identifierStart(char) {
  return char !== undefined && /[a-z_\u0080-\uffff]/i.test(char);
}

function identifierPart(char) {
  return char !== undefined && /[a-z0-9_$\u0080-\uffff]/i.test(char);
}

function scanMigrationSql(name, sql) {
  const masked = sql.split("");
  const statements = [];
  const blocks = [];
  let current;
  let previousWord;
  let parentheses = 0;
  let i = 0;

  const conceal = (start, end) => {
    for (let index = start; index < end; index++) {
      if (sql[index] !== "\n" && sql[index] !== "\r") masked[index] = "x";
    }
  };
  const addToken = (word, start) => {
    if (!current) current = { first: word, firstStart: start, second: undefined, count: 0, head: [] };
    if (current.count === 1) current.second = word;
    if (current.count < 4) current.head.push(word);
    current.count++;
  };
  const isRoutineDefinition = () => current?.head[0] === "create" && (
    ["function", "procedure"].includes(current.head[1]) ||
    (current.head[1] === "or" && current.head[2] === "replace" && ["function", "procedure"].includes(current.head[3]))
  );
  const incomplete = () => {
    throw new Error(`${name} contains an unterminated SQL literal or comment; apply it by hand.`);
  };

  while (i < sql.length) {
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const start = i;
      while (i < sql.length && sql[i] !== "\n" && sql[i] !== "\r") i++;
      conceal(start, i);
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const start = i;
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) { depth++; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) incomplete();
      conceal(start, i);
      continue;
    }
    if (sql[i] === "$" && !identifierPart(sql[i - 1])) {
      const delimiter = /^\$(?:[a-z_\u0080-\uffff][a-z0-9_\u0080-\uffff]*)?\$/i.exec(sql.slice(i))?.[0];
      if (delimiter) {
        const start = i;
        const end = sql.indexOf(delimiter, i + delimiter.length);
        if (end === -1) incomplete();
        i = end + delimiter.length;
        conceal(start, i);
        addToken(undefined, start);
        previousWord = undefined;
        continue;
      }
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const start = i;
      const quote = sql[i++];
      const escapeString = quote === "'" && /[eE]/.test(sql[start - 1] ?? "") && !identifierPart(sql[start - 2]);
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; }
          i++;
          closed = true;
          break;
        }
        if (quote === "'" && sql[i] === "\\") {
          if (escapeString) { i += 2; continue; }
          const startSlashes = i;
          while (sql[i] === "\\") i++;
          if ((i - startSlashes) % 2 && sql[i] === "'") {
            throw new Error(`${name} contains ambiguous SQL string escaping; apply it by hand.`);
          }
          continue;
        }
        i++;
      }
      if (!closed) incomplete();
      conceal(start, i);
      addToken(undefined, start);
      previousWord = undefined;
      continue;
    }
    if (identifierStart(sql[i])) {
      const start = i++;
      while (identifierPart(sql[i])) i++;
      const word = sql.slice(start, i).toLowerCase();
      if (word === "atomic" && previousWord === "begin" && parentheses === 0 && isRoutineDefinition()) blocks.push("atomic");
      else if (blocks.length && word === "case") blocks.push("case");
      else if (blocks.length && word === "end") blocks.pop();
      addToken(word, start);
      previousWord = word;
      continue;
    }
    if (sql[i] === "(") parentheses++;
    if (sql[i] === ")") parentheses--;
    if (sql[i] === ";" && parentheses === 0 && blocks.length === 0) {
      if (current) statements.push({ ...current, terminated: true });
      current = undefined;
    } else if (sql[i] !== ";") {
      addToken(undefined, i);
    }
    previousWord = undefined;
    i++;
  }
  if (current) statements.push({ ...current, terminated: false });
  return { masked: masked.join(""), statements };
}

function migrationBody(name, sql) {
  let { masked, statements } = scanMigrationSql(name, sql);
  const first = statements[0];
  const last = statements.at(-1);
  const begin = /^\s*begin\s*;[ \t]*$/im.exec(masked);
  const commitPattern = /^\s*commit\s*;[ \t]*(?![\s\S]*^\s*commit\s*;)/im;
  const commit = commitPattern.exec(masked);
  const isWrapper = (statement, word, match) => statement?.first === word && statement.count === 1 &&
    statement.terminated && match && statement.firstStart >= match.index && statement.firstStart < match.index + match[0].length;
  const stripBegin = isWrapper(first, "begin", begin);
  const stripCommit = isWrapper(last, "commit", commit);
  const controls = new Set(["begin", "commit", "rollback", "end", "abort", "savepoint", "release"]);

  for (const statement of statements) {
    const transactionControl = controls.has(statement.first) ||
      (statement.first === "start" && statement.second === "transaction") ||
      (statement.first === "prepare" && statement.second === "transaction");
    if (transactionControl && !(statement === first && stripBegin) && !(statement === last && stripCommit)) {
      throw new Error(`${name} controls its own transaction mid-file; apply it by hand.`);
    }
  }

  let body = sql;
  if (stripBegin) {
    body = body.slice(0, begin.index) + body.slice(begin.index + begin[0].length);
    masked = masked.slice(0, begin.index) + masked.slice(begin.index + begin[0].length);
  }
  if (stripCommit) {
    const match = commitPattern.exec(masked);
    body = body.slice(0, match.index) + body.slice(match.index + match[0].length);
  }
  return body;
}

export async function applyMigration(client, name, sql) {
  if (!/^\d[\w-]*\.sql$/.test(name)) throw new Error("Choose a migration filename from db/migrations.");
  const checksum = migrationChecksum(sql);
  await client.query("begin");
  try {
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '60s'");
    await client.query("select pg_advisory_xact_lock(hashtextextended('adbrain:migrations', 0))");
    await client.query("create schema if not exists private");
    await client.query("create table if not exists private.schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())");
    await client.query("revoke all on private.schema_migrations from public, anon, authenticated, service_role");
    const { rows } = await client.query("select checksum from private.schema_migrations where name = $1", [name]);
    if (rows.length && rows[0].checksum !== checksum) throw new Error("Applied migration checksum changed. Add a new migration instead.");
    if (!rows.length) {
      await client.query(migrationBody(name, sql));
      await client.query("insert into private.schema_migrations (name, checksum) values ($1, $2)", [name, checksum]);
    }
    await client.query("commit");
    return rows.length ? "already_applied" : "applied";
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

// One-request form of applyMigration for the Supabase Management API, where each
// request is its own session. `commit: false` always ends in rollback (a dry run).
export function managementMigrationSql(name, sql, { commit }) {
  if (!/^\d[\w-]*\.sql$/.test(name)) throw new Error("Choose a migration filename from db/migrations.");
  const body = migrationBody(name, sql);
  return [
    "begin;",
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    "select pg_advisory_xact_lock(hashtextextended('adbrain:migrations', 0));",
    `do $release$ begin if exists (select 1 from private.schema_migrations where name = '${name}') then raise exception 'already applied: ${name}'; end if; end $release$;`,
    body.trim(),
    `insert into private.schema_migrations (name, checksum) values ('${name}', '${migrationChecksum(sql)}');`,
    `select name, checksum from private.schema_migrations where name = '${name}';`,
    commit ? "commit;" : "rollback;",
  ].join("\n");
}