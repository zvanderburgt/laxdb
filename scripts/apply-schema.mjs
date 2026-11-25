/**
 * Apply supabase/schema.sql to the project in data/supabase-env.txt.
 *
 *   node scripts/apply-schema.mjs
 *
 * Idempotent — the DDL is `if not exists` / `drop policy if exists`.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const ENV_PATH = process.env.SUPABASE_ENV_FILE ?? "data/supabase-env.txt";
const SQL_PATH = process.env.SUPABASE_SCHEMA ?? "supabase/schema.sql";

function readEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0 || line.trimStart().startsWith("#")) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const env = readEnv(ENV_PATH);
if (!env.SUPABASE_DB_URL) throw new Error(`SUPABASE_DB_URL missing from ${ENV_PATH}`);

const sql = readFileSync(SQL_PATH, "utf8");
const client = new Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  application_name: "laxdb-schema",
});

await client.connect();
try {
  if (process.argv.includes("--reset")) {
    // Destructive: for iterating on the schema before the tables hold anything worth keeping.
    // Editorial work lives in `overrides`, which is dropped too — never run this on a live project.
    const { rows: existing } = await client.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`);
    if (existing.length) {
      console.log(`--reset: dropping ${existing.map((r) => r.relname).join(", ")}`);
      await client.query(
        existing.map((r) => `drop table if exists public."${r.relname}" cascade`).join(";\n"),
      );
    }
  }
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log(`applied ${SQL_PATH}`);
} catch (err) {
  await client.query("rollback");
  throw err;
}

const { rows } = await client.query(`
  select c.relname as table, c.reltuples::bigint as est
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' order by 1`);
for (const r of rows) console.log(`  table ${r.table.padEnd(12)} ~${r.est}`);

await client.end();
