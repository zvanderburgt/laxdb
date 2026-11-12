import type { GameRow, Player, Team } from "./types";
import { data } from "./data";

/**
 * Season series against each opponent, rebuilt from the box scores we already hold.
 *
 * A program's schedule is not published as structured data, but every one of its players'
 * game logs lists the same fixtures, so de-duplicating (date, opponent) recovers it.
 * Only the season the log covers is reported — no all-time claim is made.
 */

export type Series = { opponent: string; w: number; l: number; last: string; result: string };

export function seriesFor(team: Team, games: Record<string, GameRow[]>): { season: string; rows: Series[] } | null {
  const roster = data.players.filter((p) => p.teamId === team.id);
  const seasons = [...new Set(roster.flatMap((p) => p.seasons.filter((s) => s.teamId === team.id).map((s) => s.season)))]
    .sort()
    .reverse();
  if (!seasons.length) return null;

  // the newest season whose players actually carry logs
  let season = "";
  let fixtures: { date: string; opponent: string; result: string }[] = [];
  for (const s of seasons) {
    const ids = new Set(
      roster.filter((p) => p.seasons.some((x) => x.teamId === team.id && x.season === s)).map((p) => p.id),
    );
    const seen = new Map<string, { date: string; opponent: string; result: string }>();
    for (const id of ids) {
      for (const g of games[id] ?? []) {
        if (!g.date || !g.opponent || !g.result) continue;
        if (g.date.slice(0, 4) !== s) continue;
        seen.set(`${g.date}|${g.opponent}`, { date: g.date, opponent: g.opponent, result: g.result });
      }
    }
    if (seen.size >= 5) {
      season = s;
      fixtures = [...seen.values()];
      break;
    }
  }
  if (!season) return null;

  const byOpp = new Map<string, Series>();
  for (const f of fixtures.sort((a, b) => a.date.localeCompare(b.date))) {
    const row = byOpp.get(f.opponent) ?? { opponent: f.opponent, w: 0, l: 0, last: f.date, result: "" };
    if (f.result === "W") row.w += 1;
    else if (f.result === "L") row.l += 1;
    row.last = f.date;
    row.result = f.result;
    byOpp.set(f.opponent, row);
  }

  return {
    season,
    rows: [...byOpp.values()].sort((a, b) => b.last.localeCompare(a.last)),
  };
}
