/**
 * Load public/data.json into the Supabase project — the "loader, not a port" decision
 * (docs/supabase-migration.md D2). The importer keeps writing data.json exactly as before; this
 * script is the only thing that knows about Postgres.
 *
 *   node scripts/load-supabase.mjs            full refresh (truncate + insert, one transaction)
 *   node scripts/load-supabase.mjs --dry-run  map and count rows, touch nothing
 *
 * The refresh is a truncate, not an upsert: data.json is rebuilt wholesale by the importer, and
 * editorial work lives in `overrides`, never in these tables. A half-applied refresh is impossible
 * because the truncate and every insert share one transaction.
 *
 * Column names are the dataset's own keys, so this file holds the column list once and maps
 * nothing. Values are coerced per column type — a "" in an integer column is the one thing that
 * would otherwise abort a load that is 99% valid.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const ENV_PATH = process.env.SUPABASE_ENV_FILE ?? "data/supabase-env.txt";
const DATA_PATH = process.env.LAXDB_DATA ?? "public/data.json";
const BATCH = Number(process.env.LAXDB_BATCH ?? 2000);
const dryRun = process.argv.includes("--dry-run");

/* --------------------------------- columns -------------------------------- */
/* type: t text · i integer · n numeric · j jsonb */

const TABLES = {
  leagues: [
    ["id", "t"], ["name", "t"], ["short", "t"], ["level", "t"], ["type", "t"], ["country", "t"],
    ["tier", "i"], ["strength", "n"], ["standings", "j"], ["polls", "j"], ["ratings", "j"],
  ],
  teams: [
    ["id", "t"], ["name", "t"], ["shortName", "t"], ["slug", "t"], ["leagueId", "t"],
    ["conference", "t"], ["colors", "j"], ["record", "j"], ["staff", "j"], ["logo", "t"],
  ],
  players: [
    ["slug", "t"], ["id", "t"], ["firstName", "t"], ["lastName", "t"], ["name", "t"],
    ["position", "t"], ["positionName", "t"], ["hand", "t"], ["heightIn", "i"], ["weightLb", "i"],
    ["dob", "t"], ["birthplace", "j"], ["classYear", "i"], ["gradYear", "i"], ["teamId", "t"],
    ["leagueId", "t"], ["jersey", "i"], ["status", "t"], ["scouting", "j"], ["photo", "t"],
    ["experience", "i"], ["highSchool", "t"],
  ],
  seasons: [
    ["playerSlug", "t"], ["playerId", "t"], ["ord", "i"], ["season", "i"], ["teamId", "t"], ["leagueId", "t"], ["type", "t"],
    ["gp", "i"], ["gs", "i"], ["g", "i"], ["a", "i"], ["pts", "i"], ["sh", "i"], ["gb", "i"],
    ["to", "i"], ["ct", "i"], ["foW", "i"], ["foA", "i"], ["pen", "i"], ["min", "i"],
    ["ga", "i"], ["sv", "i"], ["w", "i"], ["l", "i"], ["gaa", "n"], ["svp", "n"],
  ],
};

const coerced = { t: 0, i: 0, n: 0, junk: 0 };

function coerce(value, type) {
  if (value === null || value === undefined) return null;
  if (type === "j") return value;
  if (type === "t") {
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return value;
    return String(value);
  }
  if (value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,%\s]/g, ""));
  if (!Number.isFinite(n)) {
    coerced.junk++;
    return null;
  }
  coerced[type]++;
  return type === "i" ? Math.round(n) : n;
}

function project(row, spec) {
  const out = {};
  for (const [col, type] of spec) out[col] = coerce(row[col], type);
  return out;
}

/* ---------------------------------- load ---------------------------------- */

function readEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0 || line.trimStart().startsWith("#")) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

console.log(`reading ${DATA_PATH}`);
const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));

const leagues = data.leagues.map((r) => project(r, TABLES.leagues));
const teams = data.teams.map((r) => project(r, TABLES.teams));
const players = data.players.map((r) => project(r, TABLES.players));

const seasons = [];
for (const p of data.players) {
  (p.seasons ?? []).forEach((s, ord) =>
    seasons.push(project({ ...s, playerId: p.id, playerSlug: p.slug, ord }, TABLES.seasons)),
  );
}

