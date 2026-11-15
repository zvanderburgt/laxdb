#!/usr/bin/env node
/**
 * Re-encode public/data.json into the wire format the app fetches (`public/data.wire.json`).
 *
 * The dataset is 18 MB on disk and most of it is repetition: 38k season rows printing the same 21
 * keys, and 21,943 player objects printing empty strings for fields the UI restores anyway. JSON
 * keys and empty values cost as much as the numbers.
 *
 * The wire file keeps the information in a shape that is cheap to ship and parse:
 *   - season rows become positional arrays against one `seasonCols` header;
 *   - club ids become indices into `teams` / `leagues`;
 *   - player fields holding an empty value ("", [], {}, null, 0) are dropped — `normalizePlayer()`
 *     in src/lib/data.ts puts the same defaults back at load.
 *
 * `src/lib/wire.ts` decodes it. Round-trip check:
 *
 *   node scripts/compact-data.mjs --check
 *
 * Usage: node scripts/compact-data.mjs [--check]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "public/data.json");
const OUT = join(ROOT, "public/data.wire.json");

const SEASON_COLS = [
  "season", "teamId", "leagueId", "type", "gp", "gs", "g", "a", "pts",
  "sh", "gb", "to", "ct", "foW", "foA", "pen", "min", "ga", "sv", "w", "l",
];

/** fields whose empty value the client restores to something meaningful, so they can go */
const KEEP_ALWAYS = new Set([
  "id", "slug", "name", "firstName", "lastName", "position", "positionName", "dob", "status",
]);

const isEmpty = (v) => {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
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
  format: "laxdb-wire/1",
  seasonCols: SEASON_COLS,
  meta: data.meta,
  leagues: data.leagues,
  teams: data.teams,
  history: data.history,
  players: data.players.map((p) => encodePlayer(p, teamIdx, leagueIdx)),
};

const body = JSON.stringify(wire);
await writeFile(OUT, body);

const src = (await readFile(SRC)).length;
console.log(
  `wire: ${(src / 1e6).toFixed(2)} MB → ${(body.length / 1e6).toFixed(2)} MB ` +
    `(${(100 - (body.length / src) * 100).toFixed(0)}% smaller, uncompressed)`,
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
