import type { CareerTotals, Dataset, GameRow, Player, SeasonRow, Team, League, Position } from "./types";
import { decodeDataset, type WireDataset } from "./wire";
import { setSlice, type PlayerSlice } from "./slice";
import { enableListMode } from "./list";
import { setPageSlice, type PageSlice } from "./page";
import { useEffect, useState } from "react";

/** Populated by loadDataset() before the app renders (see main.tsx). */
export let data: Dataset = {
  meta: { generated: "", dataset: "Loading", season: "" },
  leagues: [],
  teams: [],
  players: [],
};

export const playerById = new Map<string, Player>();
export const playerBySlug = new Map<string, Player>();
export const teamById = new Map<string, Team>();
export const teamBySlug = new Map<string, Team>();

/** Loose team lookup for feed names ("North Carolina Tar Heels" ⇄ "North Carolina"). */
let teamNameIndex: Map<string, Team> | null = null;
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function teamByName(name: string): Team | undefined {
  if (!teamNameIndex) {
    teamNameIndex = new Map();
    for (const t of data.teams) {
      for (const n of [t.name, t.shortName, t.slug.replace(/-/g, " ")]) {
        if (!n) continue;
        teamNameIndex.set(nameKey(n), t);
      }
    }
  }
  const key = nameKey(name);
  const direct = teamNameIndex.get(key);
  if (direct) return direct;
  for (const [k, t] of teamNameIndex) {
    if (k.startsWith(key) || key.startsWith(k)) return t;
  }
  return undefined;
}
/**
 * Loose player lookup by printed name ("CJ Kirst" ⇄ "C.J. Kirst"). Record books,
 * All-America lists and Tewaaraton winners carry names, not ids.
 */
let playerNameIndex: Map<string, Player> | null = null;
export function playerByName(name: string): Player | undefined {
  if (!playerNameIndex) {
    playerNameIndex = new Map();
    const rank = (p: Player) => (p.photo ? 1000 : 0) + p.seasons.length;
    for (const p of data.players) {
      const key = nameKey(p.name);
      const cur = playerNameIndex.get(key);
      if (!cur || rank(p) > rank(cur)) playerNameIndex.set(key, p);
    }
  }
  const key = nameKey(name);
  if (!key) return undefined;
  const direct = playerNameIndex.get(key);
  if (direct) return direct;
  // one-token difference ("Kirst" vs "CJ Kirst") only when the token is distinctive
  if (key.length < 6) return undefined;
  for (const [k, p] of playerNameIndex) {
    if (k.length >= 6 && (k.endsWith(key) || key.endsWith(k))) return p;
  }
  return undefined;
}

export const leagueById = new Map<string, League>();

export let PLAYER_COUNT = 0;
export let TEAM_COUNT = 0;
export let SEASON_COUNT = 0;
export let CURRENT = "";
/** the span of seasons the dataset holds, as strings ("2020", "2026") */
export let SEASON_RANGE: [string, string] = ["", ""];

/**
 * The dataset ships as one static file and is fetched once. `data.wire.json` is the compact
 * encoding `scripts/compact-data.mjs` writes at build time (35% smaller, same in-memory shape);
 * `data.json` is the fallback for a deploy or a cached shell that predates it.
 */
/**
 * The database answers the two routes it has been verified for (docs/supabase-migration.md, step 6).
 * `?slice=0` on any URL forces the dataset file, which is the escape hatch and the revert.
 */
function forceWire(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("slice") === "0";
}

function sliceSlug(): string | null {
  if (typeof window === "undefined" || forceWire()) return null;
  const hit = window.location.pathname.match(/^\/player\/([^/]+)\/?$/);
  return hit ? decodeURIComponent(hit[1]) : null;
}

/** One redirect to the dataset-backed page, and only one: a failure on that page shows the error. */
export function fallbackToWire(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("slice") === "0") return;
  url.searchParams.set("slice", "0");
  window.location.replace(url.toString());
}

/** Routes the database answers through /data/page (docs/supabase-migration.md, "route coverage"). */
const PAGE_ROUTES = new Set(["/leagues", "/teams"]);

function pageRoute(): string | null {
  if (typeof window === "undefined" || forceWire()) return null;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return PAGE_ROUTES.has(path) ? path : null;
}

/**
 * One route's data from the database. Returns false when the endpoint has no branch for the route,
 * and the caller falls through to the dataset file — a missing slice must never be a broken page.
 */
