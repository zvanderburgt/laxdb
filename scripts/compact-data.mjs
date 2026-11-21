#!/usr/bin/env node
/**
 * Re-encode public/data.json into the two wire files the app fetches.
 *
 * The dataset is 23 MB on disk and most of it is repetition: 54k season rows printing the same 23
 * keys, and 27k player objects printing empty strings for fields the UI restores anyway. JSON keys
 * and empty values cost as much as the numbers.
 *
 * The payload is split because the two halves are needed at different moments:
 *
 *   public/index.wire.json    one record per player — id, name, bio, club, photo — plus the three
 *                             summaries a *list* needs (latest season, career totals, per-competition
 *                             peak). Home, Players, Teams, Origins, My roster, Compare and every list
 *                             row render from this alone.
 *   public/seasons.wire.json  the full season history, one tuple array per player, aligned to the
 *                             index's player order. Fetched at boot but never awaited: the player
 *                             page, Leaders, History, League boards and a team's season cards gate on
 *                             it, so first paint does not pay for 54k stat rows.
 *
 * Encoding rules (both files):
 *   - season rows become positional arrays against one `seasonCols` header;
 *   - club ids become indices into `teams` / `leagues`;
 *   - player fields holding an empty value ("", [], {}, null, 0 — recursively) are dropped, and
 *     `normalizePlayer()` in src/lib/data.ts puts the same defaults back at load.
 *
 * `src/lib/wire.ts` decodes both. Round-trip check (decodes the files it just wrote and diffs them
 * against data.json, season row by season row):
 *
 *   node scripts/compact-data.mjs --check
 *
 * Usage: node scripts/compact-data.mjs [--check]
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "public/data.json");
const INDEX_OUT = join(ROOT, "public/index.wire.json");
const SEASONS_OUT = join(ROOT, "public/seasons.wire.json");
/** the pre-split payload, removed so a stale copy cannot ship */
const LEGACY_OUT = join(ROOT, "public/data.wire.json");

const FORMAT_INDEX = "laxdb-index/2";
const FORMAT_SEASONS = "laxdb-seasons/2";

/**
 * Season row layout. THE ORDER IS THE FORMAT — append to it and to `SeasonRow` together, or every
 * row in the file is silently misread. `gaa`/`svp` are the rates box feeds publish instead of raw
 * minutes and saves.
 */
const SEASON_COLS = [
  "season", "teamId", "leagueId", "type", "gp", "gs", "g", "a", "pts",
  "sh", "gb", "to", "ct", "foW", "foA", "pen", "min", "ga", "sv", "w", "l",
  "gaa", "svp",
];

/** career totals, as one tuple per player: the sums, plus the two published rates */
const CAREER_COLS = [
  "gp", "g", "a", "sh", "gb", "to", "ct", "pen", "sv", "ga", "min", "foW", "foA", "w", "l", "gaa", "svp",
];

/** fields whose empty value the client restores to something meaningful, so they can go */
const KEEP_ALWAYS = new Set([
  "id", "slug", "name", "firstName", "lastName", "position", "positionName", "dob", "status",
]);

/** true when a value carries nothing: an empty string/array/object, null, 0 or false */
const isEmpty = (v) => {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.every(isEmpty);
  if (typeof v === "object") return Object.values(v).every(isEmpty);
  return v === "" || v === 0 || v === false;
};

/* ------------------------------- summaries -------------------------------- */

/** The same arithmetic `careerTotals()` in src/lib/data.ts does, so the two cannot drift. */
function careerTuples(rows) {
  const sum = (k) => rows.reduce((n, s) => n + (Number(s[k]) || 0), 0);
  const gp = sum("gp");
  const g = sum("g");
  const a = sum("a");
  const sv = sum("sv");
  const ga = sum("ga");
  const min = sum("min");
  const foW = sum("foW");
  const foA = sum("foA");
  // box feeds publish GAA/SV% instead of raw minutes/saves, weighted by games played
  const rate = (key, fallback) => {
    const published = rows.filter((s) => typeof s[key] === "number" && s[key] > 0);
    if (!published.length) return fallback;
    const weight = published.reduce((n, s) => n + Math.max(1, s.gp || 0), 0);
    return published.reduce((n, s) => n + s[key] * Math.max(1, s.gp || 0), 0) / weight;
  };
  return [
    gp, g, a, sum("sh"), sum("gb"), sum("to"), sum("ct"), sum("pen"), sv, ga, min, foW, foA,
    sum("w"), sum("l"),
    rate("gaa", min ? (ga * 60) / min : 0),
    rate("svp", sv + ga ? sv / (sv + ga) : 0),
  ];
}

