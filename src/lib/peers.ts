import type { Player } from "./types";
import { data, teamById } from "./data";

/**
 * Where a player sits among his peers for the season he is being shown.
 * Comparisons stay inside one position group, league and season — "12th of 94
 * attackmen in Division I" is a claim we can defend from the data we hold.
 */

export type PeerRank = { label: string; rank: number; pool: number; value: string };

const GROUPS: Record<string, string[]> = {
  A: ["A"],
  M: ["M", "SSDM"],
  D: ["D", "LSM"],
  FO: ["FO"],
  G: ["G"],
};

export function peerRanks(player: Player): PeerRank[] {
  const season = player.seasons.reduce<string | null>(
    (best, s) => (!best || s.season > best ? s.season : best),
    null,
  );
  if (!season) return [];

  const row = player.seasons.find((s) => s.season === season);
  if (!row) return [];

  const group = GROUPS[player.position] ?? ["M", "SSDM"];
  const isGoal = player.position === "G";

  const peers = data.players.filter(
    (p) => p.leagueId === player.leagueId && group.includes(p.position),
  );

  const values = new Map<string, number>();
  for (const p of peers) {
    const s = p.seasons.find((x) => x.season === season);
    if (!s) continue;
    const gp = s.gp || 0;
    if (gp < 5) continue;
    values.set(p.id, isGoal ? (s.sv + s.ga > 0 ? (s.sv / (s.sv + s.ga)) * 100 : 0) : (s.pts || 0) / gp);
  }
  if (!values.size) return [];

  const mine = isGoal
    ? row.sv + row.ga > 0
      ? (row.sv / (row.sv + row.ga)) * 100
      : 0
    : (row.pts || 0) / Math.max(1, row.gp || 0);

  const sorted = [...values.entries()].sort((a, b) => b[1] - a[1]);
  const rank = sorted.findIndex(([id]) => id === player.id) + 1;

  const out: PeerRank[] = [];
  if (rank > 0) {
    out.push({
      label: isGoal ? "Save %" : "Points / game",
      rank,
      pool: sorted.length,
      value: isGoal ? `${mine.toFixed(1)}%` : mine.toFixed(2),
    });
  }

  if (!isGoal) {
    const gVals = peers
      .map((p) => {
        const s = p.seasons.find((x) => x.season === season);
        return s && (s.gp || 0) >= 5 ? { id: p.id, v: (s.g || 0) / Math.max(1, s.gp || 0) } : null;
      })
      .filter((x): x is { id: string; v: number } => Boolean(x))
      .sort((a, b) => b.v - a.v);
    const gRank = gVals.findIndex((x) => x.id === player.id) + 1;
    if (gRank > 0) {
      out.push({
        label: "Goals / game",
        rank: gRank,
        pool: gVals.length,
        value: ((row.g || 0) / Math.max(1, row.gp || 0)).toFixed(2),
      });
    }
  }

  return out;
}

/** Season label used in the copy, e.g. "2026 Division I". */
export function contextLabel(player: Player): string {
  const team = teamById.get(player.teamId);
  const league = data.leagues.find((l) => l.id === player.leagueId);
  return [team?.shortName, league?.short].filter(Boolean).join(" · ");
}
