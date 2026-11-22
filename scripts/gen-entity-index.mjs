#!/usr/bin/env node
/**
 * Build a compact per-entity index for the meta and OG-card functions.
 *
 * The function has to answer /player/cj-kirst with the right title, description and preview image
 * without loading the 23 MB dataset or touching a database, so the index is generated at build time
 * and bundled into it. Arrays rather than objects: 27k entries twice over is megabytes, and the field
 * order is fixed here.
 *
 *   players: slug  → [name, club, league, position, statLine, colour1, colour2, [careerPts, careerGp, careerG, careerA], series, goalieStats, svSeries]
 *   teams:   slug  → [name, league, city, record, elo, playerCount, seasonCount, colour1, colour2, topScorers]
 *   leagues: id    → [name, level, teamCount, playerCount, firstSeason, lastSeason, topScorers]
 *
 * `series` is the last four scoring seasons as [["2024", 93], …] — the share card draws it as bars.
 * `topScorers` is a league's three best career scorers, as [[name, pts], …].
 *
 * Usage: node scripts/gen-entity-index.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
/** what the meta function needs: a title, a description, a canonical */
const OUT = join(ROOT, "netlify/functions/entity-index.json");
/** what the share-card function needs: the same rows plus colours, careers, series, leaders */
const CARDS = join(ROOT, "netlify/functions/entity-cards.json");

const data = JSON.parse(await readFile(join(ROOT, "public/data.json"), "utf8"));
const teamById = new Map(data.teams.map((t) => [t.id, t]));
const leagueById = new Map(data.leagues.map((l) => [l.id, l]));
const FALLBACK = ["#0071e3", "#5ac8fa"];

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

/** Points by season for the card's bar chart: summed per season, last four with a stat line. */
const series = (p) => {
  const bySeason = new Map();
  for (const s of p.seasons ?? []) {
    if (!(s.gp ?? 0)) continue;
    bySeason.set(String(s.season), (bySeason.get(String(s.season)) ?? 0) + (s.pts ?? 0));
  }
  if (bySeason.size < 2) return null;
  return [...bySeason.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-4);
};

const career = (p) => {
  let pts = 0;
  let gp = 0;
  let g = 0;
  let a = 0;
  for (const s of p.seasons ?? []) {
    pts += s.pts ?? (s.g ?? 0) + (s.a ?? 0);
    gp += s.gp ?? 0;
    g += s.g ?? 0;
    a += s.a ?? 0;
  }
  return [pts, gp, g, a];
};

/** A goalie's card: saves, save percentage, GAA and games, plus save % by season. */
const goalieStats = (p) => {
  if (p.position !== "G") return [null, null];
  const rows = p.seasons ?? [];
  const sum = (k) => rows.reduce((n, s) => n + (Number(s[k]) || 0), 0);
  const gp = sum("gp");
  const sv = sum("sv");
  const ga = sum("ga");
  const min = sum("min");
  // box feeds publish the rates instead of raw minutes/saves, weighted by games played
  const weighted = (key, fallback) => {
    const pub = rows.filter((s) => typeof s[key] === "number" && s[key] > 0);
    if (!pub.length) return fallback;
    const w = pub.reduce((n, s) => n + Math.max(1, s.gp || 0), 0);
    return pub.reduce((n, s) => n + s[key] * Math.max(1, s.gp || 0), 0) / w;
  };
  const svp = weighted("svp", sv + ga ? sv / (sv + ga) : 0);
  const gaa = weighted("gaa", min ? (ga * 60) / min : 0);

  const bySeason = new Map();
  for (const s of rows) {
    if (!(s.gp ?? 0)) continue;
    const row = s.sv + s.ga ? s.sv / (s.sv + s.ga) : typeof s.svp === "number" ? s.svp : null;
    if (row === null) continue;
    bySeason.set(String(s.season), Number((row * 100).toFixed(1)));
  }
  const svSeries = bySeason.size > 1 ? [...bySeason.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-4) : null;
  return [[sv, ga, Number((svp * 100).toFixed(1)), Number(gaa.toFixed(2)), gp], svSeries];
};