const snapshots = [
  { key: "history", body: data.history },
  { key: "meta", body: data.meta },
];

const expected = {
  leagues: leagues.length,
  teams: teams.length,
  players: players.length,
  seasons: seasons.length,
  snapshots: snapshots.length,
};
console.log(
  `mapped ${expected.players} players · ${expected.seasons} season rows · ${expected.teams} teams · ` +
    `${expected.leagues} leagues · ${expected.snapshots} snapshots` +
    (coerced.junk ? ` · ${coerced.junk} unparseable numbers -> null` : ""),
);

const datasetPts = data.players.reduce(
  (sum, p) => sum + (p.seasons ?? []).reduce((s2, r) => s2 + (Number(r.pts) || 0), 0),
  0,
);
console.log(`dataset points total ${datasetPts}`);

if (dryRun) {
  console.log("dry run — nothing written");
  process.exit(0);
}

const env = readEnv(ENV_PATH);
if (!env.SUPABASE_DB_URL) throw new Error(`SUPABASE_DB_URL missing from ${ENV_PATH}`);

const client = new Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
  application_name: "laxdb-loader",
});

await client.connect();
const started = Date.now();

/** Inserts `rows` into `table` straight from jsonb, so no value is ever re-serialised by hand. */
async function insert(table, rows) {
  if (!rows.length) return;
  const spec = TABLES[table];
  const cols = spec.map(([c]) => `"${c}"`).join(", ");
  const select = spec.map(([c]) => `"${c}"`).join(", ");
  const sql = `insert into public."${table}" (${cols}) select ${select} from jsonb_populate_recordset(null::public."${table}", $1::jsonb)`;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await client.query(sql, [JSON.stringify(slice)]);
  }
}

try {
  await client.query("begin");
  await client.query(
    'truncate public.seasons, public.players, public.teams, public.leagues, public.snapshots',
  );
  await insert("leagues", leagues);
  await insert("teams", teams);
  await insert("players", players);
  await insert("seasons", seasons);
  await client.query(
    `insert into public.snapshots ("key", "body") values ('history', $1::jsonb), ('meta', $2::jsonb)`,
    [JSON.stringify(snapshots[0].body), JSON.stringify(snapshots[1].body)],
  );
  await client.query("commit");
} catch (err) {
  await client.query("rollback");
  throw err;
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`loaded in ${secs}s`);

/* -------------------------------- verify ---------------------------------- */
/* Exact counts, plus two independent sums: counts alone would pass a load that dropped values. */

const counts = await client.query(`
  select 'players' t, count(*)::int n from public.players
  union all select 'seasons', count(*)::int from public.seasons
  union all select 'teams', count(*)::int from public.teams
  union all select 'leagues', count(*)::int from public.leagues
  union all select 'snapshots', count(*)::int from public.snapshots`);

let ok = true;
for (const { t, n } of counts.rows) {
  const want = expected[t];
  const pass = n === want;
  ok &&= pass;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${t.padEnd(10)} ${n}${pass ? "" : ` (expected ${want})`}`);
}

const [{ pts }] = (
  await client.query('select coalesce(sum("pts"), 0)::bigint as pts from public.seasons')
).rows;
const ptsPass = Number(pts) === datasetPts;
ok &&= ptsPass;
console.log(`  ${ptsPass ? "ok  " : "FAIL"} points     ${pts}${ptsPass ? "" : ` (expected ${datasetPts})`}`);

const [{ seasons_without_player }] = (
  await client.query(
    'select count(*)::int as seasons_without_player from public.seasons s left join public.players p on p."id" = s."playerId" where p."id" is null',
  )
).rows;
const orphanPass = seasons_without_player === 0;
ok &&= orphanPass;
console.log(`  ${orphanPass ? "ok  " : "FAIL"} orphans    ${seasons_without_player}`);

const [{ size }] = (
  await client.query('select pg_size_pretty(pg_database_size(current_database())) as size')
).rows;
console.log(`database size ${size}`);

await client.end();
if (!ok) {
  console.error("VERIFY FAILED");
  process.exit(1);
}
console.log("round trip: OK");