/** Best season per competition: [leagueIdx, pts, gp, season] — what the notable/peak pickers read. */
function peakTuples(rows, leagueIdx) {
  const best = new Map();
  for (const r of rows) {
    const league = leagueIdx.get(r.leagueId);
    if (league === undefined) continue;
    const pts = r.pts ?? 0;
    const gp = r.gp ?? 0;
    const cur = best.get(league);
    if (!cur) best.set(league, [league, pts, gp, r.season]);
    else best.set(league, [league, Math.max(cur[1], pts), cur[2] + gp, pts > cur[1] ? r.season : cur[3]]);
  }
  return [...best.values()];
}

/* -------------------------------- encoding -------------------------------- */

function encodePlayer(p, teamIdx, leagueIdx) {
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === "seasons") continue;
    if (k === "teamId") { out.teamId = teamIdx.get(v) ?? -1; continue; }
    if (k === "leagueId") { out.leagueId = leagueIdx.get(v) ?? -1; continue; }
    if (KEEP_ALWAYS.has(k) || !isEmpty(v)) out[k] = v;
  }
  const rows = p.seasons ?? [];
  if (rows.length) {
    out.n = rows.length;
    out.cur = encodeSeason(rows[rows.length - 1], teamIdx, leagueIdx);
    out.tot = careerTuples(rows);
    out.pk = peakTuples(rows, leagueIdx);
    out.cl = [...new Set(rows.map((r) => teamIdx.get(r.teamId)).filter((i) => i !== undefined))];
  }
  return out;
}

function encodeSeason(r, teamIdx, leagueIdx) {
  return SEASON_COLS.map((c) => {
    if (c === "teamId") return teamIdx.get(r.teamId) ?? -1;
    if (c === "leagueId") return leagueIdx.get(r.leagueId) ?? -1;
    return r[c] ?? null;
  });
}

function decodeSeason(row, cols, teams, leagues) {
  const out = {};
  cols.forEach((c, i) => {
    if (c === "teamId") out[c] = typeof row[i] === "number" ? teams[row[i]]?.id ?? "" : row[i];
    else if (c === "leagueId") out[c] = typeof row[i] === "number" ? leagues[row[i]]?.id ?? "" : row[i];
    else out[c] = row[i];
  });
  return out;
}

function decodePlayer(p, cols, teams, leagues) {
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (["seasons", "n", "cur", "tot", "pk", "cl"].includes(k)) continue;
    if (k === "teamId") { out.teamId = typeof v === "number" ? teams[v]?.id ?? "" : v; continue; }
    if (k === "leagueId") { out.leagueId = typeof v === "number" ? leagues[v]?.id ?? "" : v; continue; }
    out[k] = v;
  }
  out.seasons = [];
  return out;
}

/* --------------------------------- writing -------------------------------- */

const data = JSON.parse(await readFile(SRC, "utf8"));
const teamIdx = new Map(data.teams.map((t, i) => [t.id, i]));
const leagueIdx = new Map(data.leagues.map((l, i) => [l.id, i]));

const players = data.players.map((p) => encodePlayer(p, teamIdx, leagueIdx));
// the newest row already travels in the index as `cur`, so the history file carries only the rows
// before it — otherwise every player's latest season would be downloaded twice
const seasonRows = data.players.map((p) =>
  (p.seasons ?? []).slice(0, -1).map((r) => encodeSeason(r, teamIdx, leagueIdx)),
);

const years = data.players
  .flatMap((p) => (p.seasons ?? []).map((s) => Number(s.season)))
  .filter(Boolean);

const index = {
  format: FORMAT_INDEX,
  seasonCols: SEASON_COLS,
  careerCols: CAREER_COLS,
  // the two files are written together from one data.json; the decoder refuses to pair a stale
  // history with a newer index, so `generated` has to travel in both
  generated: data.meta?.generated ?? "",
  stats: {
    players: data.players.length,
    teams: data.teams.length,
    leagues: data.leagues.length,
    seasons: data.players.reduce((n, p) => n + (p.seasons?.length ?? 0), 0),
    first: years.length ? String(Math.min(...years)) : "",
    last: years.length ? String(Math.max(...years)) : "",
  },
  meta: data.meta,
  leagues: data.leagues,
  teams: data.teams,
  history: data.history,
  players,
};

