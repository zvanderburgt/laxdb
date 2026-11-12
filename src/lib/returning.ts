import type { Player, Team } from "./types";
import { data } from "./data";

/**
 * Returning production: how much of last season's offence came back.
 *
 * No feed publishes this, but with rosters per season it falls out of a join — the share of a
 * team's points from players who also appear on the next season's roster.
 */

export type Returning = {
  from: string;
  to: string;
  returningPoints: number;
  totalPoints: number;
  share: number;
  lost: { name: string; slug: string; pts: number }[];
  kept: number;
};

export function returningProduction(team: Team): Returning | null {
  const seasons = [...new Set(
    data.players.flatMap((p) => p.seasons.filter((s) => s.teamId === team.id).map((s) => s.season)),
  )].sort();
  if (seasons.length < 2) return null;

  const from = seasons[seasons.length - 2];
  const to = seasons[seasons.length - 1];

  const onTeam = (season: string) =>
    data.players.filter((p) => p.seasons.some((s) => s.teamId === team.id && s.season === season));

  const later = onTeam(to);
  const laterIds = new Set(later.map((p) => p.id));

  let totalPoints = 0;
  let returningPoints = 0;
  let kept = 0;
  const lost: { name: string; slug: string; pts: number }[] = [];

  for (const p of onTeam(from)) {
    const pts = p.seasons
      .filter((s) => s.teamId === team.id && s.season === from)
      .reduce((n, s) => n + (s.pts || 0), 0);
    totalPoints += pts;
    if (laterIds.has(p.id)) {
      returningPoints += pts;
      kept += 1;
    } else if (pts > 0) {
      lost.push({ name: p.name, slug: p.slug, pts });
    }
  }

  if (!totalPoints) return null;
  return {
    from,
    to,
    returningPoints,
    totalPoints,
    share: returningPoints / totalPoints,
    lost: lost.sort((a, b) => b.pts - a.pts).slice(0, 5),
    kept,
  };
}

export function playersWithGradYear(team: Team): Player[] {
  return data.players.filter((p) => p.teamId === team.id);
}