const players = {};
for (const p of data.players) {
  if (!p.slug) continue;
  const team = teamById.get(p.teamId);
  const league = leagueById.get(p.leagueId);
  const [c1, c2] = team?.colors ?? FALLBACK;
  const [pts, gp, g, a] = career(p);
  const [goalie, svSeries] = goalieStats(p);
  players[p.slug] = [
    p.name,
    team?.name ?? "",
    league?.short ?? league?.name ?? "",
    p.positionName ?? "",
    statLine(p),
    c1,
    c2,
    [pts, gp, g, a],
    series(p),
    goalie,
    svSeries,
  ];
}

/* how many players and player-seasons each club holds, plus its three best career scorers */
const teamCounts = new Map();
const teamPoints = new Map();
for (const p of data.players) {
  for (const s of p.seasons ?? []) {
    const entry = teamCounts.get(s.teamId) ?? { players: new Set(), seasons: 0 };
    entry.players.add(p.id);
    entry.seasons += 1;
    teamCounts.set(s.teamId, entry);

    const list = teamPoints.get(s.teamId) ?? new Map();
    list.set(p.id, (list.get(p.id) ?? 0) + (s.pts ?? 0));
    teamPoints.set(s.teamId, list);
  }
}
const nameById = new Map(data.players.map((p) => [p.id, p.name]));
const topFor = (points) =>
  [...(points ?? new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, pts]) => [nameById.get(id) ?? "", pts]);

const teams = {};
for (const t of data.teams) {
  if (!t.slug) continue;
  const league = leagueById.get(t.leagueId);
  const rec = t.record ? `${t.record.w}–${t.record.l}` : "";
  const counts = teamCounts.get(t.id);
  const [c1, c2] = t.colors ?? FALLBACK;
  teams[t.slug] = [
    t.name,
    league?.name ?? "",
    t.cityName || t.city || "",
    rec,
    t.elo ? Math.round(t.elo) : 0,
    counts?.players.size ?? 0,
    counts?.seasons ?? 0,
    c1,
    c2,
    topFor(teamPoints.get(t.id)),
  ];
}

const seasonsOf = (leagueId) => {
  const years = data.players
    .filter((p) => p.leagueId === leagueId)
    .flatMap((p) => (p.seasons ?? []).map((s) => Number(s.season)))
    .filter(Boolean);
  return years.length ? [String(Math.min(...years)), String(Math.max(...years))] : ["", ""];
};

const leagueTotals = new Map();
for (const p of data.players) {
  let pts = 0;
  for (const s of p.seasons ?? []) pts += s.pts ?? 0;
  const list = leagueTotals.get(p.leagueId) ?? [];
  list.push({ name: p.name, pts });
  leagueTotals.set(p.leagueId, list);
}

const leagues = {};
for (const l of data.leagues) {
  const [first, last] = seasonsOf(l.id);
  const top = (leagueTotals.get(l.id) ?? [])
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 3)
    .map((r) => [r.name, r.pts]);
  leagues[l.id] = [
    l.name,
    l.level,
    String(data.teams.filter((t) => t.leagueId === l.id).length),
    String(data.players.filter((p) => p.leagueId === l.id).length),
    first,
    last,
    top,
  ];
}

const payload = { generated: data.meta?.generated ?? "", players, teams, leagues };

// the card file is the same rows untouched; the meta file is trimmed to the facts a <title>,
// description and canonical need, because meta.mjs is bundled into every entity response and its
// size is paid on each cold start (5.0 MB vs 2.0 MB is ~100 ms of parse a crawler never uses)
const thin = {
  generated: payload.generated,
  players: Object.fromEntries(Object.entries(players).map(([k, r]) => [k, r.slice(0, 5)])),
  teams: Object.fromEntries(Object.entries(teams).map(([k, r]) => [k, r.slice(0, 4)])),
  leagues: Object.fromEntries(Object.entries(leagues).map(([k, r]) => [k, r.slice(0, 4)])),
};

await writeFile(OUT, JSON.stringify(thin));
await writeFile(CARDS, JSON.stringify(payload));

const kb = (JSON.stringify(players).length / 1024).toFixed(0);
console.log(
  `entity index: ${Object.keys(players).length} players, ${Object.keys(teams).length} teams, ` +
    `${Object.keys(leagues).length} leagues → entity-index.json (${(JSON.stringify(thin).length / 1024).toFixed(0)} KB)` +
    ` + entity-cards.json (${(JSON.stringify(payload).length / 1024).toFixed(0)} KB)`,
);
