#!/usr/bin/env node
/**
 * Re-encode public/data.json into the wire format the app fetches (`public/data.wire.json`).
 *
 * The dataset is 23.8 MB on disk and most of it is repetition: 54k season rows printing the same 23
 * keys, and 27k player objects printing empty strings for fields the UI restores anyway. JSON keys
 * and empty values cost as much as the numbers.
 *
 * The wire file keeps the information in a shape that is cheap to ship *and* cheap to compress:
 *   - season rows become positional arrays against one `seasonCols` header;
 *   - club ids become indices into `teams` / `leagues`;
 *   - player fields holding an empty value ("", [], {}, null, 0 — recursively) are dropped, and
 *     `normalizePlayer()` in src/lib/data.ts puts the same defaults back at load.
 *
 * One file, deliberately. A split into "index + season history" was shipped and then reverted on
 * measurement: the per-player summaries a list route needs (latest row, career totals, per-league
 * peak) cost 717 KB of the 1778 KB index, while the entire season history is 260 KB — the same
 * numbers re-expressed per player compress far worse than the rows do. One file is ~1320 KB, 34%
 * smaller than the split, with no second request and no gated routes.
 *
 *   node scripts/compact-data.mjs --check
 *
 * Usage: node scripts/compact-data.mjs [--check]
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "public/data.json");
const OUT = join(ROOT, "public/data.wire.json");
/** payloads from the split experiment, removed so a stale copy cannot ship */
const LEGACY_OUT = [join(ROOT, "public/index.wire.json"), join(ROOT, "public/seasons.wire.json")];

const FORMAT = "laxdb-wire/3";

/**
 * Season row layout. THE ORDER IS THE FORMAT — append to it and to `SeasonRow` together, or every row
 * in the file is silently misread. `gaa`/`svp` are the rates box feeds publish instead of raw minutes
 * and saves.
 */
const SEASON_COLS = [
  "season", "teamId", "leagueId", "type", "gp", "gs", "g", "a", "pts",
  "sh", "gb", "to", "ct", "foW", "foA", "pen", "min", "ga", "sv", "w", "l",
  "gaa", "svp",
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
    out.seasons = rows.map((r) =>
      SEASON_COLS.map((c) => {
        if (c === "teamId") return teamIdx.get(r.teamId) ?? -1;
        if (c === "leagueId") return leagueIdx.get(r.leagueId) ?? -1;
        return r[c] ?? null;
      }),
    );
  }
  return out;
}

function decodePlayer(p, cols, teams, leagues) {
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === "seasons") continue;
    if (k === "teamId") { out.teamId = typeof v === "number" ? teams[v]?.id ?? "" : v; continue; }
    if (k === "leagueId") { out.leagueId = typeof v === "number" ? leagues[v]?.id ?? "" : v; continue; }
    out[k] = v;
  }
  out.seasons = (p.seasons ?? []).map((row) => {
    const o = {};
    cols.forEach((c, i) => {
      if (c === "teamId") o[c] = typeof row[i] === "number" ? teams[row[i]]?.id ?? "" : row[i];
      else if (c === "leagueId") o[c] = typeof row[i] === "number" ? leagues[row[i]]?.id ?? "" : row[i];
      else o[c] = row[i];
    });
    return o;
  });
  return out;
}

const data = JSON.parse(await readFile(SRC, "utf8"));
const teamIdx = new Map(data.teams.map((t, i) => [t.id, i]));
const leagueIdx = new Map(data.leagues.map((l, i) => [l.id, i]));

const wire = {
  format: FORMAT,
  seasonCols: SEASON_COLS,
  meta: data.meta,
  leagues: data.leagues,
  teams: data.teams,
  history: data.history,
  players: data.players.map((p) => encodePlayer(p, teamIdx, leagueIdx)),
};

const body = JSON.stringify(wire);
await writeFile(OUT, body);
for (const stale of LEGACY_OUT) await rm(stale, { force: true });

const src = (await readFile(SRC)).length;
const rows = data.players.reduce((n, p) => n + (p.seasons ?? []).length, 0);
console.log(
  `wire: ${(src / 1e6).toFixed(2)} MB → ${(body.length / 1e6).toFixed(2)} MB ` +
    `(${(100 - (body.length / src) * 100).toFixed(0)}% smaller, uncompressed) · ${rows} season rows`,
);

if (process.argv.includes("--check")) {
  const back = wire.players.map((p) => decodePlayer(p, SEASON_COLS, wire.teams, wire.leagues));
  let problems = 0;
  const report = (msg) => {
    if (problems < 8) console.log("  " + msg);
    problems += 1;
  };
  if (back.length !== data.players.length) report(`player count ${back.length} ≠ ${data.players.length}`);
  for (const [i, p] of data.players.entries()) {
    const got = back[i];
    if (!got) { report(`missing player ${p.slug}`); continue; }
    if (p.seasons.length !== (got.seasons?.length ?? 0)) report(`season count ${p.slug}`);
    for (const [k, v] of Object.entries(p)) {
      if (k === "seasons") continue;
      const gotV = got[k];
      // an empty value may legitimately come back absent (the client defaults it)
      if (isEmpty(v) && (gotV === undefined || isEmpty(gotV))) continue;
      if (JSON.stringify(gotV) !== JSON.stringify(v)) report(`${p.slug}.${k}: ${JSON.stringify(gotV)} ≠ ${JSON.stringify(v)}`);
    }
    for (const [j, s] of p.seasons.entries()) {
      const g = got.seasons?.[j] ?? {};
      for (const c of SEASON_COLS) {
        const a = s[c] ?? null;
        const b = g[c] ?? null;
        if (a !== b) report(`${p.slug} season ${j} ${c}: ${b} ≠ ${a}`);
      }
    }
    if (problems > 20) break;
  }
  console.log("round trip:", problems === 0 ? "OK" : `${problems} differences`);
  if (problems) process.exitCode = 1;
}
