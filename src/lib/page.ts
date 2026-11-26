import type { Team, League, Player } from "./types";

/**
 * A route whose data came from `/data/page` rather than the dataset file.
 *
 * Same contract as src/lib/slice.ts: when this is set, `data` holds one route's worth of rows, so
 * nothing may assume the full dataset is in memory and any navigation becomes a document load.
 */
export type LeagueCardRow = {
  league: League;
  teams: number;
  players: number;
  top: {
    slug: string; id: string; name: string; position: string; positionName: string;
    teamId: string; leagueId: string; photo: string | null; pts: number | null;
  } | null;
};

export type TeamRow = {
  id: string; slug: string; name: string; shortName: string; conference: string | null;
  leagueId: string; logo: string | null; city: string | null; players: number; pts: number;
};

export type LeaderRow = {
  slug: string; name: string; position: string; positionName: string; teamId: string;
  photo: string | null; team: string;
  gp: number; g: number; a: number; pts: number; sh: number; gb: number; ct: number;
  foW: number; foA: number; sv: number; ga: number; w: number; l: number;
  adj?: number | null;
};

export type LeagueRowSlice = {
  slug: string; name: string; position: string; positionName: string; teamId: string;
  photo: string | null; season: string;
  gp: number; g: number; a: number; pts: number; sh: number; gb: number; ct: number;
  foW: number; foA: number; sv: number; ga: number; w: number; l: number;
};

export type OriginRow = { label: string; count: number };

export type TeamSeasonRow = {
  season: string; leagueId: string; players: number;
  leader: { slug: string; name: string; pts: number } | null;
};

export type PlayerSetSlice = {
  route: "/player-set";
  generated: string; playerCount: number; span: [string, string];
  meta: { generated?: string; season?: string; sources?: string[] } | null;
  players: Player[]; teams: Team[]; leagues: League[];
};

export type TeamSetSlice = {
  route: "/team-set";
  generated: string; playerCount: number; span: [string, string];
  meta: { generated?: string; season?: string; sources?: string[] } | null;
  teams: Team[]; allTeams: Team[]; leagues: League[];
};

export type HomeLeaderRow = {
  slug: string; name: string; position: string; positionName: string; photo: string | null;
  teamId: string; classYear?: number | null; gp?: number; value: number;
};

export type HomeSlice = {
  route: "/home";
  generated: string; playerCount: number; seasonCount: number; span: [string, string]; season: string;
  meta: { generated?: string; season?: string; sources?: string[] } | null;
  leagues: (League & { players: number })[];
  teams: Team[];
  leaders: Record<string, HomeLeaderRow[]>;
  featured: Player[];
  spotlight: (Player & { peak?: number; peakSeason?: string })[];
  history: unknown;
};

export type PageSlice =
  | { route: "/leagues"; totalPlayers: number; leagues: League[]; cards: LeagueCardRow[] }
  | { route: "/teams"; leagues: League[]; teams: TeamRow[] }
  | {
      route: "/scores"; generated: string; playerCount: number; span: [string, string];
      meta: { generated?: string; season?: string; sources?: string[] } | null;
      leagues: League[]; teams: TeamRow[];
    }
  | { route: "/coaches"; leagues: League[]; teams: (TeamRow & { staff: unknown[] | null })[] }
  | HomeSlice
  | {
      route: "/origins"; generated: string; playerCount: number; span: [string, string];
      meta: { generated?: string; season?: string; sources?: string[] } | null;
      teams: { id: string; slug: string; name: string; shortName: string; colors: unknown; logo: string | null }[];
      origins: { teamId: string; state: string; school: string }[];
    }
  | {
      route: "/history"; history: unknown;
      teams: { id: string; slug: string; name: string; shortName: string; colors: unknown; logo: string | null }[];
      span: [string, string]; generated: string; playerCount: number;
      meta: { generated?: string; season?: string; sources?: string[] } | null;
      players: { key: string; slug: string; name: string }[];
      climbers: {
        slug: string; name: string; position: string; positionName: string; photo: string | null;
        teamId: string; stat: "pts" | "g" | "a"; career: number; cutoff: number; leader: number;
        leaderName: string; bestSeason: number; seasons: number; seasonsNeeded: number;
      }[];
    }
  | {
      route: "/team"; team: Team; league: League | null; generated: string; history: unknown;
      meta: { generated?: string; season?: string; sources?: string[] } | null;
      playerCount: number; span: [string, string];
      stats: { gp: number; gpg: number; gapg: number; shotPct: number; foPct: number; savePct: number };
      roster: {
        slug: string; name: string; position: string; positionName: string;
        photo: string | null; classYear: string | null;
        gp: number; g: number; a: number; pts: number; seasons: number;
        careerPts: number; seasonPts: number; seasonGp: number;
        seasonG: number; seasonA: number; seasonGb: number; seasonCt: number;
      }[];
      seasons: TeamSeasonRow[];
      series: { season: string; rows: { opponent: string; w: number; l: number; last: string; result: string }[] };
      opponents: { id: string; slug: string; name: string; shortName: string }[];
      franchise: { players: number; seasons: number; points: number };
      rosterTotals: { players: number; seasons: number; points: number };
      playedUnder: Record<string, { first: number; last: number }>;
      returning: {
        from: string; to: string; totalPoints: number; returningPoints: number; share: number;
        kept: number; lost: { name: string; slug: string; pts: number }[];
      } | null;
      origins: { schools: OriginRow[]; towns: OriginRow[] };
    }
  | {
      route: "/league"; league: League; teams: TeamRow[]; players: number; careerGoals: number;
      span: [string, string]; origins: { schools: OriginRow[]; towns: OriginRow[] };
      rows: LeagueRowSlice[];
    }
  | {
      route: "/leaders"; generated: string; league: string; scope: "season" | "career"; season: string;
      seasons: string[]; leagues: League[]; leaguePpg: number; rows: LeaderRow[];
    }
  | { route: string; [k: string]: unknown };

let current: PageSlice | null = null;

export function setPageSlice(slice: PageSlice | null): void {
  current = slice;
}

/** Non-null only on a page load that was answered by the database. */
export function pageSlice(route: string): PageSlice | null {
  return current && current.route === route ? current : null;
}

export const pageSliceActive = (): boolean => current !== null;

/** A leaderboard row as the page's avatar and link expect it. */
export function leaderPlayer(r: LeaderRow): Player {
  return {
    id: r.slug, slug: r.slug, name: r.name,
    firstName: (r.name ?? "").split(" ")[0] ?? "",
    lastName: (r.name ?? "").split(" ").slice(1).join(" "),
    position: r.position, positionName: r.positionName,
    teamId: r.teamId, leagueId: "",
    photo: r.photo ? `${import.meta.env.BASE_URL}${r.photo}` : undefined,
    seasons: [],
  } as unknown as Player;
}

/** The leader on a league card is drawn with the same avatar component as everywhere else. */
export function miniPlayer(row: NonNullable<LeagueCardRow["top"]>): Player {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    firstName: (row.name ?? "").split(" ")[0] ?? "",
    lastName: (row.name ?? "").split(" ").slice(1).join(" "),
    position: row.position,
    positionName: row.positionName,
    teamId: row.teamId,
    leagueId: row.leagueId,
    photo: row.photo ? `${import.meta.env.BASE_URL}${row.photo}` : undefined,
    seasons: [{ season: "", teamId: row.teamId, leagueId: row.leagueId, type: "regular", pts: row.pts ?? 0 }],
  } as unknown as Player;
}
