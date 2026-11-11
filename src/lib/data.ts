import raw from "../data/dataset.json";
import type { Dataset, Player, SeasonRow, Team, League, Position } from "./types";

export const data = raw as unknown as Dataset;

export const playerById = new Map(data.players.map((p) => [p.id, p]));
export const playerBySlug = new Map(data.players.map((p) => [p.slug, p]));
export const teamById = new Map(data.teams.map((t) => [t.id, t]));
export const teamBySlug = new Map(data.teams.map((t) => [t.slug, t]));
export const leagueById = new Map(data.leagues.map((l) => [l.id, l]));

export const PLAYER_COUNT = data.players.length;
export const TEAM_COUNT = data.teams.length;
export const SEASON_COUNT = data.players.reduce((n, p) => n + p.seasons.length, 0);

export const CURRENT = data.meta.season;

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
    gaa: min ? (ga * 60) / min : 0,
    svp: sv + ga ? sv / (sv + ga) : 0,
    fop: foW + foA ? foW / (foW + foA) : 0,
    ppg: gp ? (g + a) / gp : 0,
  };
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
    sv,
    ga,
    min,
    gaa: min ? (ga * 60) / min : 0,
    svp: sv + ga ? sv / (sv + ga) : 0,
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