async function loadPageSlice(base: string, route: string): Promise<boolean> {
  let slice: PageSlice;
  try {
    const res = await fetch(`${base}data/page?path=${encodeURIComponent(route)}`, { cache: "no-cache" });
    if (!res.ok) return false;
    slice = (await res.json()) as PageSlice;
  } catch {
    return false;
  }

  if (slice.route !== "/leagues" && slice.route !== "/teams") return false;

  data = {
    meta: { generated: "", dataset: "Supabase", season: "", sources: [] },
    leagues: slice.leagues as Dataset["leagues"],
    // the teams directory draws its own rows; they are the same shape the dataset holds
    teams: (slice.route === "/teams"
      ? (slice as Extract<PageSlice, { route: "/teams" }>).teams
      : []) as unknown as Dataset["teams"],
    players: [],
  } as Dataset;
  for (const l of data.leagues) leagueById.set(l.id, l);
  for (const t of data.teams) {
    t.logo = assetUrl(t.logo);
    teamById.set(t.id, t);
    teamBySlug.set(t.slug, t);
  }

  PLAYER_COUNT = slice.route === "/leagues" ? (slice as Extract<PageSlice, { route: "/leagues" }>).totalPlayers : 0;
  TEAM_COUNT = 0;
  SEASON_COUNT = 0;
  CURRENT = "";
  SEASON_RANGE = ["", ""];
  setPageSlice(slice);
  return true;
}

function listSlice(): boolean {
  if (typeof window === "undefined" || forceWire()) return false;
  return /^\/players\/?$/.test(window.location.pathname);
}

export async function loadDataset(): Promise<void> {
  const base = import.meta.env.BASE_URL;

  const slug = sliceSlug();
  if (slug) {
    await loadSlice(slug);
    return;
  }
  const page = pageRoute();
  if (page && (await loadPageSlice(base, page))) return;

  if (listSlice()) {
    // the table asks the database for its page; there is no dataset to load at all
    enableListMode();
    PLAYER_COUNT = 0;
    TEAM_COUNT = 0;
    SEASON_COUNT = 0;
    CURRENT = "";
    SEASON_RANGE = ["", ""];
    return;
  }
  let res = await fetch(`${base}data.wire.json`, { cache: "no-cache" });
  let payload: Dataset | WireDataset;
  if (res.ok) {
    payload = decodeDataset((await res.json()) as WireDataset);
  } else {
    res = await fetch(`${base}data.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`dataset fetch failed: ${res.status}`);
    payload = (await res.json()) as Dataset;
  }
  data = payload as Dataset;

  for (const p of data.players) {
    normalizePlayer(p);
    playerById.set(p.id, p);
    playerBySlug.set(p.slug, p);
  }
  for (const t of data.teams) {
    t.logo = assetUrl(t.logo);
    teamById.set(t.id, t);
    teamBySlug.set(t.slug, t);
  }
  for (const l of data.leagues) leagueById.set(l.id, l);

  PLAYER_COUNT = data.players.length;
  TEAM_COUNT = data.teams.length;
  SEASON_COUNT = data.players.reduce((n, p) => n + p.seasons.length, 0);
  CURRENT = data.meta.season;

  const years = data.players.flatMap((p) => p.seasons.map((s) => Number(s.season))).filter(Boolean);
  SEASON_RANGE = years.length ? [String(Math.min(...years)), String(Math.max(...years))] : ["", ""];
}

/**
 * One route, answered by Postgres: the page's player, the teams and leagues its lookups need, and
 * the three blocks (peers, similarity, teammates) already computed server-side. `data.players` is
 * only ever these players, so nothing here may fall back to scanning it — see src/lib/slice.ts.
 */
async function loadSlice(slug: string): Promise<void> {
  const base = import.meta.env.BASE_URL;
  let slice: PlayerSlice;
  try {
    const res = await fetch(`${base}data/player?slug=${encodeURIComponent(slug)}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`slice fetch failed: ${res.status}`);
    slice = (await res.json()) as PlayerSlice;
  } catch (err) {
    // the dataset is still on the CDN: one redirect and the page is the old page, not an error
    fallbackToWire();
    throw err;
  }

  const players = [slice.player, ...slice.mates, ...slice.similar.map((s) => s.player)];
  for (const p of players) normalizePlayer(p);
  const seen = new Set<string>();
  data = {
    meta: {
      generated: slice.generated.slice(0, 10),
      dataset: "Supabase",
      season: String(
        Math.max(...slice.player.seasons.map((s) => Number(s.season) || 0)),
      ),
      sources: [],
    },
    leagues: slice.leagues,
    teams: slice.teams,
    players,
    history: slice.history as Dataset["history"],
  } as Dataset;

  for (const p of players) {
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    playerById.set(p.id, p);
    playerBySlug.set(p.slug, p);
  }
  for (const t of data.teams) {
    t.logo = assetUrl(t.logo);
    teamById.set(t.id, t);
    teamBySlug.set(t.slug, t);
  }
  for (const l of data.leagues) leagueById.set(l.id, l);

  setSlice(slice);

  PLAYER_COUNT = data.players.length;
  TEAM_COUNT = data.teams.length;
  SEASON_COUNT = data.players.reduce((n, p) => n + p.seasons.length, 0);
  CURRENT = data.meta.season;
  const years = slice.player.seasons.map((s) => Number(s.season)).filter(Boolean);
  SEASON_RANGE = years.length ? [String(Math.min(...years)), String(Math.max(...years))] : ["", ""];
}

