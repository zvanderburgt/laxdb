import { data, teamById } from "./data";
import type { Player } from "./types";

/**
 * "Active players climbing the record book."
 *
 * The NCAA career boards on `#/history` are all-time lists; a current player sits far below
 * them and nobody notices he is one season away. This compares an active D1 player's career
 * total against the *lowest* figure printed on the board and projects how many seasons of his
 * own best year it would take to pass it.
 *
 * Three honest limits, each printed in the UI:
 *  - the board is NCAA Division I, so only D1 seasons count and only D1 players qualify — a
 *    Junior B summer total is a different sport's arithmetic;
 *  - a career total is only complete if every season he played is in the dataset, so a player
 *    whose first season is the first season we hold is excluded (he may have played before);
 *  - the projection is "repeat his best season", not a forecast.
 */

export type Stat = "points" | "goals" | "assists";

export type Climb = {
  player: Player;
  stat: Stat;
  career: number;
  /** the last (lowest) figure printed on the board — passing it puts him on the list */
  cutoff: number;
  leader: number;
  leaderName: string;
  bestSeason: number;
  seasons: number;
  seasonsNeeded: number;
};

const BOARD: { key: string; stat: Stat; column: string }[] = [
  { key: "career-points", stat: "points", column: "Points" },
  { key: "career-goals", stat: "goals", column: "Goals" },
  { key: "career-assists", stat: "assists", column: "Assists" },
];

const num = (v: string | undefined) => Number(String(v ?? "").replace(/[^0-9]/g, "")) || 0;

/** Seasons the dataset covers; a career that starts here may be partial. */
export function careerWindow() {
  const years = data.players.flatMap((p) => p.seasons.map((s) => Number(s.season))).filter(Boolean);
  return { first: Math.min(...years), last: Math.max(...years) };
}

/** The board's stat, expressed as the SeasonRow field that holds it. */
const rowKey = (stat: Stat) => (stat === "points" ? "pts" : stat === "goals" ? "g" : "a") as "pts" | "g" | "a";

const valueOf = (rows: { g?: number; a?: number; pts?: number | null }[], stat: Stat) =>
  rows.reduce((n, s) => {
    const key = rowKey(stat);
    if (key === "pts") return n + (s.pts ?? (s.g ?? 0) + (s.a ?? 0));
    return n + (s[key] ?? 0);
  }, 0);

export function recordClimbers(limit = 6): Climb[] {
  const sections = data.history?.records?.sections ?? [];
  if (!sections.length) return [];
  const { first } = careerWindow();
  const latest = data.meta.season;

  const out: Climb[] = [];
  for (const board of BOARD) {
    const section = sections.find((s) => s.key === board.key);
    if (!section || section.rows.length < 2) continue;
    const values = section.rows.map((r) => num(r[board.column])).filter((n) => n > 0);
    if (values.length < 2) continue;
    const cutoff = Math.min(...values);
    const leader = Math.max(...values);
    const leaderName = section.rows.find((r) => num(r[board.column]) === leader)?.Player ?? "";

    for (const p of data.players) {
      const d1 = p.seasons.filter((s) => s.leagueId === "ncaa-d1").sort((a, b) => Number(a.season) - Number(b.season));
      if (d1.length < 2) continue;
      const active = d1.some((s) => s.season === latest && (s.gp ?? 0) > 0);
      if (!active) continue;
      // he started inside our window, so the total below is his whole college career
      if (Number(d1[0].season) <= first) continue;

      const career = valueOf(d1, board.stat);
      if (career < cutoff * 0.5 || career >= cutoff) continue;
      const bestSeason = Math.max(...d1.map((s) => (rowKey(board.stat) === "pts" ? s.pts ?? 0 : s[rowKey(board.stat)] ?? 0)));
      if (bestSeason <= 0) continue;

      const seasonsNeeded = Math.ceil((cutoff + 1 - career) / bestSeason);
      if (seasonsNeeded > 3) continue;
      out.push({
        player: p,
        stat: board.stat,
        career,
        cutoff,
        leader,
        leaderName,
        bestSeason,
        seasons: d1.length,
        seasonsNeeded,
      });
    }
  }

  // one row per player — the board he is closest to breaking into
  const best = new Map<string, Climb>();
  for (const c of out) {
    const cur = best.get(c.player.id);
    if (!cur || c.seasonsNeeded < cur.seasonsNeeded || (c.seasonsNeeded === cur.seasonsNeeded && c.career > cur.career)) {
      best.set(c.player.id, c);
    }
  }

  return [...best.values()]
    .sort((a, b) => a.seasonsNeeded - b.seasonsNeeded || b.career - a.career)
    .slice(0, limit);
}

/** The D1 program he did it at — his current club may be professional. */
export function d1Club(p: Player): string {
  const d1 = p.seasons.filter((s) => s.leagueId === "ncaa-d1").sort((a, b) => Number(a.season) - Number(b.season));
  const team = d1.length ? teamById.get(d1[d1.length - 1].teamId) : undefined;
  return team?.shortName ?? "";
}
