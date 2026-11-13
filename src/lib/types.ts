export type Position = "A" | "M" | "D" | "G" | "FO" | "LSM" | "F" | "T" | "R";

export interface StandingRow {
  teamId: string;
  rank: number;
  groupRank?: number;
  w: number;
  l: number;
  t: number;
  pct: number;
  gf: number;
  ga: number;
  confW?: number | null;
  confL?: number | null;
  group?: string;
}

export interface StaffMember {
  name: string;
  role: string;
}

export interface PollRow {
  rank: number;
  /** rank in the previous snapshot, null/absent when new to the poll */
  prev?: number | null;
  name: string;
  record: string;
  extra: string;
  teamId: string | null;
}

export interface Poll {
  key: string;
  source: string;
  fetched: string;
  rows: PollRow[];
}

export interface League {
  id: string;
  name: string;
  short: string;
  level: string;
  type: "field" | "box";
  country: string;
  tier: number;
  strength: number;
  standings?: StandingRow[];
  ratings?: { teamId: string; elo: number; sos: number; rank: number }[];
  polls?: Poll[];
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  slug: string;
  leagueId: string;
  city: string;
  cityName: string;
  region: string;
  conference: string;
  colors: [string, string];
  staff?: StaffMember[];
  logo?: string;
  pollRanks?: Record<string, number>;
  elo?: number;
  sos?: number;
  /** final regular-season records for earlier campaigns (ESPN results) */
  history?: { season: string; w: number; l: number; gf: number; ga: number }[];
  /** clubs that were renamed: one franchise, several names (Wikipedia lineage) */
  franchise?: {
    id: string;
    /** where the grouping came from: a documented rename, or two feed names for one club */
    source?: "wiki" | "alias";
    names: { name: string; from: number | null; to: number | null; teamId?: string | null }[];
  };
  record?: {
    w: number; l: number; t: number; pct: number; rank: number; teams: number;
    overallRank?: number; overallTeams?: number; group?: string;
  };
}

export interface SeasonRow {
  season: string;
  teamId: string;
  leagueId: string;
  type: string;
  gp: number;
  gs: number;
  g: number;
  a: number;
  pts: number | null;
  sh: number;
  gb: number;
  to: number;
  ct: number;
  foW: number;
  foA: number;
  pen: number;
  min: number;
  ga: number;
  sv: number;
  w: number;
  l: number;
  /** published rates from the source, used when raw counts aren't available */
  gaa?: number | null;
  svp?: number | null;
}

export interface GameRow {
  date: string;
  opponent: string;
  result: string;
  g: number;
  a: number;
  gb: number;
  ct: number;
  sv: number | null;
  ga: number | null;
  foW: number;
  foA: number;
}

export interface Award {
  year: number;
  title: string;
  team: string;
}

export interface Ranking {
  source: string;
  label: string;
  rank: number;
  year: number;
}

export interface Draft {
  league: string;
  year: number;
  round: number;
  pick: number;
  team: string;
}

export interface Player {
  id: string;
  slug: string;
  firstName: string;
  lastName: string;
  name: string;
  position: Position;
  positionName: string;
  hand: string;
  heightIn: number;
  weightLb: number;
  dob: string;
  birthplace: { city: string; state: string; country: string };
  classYear: number | null;
  gradYear: number;
  highSchool: string;
  teamId: string;
  leagueId: string;
  jersey: number;
  status: string;
  commit: { college: string; year: number } | null;
  draft: Draft | null;
  rankings: Ranking[];
  awards: Award[];
  scouting: {
    report: string;
    author: string;
    date: string;
    grades: Record<string, number>;
  };
  photo?: string;
  experience?: number;
  bio: string;
  strengths: string[];
  seasons: SeasonRow[];
  /** the league's own career aggregate (box feeds publish this separately) */
  careerLine?: {
    gp: number; g: number; a: number; pts: number; pen: number; seasons: number; w?: number; l?: number;
  } | null;
  games: GameRow[];
}

export interface Champion {
  year: number;
  team: string;
  teamId: string | null;
}

export interface ProgramTitles {
  team: string;
  titles: number;
  years: number[];
  teamId: string | null;
}

export interface TewaaratonWinner {
  year: number;
  player: string;
  school: string;
  position: string;
  teamId: string | null;
}

export interface RecordSection {
  key: string;
  scope: "career" | "season" | "program";
  label: string;
  columns: string[];
  rows: Record<string, string>[];
}

export interface AllAmericanPlayer {
  name: string;
  school: string;
  class: string;
  position: string;
  teamId: string | null;
}

export interface AllAmericanBlock {
  division: string;
  year: number;
  source: string;
  teams: { team: string; players: AllAmericanPlayer[] }[];
}

export interface Dataset {
  meta: { generated: string; dataset: string; season: string; sources?: string[] };
  leagues: League[];
  teams: Team[];
  players: Player[];
  history?: {
    champions: Champion[];
    programs: ProgramTitles[];
    tewaaraton: TewaaratonWinner[];
    records?: { source: string; sections: RecordSection[] };
    allAmericans?: AllAmericanBlock[];
    sources: string[];
  };
}
