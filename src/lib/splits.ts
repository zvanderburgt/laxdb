import type { GameRow, Player, Team } from "./types";
import { data } from "./data";

/**
 * Situational splits over a player's game log.
 *
 * Only dimensions the log can actually support: month, result, and whether the opponent
 * finished the season in the RPI top 25. Home/away is not recorded in the box scores we
 * parse, so it is deliberately absent rather than guessed.
 */

export type Split = { key: string; gp: number; g: number; a: number; pts: number };
export type SplitGroup = { label: string; note?: string; rows: Split[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Opponent display name → team id, so a game row can be joined to a poll entry. */
let opponentIndex: Map<string, Team> | null = null;

function opponents(): Map<string, Team> {
  if (opponentIndex) return opponentIndex;
  const map = new Map<string, Team>();
  for (const t of data.teams) {
    for (const key of [t.name, t.shortName]) {
      const k = norm(key ?? "");
      if (k) map.set(k, t);
    }
  }
  opponentIndex = map;
  return map;
}

function rankedTeamIds(): Set<string> {
  const league = data.leagues.find((l) => l.id === "ncaa-d1");
  const poll = league?.polls?.find((p) => p.key === "rpi");
  const out = new Set<string>();
  for (const row of poll?.rows ?? []) {
    if (row.rank <= 25 && row.teamId) out.add(row.teamId);
  }
  return out;
}

function summarise(key: string, games: GameRow[]): Split {
  return {
    key,
    gp: games.length,
    g: games.reduce((n, g) => n + (g.g || 0), 0),
    a: games.reduce((n, g) => n + (g.a || 0), 0),
    pts: games.reduce((n, g) => n + (g.g || 0) + (g.a || 0), 0),
  };
}

export function splits(games: GameRow[], player: Player): SplitGroup[] {
  if (games.length < 4) return [];

  const months = new Map<string, GameRow[]>();
  for (const g of games) {
    const m = Number(g.date.slice(5, 7));
    const label = MONTHS[m - 1] ?? "—";
    months.set(label, [...(months.get(label) ?? []), g]);
  }
  const monthRows = MONTHS.filter((m) => months.has(m)).map((m) => summarise(m, months.get(m)!));

  const wins = games.filter((g) => g.result === "W");
  const losses = games.filter((g) => g.result === "L");

  const groups: SplitGroup[] = [
    { label: "By month", rows: monthRows },
    { label: "By result", rows: [summarise("Wins", wins), summarise("Losses", losses)].filter((r) => r.gp) },
  ];

  if (player.leagueId === "ncaa-d1") {
    const ranked = rankedTeamIds();
    const idx = opponents();
    const vsRanked: GameRow[] = [];
    const vsOther: GameRow[] = [];
    for (const g of games) {
      const team = idx.get(norm(g.opponent ?? ""));
      if (team && ranked.has(team.id)) vsRanked.push(g);
      else vsOther.push(g);
    }
    if (vsRanked.length) {
      groups.push({
        label: "By opponent",
        note: "Ranked = finished the season in the RPI top 25",
        rows: [summarise("vs ranked", vsRanked), summarise("vs unranked", vsOther)].filter((r) => r.gp),
      });
    }
  }

  return groups.filter((g) => g.rows.length > 1);
}
