import type { GameRow, Player } from "./types";
import { data, teamByName } from "./data";

/**
 * Opponent-adjusted scoring.
 *
 * A goal against a top-five defence is worth more than one against a team outside the top
 * 50, so each game's output is multiplied by the opponent's Elo over the 1500 baseline
 * before averaging. It is a transparent weighting, not a modelled value: no possession or
 * shot-quality data is involved, and the page says so.
 */

export type Adjusted = {
  games: number;
  raw: number;
  adjusted: number;
  avgOppElo: number;
  ranked: number;
};

export function adjustedRate(games: GameRow[], player: Player): Adjusted | null {
  const withElo: { row: GameRow; elo: number }[] = [];
  for (const g of games) {
    const team = teamByName(g.opponent ?? "");
    const elo = team?.elo;
    if (!elo) continue;
    withElo.push({ row: g, elo });
  }
  if (withElo.length < 5) return null;

  const pts = (g: GameRow) => (g.g || 0) + (g.a || 0);
  const raw = withElo.reduce((n, x) => n + pts(x.row), 0) / withElo.length;
  const adjusted =
    withElo.reduce((n, x) => n + pts(x.row) * (x.elo / 1500), 0) / withElo.length;
  const avgOppElo = withElo.reduce((n, x) => n + x.elo, 0) / withElo.length;

  return {
    games: withElo.length,
    raw,
    adjusted,
    avgOppElo,
    ranked: withElo.filter((x) => (teamByName(x.row.opponent ?? "")?.pollRanks?.rpi ?? 99) <= 25).length,
  };
}

/** A player's rank on the adjusted rate inside their own competition and season. */
export function adjustedRank(player: Player, gamesById: Record<string, GameRow[]>): number | null {
  const mine = gamesById[player.id];
  if (!mine) return null;
  const mineAdj = adjustedRate(mine, player);
  if (!mineAdj) return null;

  const season = player.seasons.reduce<string | null>((b, s) => (!b || s.season > b ? s.season : b), null);
  let better = 0;
  let pool = 0;
  for (const p of data.players) {
    if (p.leagueId !== player.leagueId || p.position !== player.position) continue;
    if (season && !p.seasons.some((s) => s.season === season)) continue;
    const rows = gamesById[p.id];
    if (!rows) continue;
    const adj = adjustedRate(rows, p);
    if (!adj) continue;
    pool += 1;
    if (adj.adjusted > mineAdj.adjusted) better += 1;
  }
  return pool ? better + 1 : null;
}