/** The writer and the CMS store asset paths relative to the deploy root ("players/pll/x.webp").
 *  A detail route such as /player/cj-kirst has a directory base, so a bare relative src resolves
 *  against that directory and asks for /player/players/… (404). Resolve every dataset asset path
 *  against the site root once, at ingest. */
export function assetUrl(path?: string): string | undefined {
  if (!path) return undefined;
  if (/^(?:[a-z]+:)?\/\//i.test(path) || /^(?:data|blob):/i.test(path) || path.startsWith("/")) return path;
  return `/${path.replace(/^\.\//, "")}`;
}

/** The writer omits empty fields; restore the shape the UI expects, once. */
function normalizePlayer(p: Player) {
  p.photo = assetUrl(p.photo) ?? "";
  p.awards ??= [];
  p.rankings ??= [];
  p.strengths ??= [];
  p.games ??= [];
  p.scouting ??= { report: "", author: "", date: "", grades: {} };
  p.birthplace ??= { city: "", state: "", country: "" };
  p.bio ??= "";
  p.highSchool ??= "";
  p.hand ??= "";
  p.dob ??= "";
  p.classYear ??= null;
  p.jersey ??= 0;
  p.heightIn ??= 0;
  p.weightLb ??= 0;
  p.experience ??= 0;
  p.commit ??= null;
  p.draft ??= null;
  p.photo ??= "";
}

export const POLL_LABELS: Record<string, string> = {
  committee: "Committee",
  rpi: "RPI",
  usila: "Coaches",
};

export const positionLabel: Record<string, string> = {
  A: "Attack",
  M: "Midfield",
  D: "Defense",
  G: "Goalie",
  FO: "Faceoff",
  LSM: "LSM",
  F: "Forward",
  T: "Transition",
  R: "Runner",       // a box skater whose feed does not publish a position
};

/** Every position code we can render, in the order a filter row should read. */
export const positionOrder = ["A", "F", "T", "M", "D", "R", "LSM", "FO", "G"] as const;

export const teamOf = (p: Player): Team | undefined => teamById.get(p.teamId);
export const leagueOf = (p: Player): League | undefined => leagueById.get(p.leagueId);
export const leagueFor = (id: string): League | undefined => leagueById.get(id);
export const teamName = (id: string) => teamById.get(id)?.shortName ?? "—";

export const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const fmtHeight = (inches: number) =>
  inches > 0 ? `${Math.floor(inches / 12)}'${inches % 12}"` : "—";

export const ageOf = (dob: string) => {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date(data.meta.generated);
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
};

export const fmtDate = (iso: string) =>
  new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const EMPTY_SEASON: SeasonRow = {
  season: "", teamId: "", leagueId: "", type: "", gp: 0, gs: 0, g: 0, a: 0, pts: 0, sh: 0, gb: 0,
  to: 0, ct: 0, foW: 0, foA: 0, pen: 0, min: 0, ga: 0, sv: 0, w: 0, l: 0,
};

/** The newest season row; a zero row when a player has none, so printing a stat is always safe. */
export const currentSeason = (p: Player): SeasonRow =>
  p.seasons.length ? p.seasons[p.seasons.length - 1] : EMPTY_SEASON;

export function careerTotals(p: Player): CareerTotals {
  const sum = (k: keyof SeasonRow) =>
    p.seasons.reduce((n, s) => n + (Number(s[k]) || 0), 0);
  const gp = sum("gp");
  const g = sum("g");
  const a = sum("a");
  const sv = sum("sv");
  const ga = sum("ga");
  const min = sum("min");
  const foW = sum("foW");
  const foA = sum("foA");
  return {
    gp,
    g,
    a,
    pts: g + a,
    sh: sum("sh"),
    gb: sum("gb"),
    to: sum("to"),
    ct: sum("ct"),
    pen: sum("pen"),
    sv,
    ga,
    min,
    foW,
    foA,
    w: sum("w"),
    l: sum("l"),
    gaa: weightedRate(p.seasons, "gaa", min ? (ga * 60) / min : 0),
    svp: weightedRate(p.seasons, "svp", sv + ga ? sv / (sv + ga) : 0),
    fop: foW + foA ? foW / (foW + foA) : 0,
    ppg: gp ? (g + a) / gp : 0,
  };
}

/** Box-league feeds publish GAA/SV% instead of raw minutes/saves. */
function weightedRate(rows: { gp: number; gaa?: number | null; svp?: number | null }[], key: "gaa" | "svp", fallback: number) {
  const published = rows.filter((s) => typeof s[key] === "number" && (s[key] as number) > 0);
  if (!published.length) return fallback;
  const weight = published.reduce((n, s) => n + Math.max(1, s.gp || 0), 0);
  return published.reduce((n, s) => n + (s[key] as number) * Math.max(1, s.gp || 0), 0) / weight;
}

export function seasonTotals(rows: SeasonRow[]) {
  const sum = (k: keyof SeasonRow) => rows.reduce((n, s) => n + (Number(s[k]) || 0), 0);
  const gp = sum("gp");
  const g = sum("g");
  const a = sum("a");
  const sv = sum("sv");
  const ga = sum("ga");
  const min = sum("min");
  return {
    gp,
    g,
    a,
    pts: g + a,
    sh: sum("sh"),
    gb: sum("gb"),
    to: sum("to"),
    ct: sum("ct"),
    foW: sum("foW"),
    foA: sum("foA"),
    pen: sum("pen"),
    sv,
    ga,
    min,
    w: sum("w"),
    l: sum("l"),
    gaa: weightedRate(rows, "gaa", min ? (ga * 60) / min : 0),
    svp: weightedRate(rows, "svp", sv + ga ? sv / (sv + ga) : 0),
    fop: sum("foW") + sum("foA") ? sum("foW") / (sum("foW") + sum("foA")) : 0,
    ppg: gp ? (g + a) / gp : 0,
  };
}

/* ------------------------------ game logs ---------------------------------- */

let gamesPromise: Promise<Record<string, GameRow[]>> | null = null;

/** Game logs ship separately (~1.3 MB) so the main payload stays lean. */
export function loadGames(): Promise<Record<string, GameRow[]>> {
  if (!gamesPromise) {
    gamesPromise = fetch(`${import.meta.env.BASE_URL}games.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return gamesPromise;
}

export function rosterOf(teamId: string) {
  // any season with the club counts: a player who moved keeps their history on every
  // team they actually played for, not just the one they finished on
  return data.players
    .filter((p) => p.teamId === teamId || p.seasons.some((s) => s.teamId === teamId))
    .sort((a, b) => (careerTotals(b).pts || 0) - (careerTotals(a).pts || 0));
}

export function leaderboard(leagueId: string, stat: "pts" | "g" | "a" | "gb" | "ct" | "svp", limit = 10) {
  return data.players
    .filter((p) => p.leagueId === leagueId)
    .map((p) => {
      const s = currentSeason(p);
      const val =
        stat === "svp"
          ? s.sv + s.ga > 0
            ? s.sv / (s.sv + s.ga)
            : 0
          : (s[stat] as number) || 0;
      return { player: p, value: val, season: s };
    })
    .filter((r) => r.season.gp >= 5 && (stat === "svp" ? r.season.sv > 20 : true))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/* --------------------------------- search ---------------------------------- */

/**
 * Punctuation-insensitive search key. Nobody types the apostrophe, so it has to
 * disappear rather than become a separator: "O'Neill" → "oneill" (not "o neill"),
 * while "St. Mary's" → "st marys" because a period separates words.
 */
export function searchKey(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const words = (s: string) => searchKey(s).split(" ").filter(Boolean);

/** Every token of the query prefixes some word of the text ("cj kirst" ⇄ "C.J. Kirst"). */
function prefixesAll(textWords: string[], query: string[]): boolean {
  return query.length > 0 && query.every((q) => textWords.some((w) => w.startsWith(q)));
}

type SearchRow = { p: Player; name: string; nameWords: string[]; teamWords: string[]; schoolWords: string[] };

let searchRows: SearchRow[] | null = null;
let searchRowById: Map<string, SearchRow> | null = null;

/** Built once on the first keystroke — 21,943 keys is too much to rebuild per letter. */
function searchIndex(): SearchRow[] {
  if (searchRows) return searchRows;
  searchRows = data.players.map((p) => ({
    p,
    name: searchKey(p.name),
    nameWords: words(p.name),
    teamWords: words(teamOf(p)?.name ?? ""),
    schoolWords: words(p.highSchool ?? ""),
  }));
  searchRowById = new Map(searchRows.map((r) => [r.p.id, r]));
  return searchRows;
}

/** Tokenise once for a filter that runs over the whole table. */
export const searchTokens = (q: string): string[] => words(q);

/** Does this player match the typed query at all? Used by the table's name box. */
export function playerMatchesQuery(player: Player, q: string | string[]): boolean {
  const query = typeof q === "string" ? words(q) : q;
  if (!query.length) return true;
  searchIndex();
  const row = searchRowById?.get(player.id);
  if (!row) return false;
  // checked per field rather than merged into one array: this runs 21,943 times per
  // keystroke and the spread was allocating an array each time
  return query.every(
    (t) =>
      row.nameWords.some((w) => w.startsWith(t)) ||
      row.teamWords.some((w) => w.startsWith(t)) ||
      row.schoolWords.some((w) => w.startsWith(t)),
  );
}

export function searchPlayers(q: string, limit = 8): Player[] {
  const query = words(q);
  if (!query.length) return [];
  const needle = query.join(" ");
  const scored: { p: Player; score: number }[] = [];
  for (const row of searchIndex()) {
    let score = 0;
    if (row.name === needle) score = 1000;
    else if (row.name.startsWith(needle)) score = 900;
    else if (prefixesAll(row.nameWords, query)) score = 800;
    // initials typed with spaces: "c j kirst" ⇄ "C.J. Kirst"
    else if (row.name.replace(/ /g, "").startsWith(needle.replace(/ /g, ""))) score = 750;
    else if (row.name.includes(needle)) score = 700;
    else if (prefixesAll(row.teamWords, query)) score = 300;
    else if (prefixesAll(row.schoolWords, query)) score = 100;
    if (score) scored.push({ p: row.p, score });
  }
  // a name query must not be padded out with club and school matches: "teat" is
  // not "Penn State", and a five-name answer beats a five-name answer plus noise
  const hasNameHit = scored.some((r) => r.score >= 700);
  return (hasNameHit ? scored.filter((r) => r.score >= 700) : scored)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((r) => r.p);
}

/* ----------------------------- suggested players ---------------------------- */

const peakPts = (p: Player, leagueId?: string) => {
  const rows = leagueId ? p.seasons.filter((s) => s.leagueId === leagueId) : p.seasons;
  return rows.reduce((best, s) => Math.max(best, s.pts ?? 0), 0);
};
const totalGp = (p: Player) => p.seasons.reduce((n, s) => n + (s.gp ?? 0), 0);

/** The season a player is best known for — scoped to a competition when one is given. */
/**
 * The season a player is best known for, reduced to what the labels print — the hero strip and the
 * palette quote a points/season pair, not the whole row.
 */
export function peakLine(p: Player, leagueId?: string): { season: string; pts: number } | null {
  const best = peakSeason(p, leagueId);
  return best ? { season: best.season, pts: best.pts ?? 0 } : null;
}

export function peakSeason(p: Player, leagueId?: string): SeasonRow | null {
  const rows = leagueId ? p.seasons.filter((s) => s.leagueId === leagueId) : p.seasons;
  if (!rows.length) return null;
  return rows.reduce((best, s) => ((s.pts ?? 0) > (best.pts ?? 0) ? s : best), rows[0]);
}

const notableCache = new Map<string, Player[]>();

/**
 * The players a surface can offer as a starting point. Ranked on peak season, not
 * career totals (several older D1 seasons carry no stat rows), gated on a real
 * sample, and headshot-preferred so a strip of faces is actually faces.
 */
export function notablePlayers(
  n = 5,
  plan: [string, number][] = [["ncaa-d1", 2], ["pll", 2], ["nf-nll", 1], ["mcla", 1]],
): Player[] {
  const key = `${n}|${plan.map(([l, w]) => `${l}:${w}`).join(",")}`;
  const cached = notableCache.get(key);
  if (cached) return cached;

  const picks: Player[] = [];
  const seen = new Set<string>();
  const take = (pool: Player[], want: number) => {
    const withPhoto = pool.filter((p) => p.photo);
    const chosen = (withPhoto.length >= want ? withPhoto : pool).slice(0, want);
    for (const p of chosen) {
      if (seen.has(p.id) || picks.length >= n) continue;
      seen.add(p.id);
      picks.push(p);
    }
  };

  for (const [leagueId, want] of plan) {
    if (picks.length >= n) break;
    // rank and gate inside the competition itself: a 129-point junior box summer is
    // not a "leading D1 scorer", however good the player turns out to be
    const gpIn = (p: Player) => p.seasons.reduce((t, s) => t + (s.leagueId === leagueId ? s.gp ?? 0 : 0), 0);
    take(
      data.players
        .filter((p) => p.leagueId === leagueId && gpIn(p) >= 12 && peakPts(p, leagueId) > 0)
        .sort((a, b) => peakPts(b, leagueId) - peakPts(a, leagueId)),
      want,
    );
  }
  if (picks.length < n) {
    take(
      data.players.filter((p) => totalGp(p) >= 12 && peakPts(p) > 0).sort((a, b) => peakPts(b) - peakPts(a)),
      n - picks.length,
    );
  }

  const out = picks.slice(0, n);
  notableCache.set(key, out);
  return out;
}

export function similarPlayers(p: Player, n = 4): Player[] {
  const c = careerTotals(p);
  return data.players
    .filter((o) => o.id !== p.id)
    .map((o) => {
      const oc = careerTotals(o);
      const pos = o.position === p.position ? 0 : 26;
      const lg = o.leagueId === p.leagueId ? 0 : 10;
      const pts = Math.abs((oc.ppg || 0) - (c.ppg || 0)) * 9;
      const gb = Math.abs((oc.gb / Math.max(1, oc.gp)) - (c.gb / Math.max(1, c.gp))) * 2.2;
      const h = Math.abs(o.heightIn - p.heightIn) * 1.4;
      return { o, d: pos + lg + pts + gb + h };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((r) => r.o);
}

/** All-America selections from the USILA archive, matched on name plus program. */
type AaSel = { year: number; tier: string; division: string; teamId?: string | null; school: string };
let aaIndex: Map<string, AaSel[]> | null = null;

export function allAmericansFor(player: Player): { year: number; tier: string; division: string }[] {
  if (!aaIndex) {
    aaIndex = new Map();
    for (const block of data.history?.allAmericans ?? []) {
      for (const group of block.teams) {
        for (const sel of group.players) {
          const key = sel.name.toLowerCase().replace(/[^a-z]/g, "");
          const list = aaIndex.get(key) ?? [];
          list.push({ year: block.year, tier: group.team, division: block.division, teamId: sel.teamId, school: sel.school });
          aaIndex.set(key, list);
        }
      }
    }
  }
  const key = player.name.toLowerCase().replace(/[^a-z]/g, "");
  const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  // the honour belongs to the program he won it at, not the one he finished on: a
  // 2023 All-American who transferred in 2025 still played that 2023 season there
  const career = new Set<string>([player.teamId, ...player.seasons.map((s) => s.teamId)]);
  const mine = [...career]
    .flatMap((id) => {
      const t = teamById.get(id);
      return t ? [norm(t.name), norm(t.shortName)] : [];
    })
    .filter(Boolean);

  return (aaIndex.get(key) ?? [])
    .filter((sel) => {
      if (sel.teamId) return career.has(sel.teamId);
      // selections the PDF could not link to a program: require the school text to agree
      const school = norm(sel.school);
      return Boolean(school) && mine.some((t) => school.includes(t) || t.includes(school));
    })
    .map(({ year, tier, division }) => ({ year, tier, division }));
}

/** Tewaaraton winners we can place on a profile (13 of the 25 ever awarded). */
let tewaaratonIndex: Map<string, { year: number; school: string }[]> | null = null;

export function tewaaratonFor(player: Player): { year: number; school: string }[] {
  if (!tewaaratonIndex) {
    tewaaratonIndex = new Map();
    for (const w of data.history?.tewaaraton ?? []) {
      const key = nameKey(w.player);
      if (!key) continue;
      const list = tewaaratonIndex.get(key) ?? [];
      list.push({ year: w.year, school: w.school });
      tewaaratonIndex.set(key, list);
    }
  }
  return tewaaratonIndex.get(nameKey(player.name)) ?? [];
}

export function pctRank(value: number, pool: number[]): number {
  if (!pool.length) return 0;
  const below = pool.filter((v) => v < value).length;
  return Math.round((below / pool.length) * 100);
}

export function statPool(position: Position | string, key: "ppg" | "gbpg" | "ctpg"): number[] {
  return data.players
    .filter((p) => p.position === position)
    .map((p) => {
      const c = careerTotals(p);
      if (key === "ppg") return c.ppg;
      if (key === "gbpg") return c.gb / Math.max(1, c.gp);
      return c.ct / Math.max(1, c.gp);
    });
}

export const teamLogo = (t?: Team) => (t ? t.colors : (["#0071e3", "#5ac8fa"] as [string, string]));

export function leagueTeams(leagueId: string) {
  return data.teams.filter((t) => t.leagueId === leagueId);
}

export function leaguePlayerCount(leagueId: string) {
  return data.players.filter((p) => p.leagueId === leagueId).length;
}

export function topLeaguesByLevel() {
  const groups = new Map<string, League[]>();
  for (const l of data.leagues) {
    const arr = groups.get(l.level) ?? [];
    arr.push(l);
    groups.set(l.level, arr);
  }
  return [...groups.entries()];
}

export function classYears(): number[] {
  return [...new Set(data.players.map((p) => p.classYear).filter((y): y is number => !!y))].sort();
}

export function statesList(): string[] {
  // a player with no recorded birthplace must not add a blank option to the filter
  return [...new Set(data.players.map((p) => p.birthplace.state).filter(Boolean))].sort();
}


/* ------------------------------------------------------------------ *
 * Derived views: teammates, recruiting origins, ratings
 * All memoised once — the dataset is ~17k players, never recompute per render.
 * ------------------------------------------------------------------ */

let rosterIndex: Map<string, Player[]> | null = null;

/** Built on first use — `data` is empty until loadDataset() resolves. */
function rosterByTeamSeason() {
  if (rosterIndex) return rosterIndex;
  const byKey = new Map<string, Player[]>();
  for (const p of data.players) {
    for (const s of p.seasons) {
      const key = `${s.teamId}|${s.season}`;
      const arr = byKey.get(key);
      if (arr) arr.push(p);
      else byKey.set(key, [p]);
    }
  }
  rosterIndex = byKey;
  return byKey;
}

const teammateIndex = new Map<string, Player[]>();

/** Everyone who shared a team-season with this player, best career first. */
export function teammatesOf(player: Player): Player[] {
  const cached = teammateIndex.get(player.id);
  if (cached) return cached;
  const seen = new Map<string, Player>();
  const index = rosterByTeamSeason();
  for (const s of player.seasons) {
    for (const mate of index.get(`${s.teamId}|${s.season}`) ?? []) {
      if (mate.id !== player.id && !seen.has(mate.id)) seen.set(mate.id, mate);
    }
  }
  const list = [...seen.values()].sort((a, b) => careerTotals(b).pts - careerTotals(a).pts);
  teammateIndex.set(player.id, list);
  return list;
}

export type OriginRow = { label: string; count: number };

const originCache = new Map<string, { schools: OriginRow[]; towns: OriginRow[] }>();

/** Top high schools and hometowns feeding a set of players. */
export function originsOf(players: Player[]) {
  const schools = new Map<string, number>();
  const towns = new Map<string, number>();
  for (const p of players) {
    const hs = (p.highSchool ?? "").trim();
    if (hs) schools.set(hs, (schools.get(hs) ?? 0) + 1);
    const town = [p.birthplace?.city, p.birthplace?.state].filter(Boolean).join(", ").trim();
    if (town) towns.set(town, (towns.get(town) ?? 0) + 1);
  }
  const top = (m: Map<string, number>, n = 6): OriginRow[] =>
    [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, n);
  return { schools: top(schools), towns: top(towns) };
}

export function teamOrigins(teamId: string) {
  const key = `team:${teamId}`;
  if (!originCache.has(key)) originCache.set(key, originsOf(data.players.filter((p) => p.teamId === teamId)));
  return originCache.get(key)!;
}

export function leagueOrigins(leagueId: string) {
  const key = `league:${leagueId}`;
  if (!originCache.has(key)) originCache.set(key, originsOf(data.players.filter((p) => p.leagueId === leagueId)));
  return originCache.get(key)!;
}

/** Players from one high school or hometown, for the origins lists to link into search. */
export function playersFromSchool(school: string) {
  return data.players.filter((p) => p.highSchool === school).length;
}

export const ratedTeams = (leagueId: string) => {
  const league = leagueById.get(leagueId);
  if (!league?.ratings?.length) return [];
  return league.ratings
    .map((r) => ({ ...r, team: teamById.get(r.teamId) }))
    .filter((r) => r.team);
};


/** Team-level season totals rolled up from the roster + standings goals for/against. */
const teamStatCache = new Map<string, {
  gp: number; gpg: number; gapg: number; shotPct: number; foPct: number; savePct: number;
}>();

export function teamSeasonStats(teamId: string) {
  const cached = teamStatCache.get(teamId);
  if (cached) return cached;
  const roster = data.players.filter((p) => p.teamId === teamId);
  let gp = 0, g = 0, sh = 0, sv = 0, ga = 0, foW = 0, foA = 0;
  for (const p of roster) {
    const s = currentSeason(p);
    gp = Math.max(gp, s.gp);
    g += s.g;
    sh += s.sh;
    sv += s.sv;
    ga += s.ga;
    foW += s.foW;
    foA += s.foA;
  }
  const team = teamById.get(teamId);
  const played = team?.record ? team.record.w + team.record.l + team.record.t : 0;
  const out = {
    gp: gp || played,
    gpg: gp ? g / gp : 0,
    gapg: 0,
    shotPct: sh ? (g / sh) * 100 : 0,
    foPct: foA ? (foW / foA) * 100 : 0,
    savePct: sv + ga ? (sv / (sv + ga)) * 100 : 0,
  };
  const standingsRow = data.leagues
    .flatMap((l) => l.standings ?? [])
    .find((r) => r.teamId === teamId);
  if (standingsRow && standingsRow.w + standingsRow.l + standingsRow.t > 0) {
    const games = standingsRow.w + standingsRow.l + standingsRow.t;
    out.gapg = standingsRow.ga / games;
    out.gpg = standingsRow.gf / games;
  }
  teamStatCache.set(teamId, out);
  return out;
}


/** Game rows for one player, fetched on first use. `null` while loading. */
export function usePlayerGames(playerId: string): GameRow[] | null {
  const [games, setGames] = useState<GameRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    setGames(null);
    loadGames().then((all) => {
      if (alive) setGames(all[playerId] ?? []);
    });
    return () => {
      alive = false;
    };
  }, [playerId]);
  return games;
}


/** Single-game highs and recent form from a player's game rows. */
export function gameSummary(games: GameRow[]) {
  const n = games.length;
  const avg = (rows: GameRow[], f: (g: GameRow) => number) =>
    rows.length ? rows.reduce((s, g) => s + f(g), 0) / rows.length : 0;
  const max = (f: (g: GameRow) => number) => games.reduce((m, g) => Math.max(m, f(g)), 0);
  const pts = (g: GameRow) => g.g + g.a;

  const last5 = games.slice(-5);
  const best = games.reduce<GameRow | null>(
    (b, g) => (!b || pts(g) > pts(b) ? g : b),
    null
  );
  let streak = 0;
  for (let i = games.length - 1; i >= 0; i--) {
    if (pts(games[i]) > 0) streak++;
    else break;
  }
  return {
    games: n,
    last5: {
      gp: last5.length,
      pts: avg(last5, pts),
      g: avg(last5, (g) => g.g),
      a: avg(last5, (g) => g.a),
      sv: avg(last5, (g) => g.sv ?? 0),
      ga: avg(last5, (g) => g.ga ?? 0),
      shots: last5.reduce((n, g) => n + (g.sv ?? 0) + (g.ga ?? 0), 0),
    },
    highs: {
      g: max((g) => g.g),
      a: max((g) => g.a),
      pts: max(pts),
      gb: max((g) => g.gb),
      ct: max((g) => g.ct),
      sv: max((g) => g.sv ?? 0),
    },
    best: best
      ? { g: best.g, a: best.a, pts: pts(best), opponent: best.opponent, date: best.date }
      : null,
    streak,
    /** the last few results, newest last, for the form strip */
    form: games.slice(-8).map((g) => g.result),
  };
}
