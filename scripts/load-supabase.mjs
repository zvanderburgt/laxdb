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
import { readFileSync, existsSync } from "node:fs";
import { Client } from "pg";

const ENV_PATH = process.env.SUPABASE_ENV_FILE ?? "data/supabase-env.txt";
const DATA_PATH = process.env.LAXDB_DATA ?? "public/data.json";
const BATCH = Number(process.env.LAXDB_BATCH ?? 2000);
const dryRun = process.argv.includes("--dry-run");

/* --------------------------------- columns -------------------------------- */
/* type: t text · i integer · n numeric · j jsonb */

const TABLES = {
  leagues: [
    ["id", "t"], ["ord", "i"], ["name", "t"], ["short", "t"], ["level", "t"], ["type", "t"], ["country", "t"],
    ["tier", "i"], ["strength", "n"], ["standings", "j"], ["polls", "j"], ["ratings", "j"],
  ],
  teams: [
    ["id", "t"], ["name", "t"], ["shortName", "t"], ["slug", "t"], ["leagueId", "t"],
    ["conference", "t"], ["colors", "j"], ["record", "j"], ["staff", "j"], ["logo", "t"],
    ["city", "t"], ["cityName", "t"], ["region", "t"], ["elo", "n"], ["sos", "n"],
    ["history", "j"], ["pollRanks", "j"], ["franchise", "j"],
  ],
  players: [
    ["slug", "t"], ["id", "t"], ["firstName", "t"], ["lastName", "t"], ["name", "t"],
    ["position", "t"], ["positionName", "t"], ["hand", "t"], ["heightIn", "i"], ["weightLb", "i"],
    ["dob", "t"], ["birthplace", "j"], ["classYear", "i"], ["gradYear", "i"], ["teamId", "t"],
    ["leagueId", "t"], ["jersey", "i"], ["status", "t"], ["scouting", "j"], ["photo", "t"],
    ["experience", "i"], ["highSchool", "t"], ["careerLine", "j"], ["ord", "i"],
  ],
  player_games: [
    ["playerSlug", "t"], ["ord", "i"], ["season", "t"], ["date", "t"], ["opponent", "t"],
    ["result", "t"], ["g", "i"], ["a", "i"], ["gb", "i"], ["ct", "i"], ["sv", "i"], ["ga", "i"],
    ["foW", "i"], ["foA", "i"],
  ],
  player_adj: [
    ["playerSlug", "t"], ["season", "t"], ["games", "i"], ["raw", "n"], ["adjusted", "n"],
    ["avgOppElo", "n"], ["ranked", "i"],
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

// the dataset's own order decides the default league on /leaders, exactly as `seasons.ord` decides
// which of a player's rows `currentSeason()` means
const leagues = data.leagues.map((r, ord) => project({ ...r, ord }, TABLES.leagues));
const teams = data.teams.map((r) => project(r, TABLES.teams));
const players = data.players.map((r, ord) => project({ ...r, ord }, TABLES.players));

const seasons = [];
for (const p of data.players) {
  (p.seasons ?? []).forEach((s, ord) =>
    seasons.push(project({ ...s, playerId: p.id, playerSlug: p.slug, ord }, TABLES.seasons)),
  );
}

/**
 * A field in data.json with no column is dropped by `jsonb_populate_recordset` without a word. That
 * is how the first pass lost every team's Elo, city and franchise history, and 3,212 career lines.
 * The load refuses to run when the source carries a key the table does not.
 */
function assertCoverage(label, source, spec, ignore = []) {
  const columns = new Set(spec.map(([c]) => c));
  const missing = new Set();
  for (const row of source) {
    for (const k of Object.keys(row ?? {})) {
      if (!columns.has(k) && !ignore.includes(k)) missing.add(k);
    }
  }
  if (missing.size) {
    console.error(`FAIL ${label}: data.json has fields with no column — ${[...missing].join(", ")}`);
    process.exit(1);
  }
}

assertCoverage("leagues", data.leagues, TABLES.leagues);
assertCoverage("teams", data.teams, TABLES.teams);
assertCoverage("players", data.players, TABLES.players, ["seasons"]);
assertCoverage("seasons", data.players.flatMap((p) => p.seasons ?? []), TABLES.seasons);

const snapshots = [
  { key: "history", body: data.history },
  // the page heads quote the dataset's own build stamp, so it has to travel with the data
  { key: "meta", body: data.meta },
];

/* --------------------------- opponent-adjusted ---------------------------- */
/**
 * The Opp-adj board multiplies each game's points by the opponent's Elo over the 1500 baseline and
 * averages. That is one number per player per season, so it is computed here from the game log the
 * importer writes beside the dataset — the page then never fetches games.json.
 */
let adjRows = [];
let gameRows = [];
const gamesPath = process.env.LAXDB_GAMES ?? "public/games.json";
if (existsSync(gamesPath)) {
  const logs = JSON.parse(readFileSync(gamesPath, "utf8"));
  // the same key the site uses: lowercased, letters only, last team wins, and each club answers to
  // its name, its short name and its slug read as words. Every team is indexed — including the ones
  // with no Elo, because "UMass" must find the Minutemen (and drop the game) rather than slide down a
  // prefix match onto "UMass Lowell", whose Elo it would then borrow.
  const nameKey = (v) => String(v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const teamsByKey = new Map();
  for (const t of data.teams) {
    for (const n of [t.name, t.shortName, t.slug?.replace(/-/g, " ")]) {
      if (!n) continue;
      teamsByKey.set(nameKey(n), t);
    }
  }

  const lookup = (opponent) => {
    const key = nameKey(opponent);
    if (!key) return undefined;
    if (teamsByKey.has(key)) return teamsByKey.get(key);
    let best, bestLen = -1;
    for (const [k, v] of teamsByKey) {
      if (!(k.startsWith(key) || key.startsWith(k))) continue;
      if (k.length > bestLen) {
        bestLen = k.length;
        best = v;
      }
    }
    return best;
  };

  // data.json's player ids are not unique (four collisions), and the log is keyed by id, so the first
  // record wins — the same record the id-based lookups on the page would reach
  const slugById = new Map();
  for (const p of data.players) if (!slugById.has(p.id)) slugById.set(p.id, p.slug);

  for (const [playerId, games] of Object.entries(logs)) {
    const slug = slugById.get(playerId);
    if (!slug || !Array.isArray(games)) continue;
    const bySeason = new Map();
    for (const g of games) {
      const season = String(g?.date ?? "").slice(0, 4);
      const team = lookup(g?.opponent);
      const elo = Number(team?.elo);
      if (!Number.isFinite(elo) || !elo) continue;
      if (!season || !elo) continue;
      if (!bySeason.has(season)) bySeason.set(season, []);
      bySeason.get(season).push({ g, elo, rpi: Number(team?.pollRanks?.rpi) || 99 });
    }
    for (const [season, list] of bySeason) {
      if (list.length < 5) continue; // the page refuses to rank a player on fewer than five games
      const pts = (g) => (g.g || 0) + (g.a || 0);
      let raw = 0, adjusted = 0, eloSum = 0, ranked = 0;
      for (const { g, elo, rpi } of list) {
        raw += pts(g);
        adjusted += pts(g) * (elo / 1500);
        eloSum += elo;
        if (rpi <= 25) ranked += 1;
      }
      const n = list.length;
      adjRows.push({
        playerSlug: slug, season, games: n,
        raw: raw / n, adjusted: adjusted / n, avgOppElo: eloSum / n, ranked,
      });
    }
  }
  // one row per game, in the order the feed lists them: the player page prints them newest first and
  // the team page reads a whole roster's season
  for (const [playerId, games] of Object.entries(logs)) {
    const slug = slugById.get(playerId);
    if (!slug || !Array.isArray(games)) continue;
    games.forEach((g, ord) => {
      const date = String(g?.date ?? "");
      if (!date) return;
      gameRows.push({
        playerSlug: slug, ord, season: date.slice(0, 4), date,
        opponent: g?.opponent ?? null, result: g?.result ?? null,
        g: g?.g ?? null, a: g?.a ?? null, gb: g?.gb ?? null, ct: g?.ct ?? null,
        sv: g?.sv ?? null, ga: g?.ga ?? null, foW: g?.foW ?? null, foA: g?.foA ?? null,
      });
    });
  }

  console.log(
    `opponent-adjusted: ${adjRows.length} player-seasons from ${Object.keys(logs).length} game logs · ` +
      `${gameRows.length} games`,
  );
}

/* --------------------------- auxiliary datasets --------------------------- */
/**
 * The importer writes five more files beside data.json: the scorecard, the record books, two rankings
 * snapshots and the franchise shells. They are small, they never change between builds, and six pages
 * fetch scores.json alone — so they travel as snapshot rows and the pages stop asking the CDN for a
 * file.
 */
const AUX = [
  ["scores", "public/scores.json"],
  ["history-results", "public/history-results.json"],
  ["rankings", "public/rankings.json"],
  ["rankings-history", "public/rankings-history.json"],
  ["franchises", "public/franchises.json"],
];
const auxSnapshots = [];
for (const [key, file] of AUX) {
  const filePath = process.env.LAXDB_AUX_DIR ? `${process.env.LAXDB_AUX_DIR}/${file.split("/").pop()}` : file;
  if (!existsSync(filePath)) continue;
  auxSnapshots.push({ key, body: JSON.parse(readFileSync(filePath, "utf8")) });
}
console.log(`auxiliary snapshots: ${auxSnapshots.map((a) => a.key).join(", ") || "none"}`);

const expected = {
  leagues: leagues.length,
  teams: teams.length,
  players: players.length,
  seasons: seasons.length,
  snapshots: snapshots.length + auxSnapshots.length,
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
  // `json`, not `jsonb`: jsonb normalises every object to its own key order, which re-orders fields
  // a reader can see ("Committee · RPI · Coaches" became "RPI · Coaches · Committee")
  const sql = `insert into public."${table}" (${cols}) select ${select} from json_populate_recordset(null::public."${table}", $1::json)`;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await client.query(sql, [JSON.stringify(slice)]);
  }
}

try {
  await client.query("begin");
  await client.query(
    'truncate public.player_games, public.player_adj, public.seasons, public.players, public.teams, public.leagues, public.snapshots',
  );
  await insert("leagues", leagues);
  await insert("teams", teams);
  await insert("players", players);
  await insert("seasons", seasons);
  await insert("player_adj", adjRows);
  await insert("player_games", gameRows);
  await client.query(
    `insert into public.snapshots ("key", "body") values ('history', $1::jsonb), ('meta', $2::jsonb)`,
    [JSON.stringify(snapshots[0].body), JSON.stringify(snapshots[1].body)],
  );
  for (const snap of auxSnapshots) {
    await client.query(
      `insert into public.snapshots ("key", "body") values ($1, $2::jsonb)
       on conflict ("key") do update set "body" = excluded."body"`,
      [snap.key, JSON.stringify(snap.body)],
    );
  }
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

/* ------------------------- materialised pools ----------------------------- */
/* The player route used to rebuild the similarity pool per request: 17k rows, 17 paginated reads at
 * 1000 rows each, ~6 s on a cold function. The same rows, grouped once here, are one snapshot read.
 * Nothing about the maths moves — the pool is the same `player_career` output the request used. */

const GROUP_OF = { G: "G", D: "D", LSM: "D", M: "M", SSDM: "M", FO: "FO", A: "A", F: "A", T: "M", R: "M" };
const POOL_FIELDS = [
  "slug", "id", "name", "position", "heightIn", "teamId", "leagueId", "photo",
  "gp", "g", "a", "sh", "gb", "ct", "to", "foW", "foA", "sv", "ga", "w",
];

const { rows: career } = await client.query("select * from public.player_career");
const pools = new Map();
for (const r of career) {
  if ((r.gp ?? 0) < 5) continue; // the same floor `similarTo` applies
  const g = GROUP_OF[r.position] ?? "M";
  const list = pools.get(g) ?? [];
  list.push(Object.fromEntries(POOL_FIELDS.map((f) => [f, r[f]])));
  pools.set(g, list);
}

await client.query(
  `delete from public.snapshots where "key" like 'pool:career:%'`,
);
for (const [g, list] of pools) {
  await client.query(
    `insert into public.snapshots ("key", "body") values ($1, $2::jsonb)`,
    [`pool:career:${g}`, JSON.stringify(list)],
  );
}
console.log(
  `pools: ${[...pools].map(([g, l]) => `${g}=${l.length}`).join(" ")} (${(
    [...pools.values()].reduce((n, l) => n + l.length, 0) / 1000
  ).toFixed(0)}k rows)`,
);

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
