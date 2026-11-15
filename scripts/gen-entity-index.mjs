#!/usr/bin/env node
/**
 * Build a compact per-entity index for the meta function.
 *
 * The function has to answer /player/cj-kirst with the right title, description and
 * preview image without loading the 18 MB dataset or touching a database, so the index is
 * generated at build time and bundled into it. Arrays rather than objects: 22k entries
 * twice over is megabytes, and the field order is fixed here.
 *
 *   players: slug  → [name, club, league, position, statLine]
 *   teams:   slug  → [name, league, city, record]
 *   leagues: id    → [name, level, teamCount, playerCount]
 *
 * Usage: node scripts/gen-entity-index.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "netlify/functions/entity-index.json");

const data = JSON.parse(await readFile(join(ROOT, "public/data.json"), "utf8"));
const teamById = new Map(data.teams.map((t) => [t.id, t]));
const leagueById = new Map(data.leagues.map((l) => [l.id, l]));

const statLine = (p) => {
  const rows = (p.seasons ?? []).filter((s) => (s.gp ?? 0) > 0);
  if (!rows.length) return "";
  const last = rows[rows.length - 1];
  const pts = last.pts ?? (last.g ?? 0) + (last.a ?? 0);
  const bits = [
    last.season,
    `${pts} ${p.position === "G" ? "points" : "PTS"}`,
    `${last.gp} GP`,
  ];
  return bits.join(" · ");
};

const players = {};
for (const p of data.players) {
  if (!p.slug) continue;
  const team = teamById.get(p.teamId);
  const league = leagueById.get(p.leagueId);
  players[p.slug] = [
    p.name,
    team?.name ?? "",
    league?.short ?? league?.name ?? "",
    p.positionName ?? "",
    statLine(p),
  ];
}

const teams = {};
for (const t of data.teams) {
  if (!t.slug) continue;
  const league = leagueById.get(t.leagueId);
  const rec = t.record ? `${t.record.w}–${t.record.l}` : "";
  teams[t.slug] = [t.name, league?.name ?? "", t.cityName || t.city || "", rec];
}

const leagues = {};
for (const l of data.leagues) {
  leagues[l.id] = [
    l.name,
    l.level,
    String(data.teams.filter((t) => t.leagueId === l.id).length),
    String(data.players.filter((p) => p.leagueId === l.id).length),
  ];
}

const payload = { generated: data.meta?.generated ?? "", players, teams, leagues };
await writeFile(OUT, JSON.stringify(payload));
const kb = (JSON.stringify(payload).length / 1024).toFixed(0);
console.log(
  `entity index: ${Object.keys(players).length} players, ${Object.keys(teams).length} teams, ` +
    `${Object.keys(leagues).length} leagues → netlify/functions/entity-index.json (${kb} KB)`,
);
