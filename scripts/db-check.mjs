/**
 * Connectivity check for the Supabase project.
 *
 *   node scripts/db-check.mjs
 *
 * Reads data/supabase-env.txt (gitignored), connects through the session pooler and prints only
 * non-secret facts: server version, the database and role it landed as, and one row per table we
 * expect the loader to have filled. Never prints a key, a password or a row of data.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const ENV_PATH = process.env.SUPABASE_ENV_FILE ?? "data/supabase-env.txt";

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
for (const k of ["SUPABASE_URL", "SUPABASE_DB_URL"]) {
  if (!env[k]) throw new Error(`${k} missing from ${ENV_PATH}`);
}

const client = new Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  application_name: "laxdb-db-check",
});

await client.connect();
const q = async (sql) => (await client.query(sql)).rows;

const [who] = await q(`select current_database() as db, current_user as usr, version() as v`);
console.log(`db      ${who.db}  as ${who.usr}`);
console.log(`server  ${who.v.split(",")[0]}`);

const [{ size }] = await q(`select pg_size_pretty(pg_database_size(current_database())) as size`);
console.log(`size    ${size}`);

const tables = await q(`
  select c.relname as table, c.reltuples::bigint as est_rows
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by 1`);
if (!tables.length) console.log("tables  (none yet)");
for (const t of tables) console.log(`table   ${t.table.padEnd(18)} ~${t.est_rows}`);

await client.end();