const seasons = {
  format: FORMAT_SEASONS,
  seasonCols: SEASON_COLS,
  generated: index.generated,
  // the newest row of each player is in the index (`cur`); this is every earlier row
  players: seasonRows,
};

const indexBody = JSON.stringify(index);
const seasonsBody = JSON.stringify(seasons);
await writeFile(INDEX_OUT, indexBody);
await writeFile(SEASONS_OUT, seasonsBody);
await rm(LEGACY_OUT, { force: true });

const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
const src = (await readFile(SRC)).length;
const decoded = data.players.reduce(
  (n, p) => n + JSON.stringify(p.seasons ?? []).length,
  0,
);
console.log(`source:  ${mb(src)} decoded`);
console.log(`index:   ${mb(indexBody.length)} decoded  (${mb(src - decoded)} of data.json without seasons)`);
console.log(`seasons: ${mb(seasonsBody.length)} decoded  (was ${mb(decoded)} as objects)`);

if (process.argv.includes("--check")) {
  const problems = [];
  const report = (msg) => {
    if (problems.length < 12) console.log("  " + msg);
    problems.push(msg);
  };

  const cols = index.seasonCols;
  const back = index.players.map((p) => decodePlayer(p, cols, index.teams, index.leagues));

  if (back.length !== data.players.length) report(`player count ${back.length} ≠ ${data.players.length}`);
  if (seasons.players.length !== index.players.length) report("history is not one array per player");
  if (seasons.generated !== index.generated) report("the two files were not written from one dataset");

  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;

  for (const [i, p] of data.players.entries()) {
    const got = back[i];
    const wire = index.players[i];
    // the history file holds every row but the newest, which rides in the index as `cur`
    const rows = seasons.players[i] ?? [];
    const rebuilt = [...rows];
    if (p.seasons.length) rebuilt.push(wire.cur);
    if (p.seasons.length !== rebuilt.length) report(`${p.slug}: history rows ${rebuilt.length} ≠ ${p.seasons.length}`);

    for (const [k, v] of Object.entries(p)) {
      if (k === "seasons") continue;
      const gotV = got[k];
      if (isEmpty(v) && (gotV === undefined || isEmpty(gotV))) continue;
      if (JSON.stringify(gotV) !== JSON.stringify(v)) report(`${p.slug}.${k}: ${JSON.stringify(gotV)} ≠ ${JSON.stringify(v)}`);
    }

    for (const [j, s] of p.seasons.entries()) {
      const g = decodeSeason(rebuilt[j] ?? [], cols, index.teams, index.leagues);
      for (const c of cols) {
        const want = s[c] ?? null;
        const have = g[c] ?? null;
        if (want === null && have === null) continue;
        if (typeof want === "number" && typeof have === "number" ? !near(want, have) : want !== have) {
          report(`${p.slug} season ${j} ${c}: ${have} ≠ ${want}`);
        }
      }
    }

    // the summaries must equal what the client would compute from the rows
    if (p.seasons.length) {
      const latest = decodeSeason(wire.cur, cols, index.teams, index.leagues);
      const last = p.seasons[p.seasons.length - 1];
      for (const c of cols) {
        const want = last[c] ?? null;
        const have = latest[c] ?? null;
        if (want === null && have === null) continue;
        if (typeof want === "number" && typeof have === "number" ? !near(want, have) : want !== have) {
          report(`${p.slug} current.${c}: ${have} ≠ ${want}`);
        }
      }
      const totals = careerTuples(p.seasons);
      if (wire.tot.length !== totals.length) report(`${p.slug}: career tuple length`);
      totals.forEach((v, k) => {
        if (!near(v, wire.tot[k])) report(`${p.slug} career.${CAREER_COLS[k]}: ${wire.tot[k]} ≠ ${v}`);
      });
      const peaks = peakTuples(p.seasons, leagueIdx);
      if (peaks.length !== wire.pk.length) report(`${p.slug}: peak count ${wire.pk.length} ≠ ${peaks.length}`);
      peaks.forEach((row, k) => {
        const have = wire.pk[k] ?? [];
        if (row[0] !== have[0] || !near(row[1], have[1]) || !near(row[2], have[2]) || row[3] !== have[3]) {
          report(`${p.slug} peak ${k}: ${JSON.stringify(have)} ≠ ${JSON.stringify(row)}`);
        }
      });
      if (!wire.cl.length) report(`${p.slug}: no clubs`);
    }

    if (problems.length > 20) break;
  }

  console.log("round trip:", problems.length === 0 ? "OK" : `${problems.length} differences`);
  if (problems.length) process.exitCode = 1;
}
