import type { Dataset, Player, SeasonRow, Team, League, Position } from "./types";

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
export const leagueById = new Map<string, League>();

export let PLAYER_COUNT = 0;
export let TEAM_COUNT = 0;
export let SEASON_COUNT = 0;
export let CURRENT = "";

/** The dataset is ~9 MB, so it ships as a static file and is fetched once. */
export async function loadDataset(): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}data.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`dataset fetch failed: ${res.status}`);
  data = (await res.json()) as Dataset;

  for (const p of data.players) {
    playerById.set(p.id, p);
    playerBySlug.set(p.slug, p);
  }
  for (const t of data.teams) {
    teamById.set(t.id, t);
    teamBySlug.set(t.slug, t);
  }
  for (const l of data.leagues) leagueById.set(l.id, l);

  PLAYER_COUNT = data.players.length;
  TEAM_COUNT = data.teams.length;
  SEASON_COUNT = data.players.reduce((n, p) => n + p.seasons.length, 0);
  CURRENT = data.meta.season;
}

export const positionLabel: Record<string, string> = {
  A: "Attack",
  M: "Midfield",
  D: "Defense",
  G: "Goalie",
  FO: "Faceoff",
  LSM: "LSM",
};

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

export const currentSeason = (p: Player): SeasonRow =>
  p.seasons[p.seasons.length - 1] as SeasonRow;

export function careerTotals(p: Player) {
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

export function rosterOf(teamId: string) {
  return data.players
    .filter((p) => p.teamId === teamId)
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

export function searchPlayers(q: string, limit = 8): Player[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return data.players
    .map((p) => {
      const name = p.name.toLowerCase();
      const team = (teamOf(p)?.name ?? "").toLowerCase();
      let score = 0;
      if (name === needle) score = 100;
      else if (name.startsWith(needle)) score = 80;
      else if (name.includes(needle)) score = 60;
      else if (team.includes(needle)) score = 30;
      else if (p.highSchool.toLowerCase().includes(needle)) score = 20;
      return { p, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((r) => r.p);
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
  return [...new Set(data.players.map((p) => p.birthplace.state))].sort();
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
