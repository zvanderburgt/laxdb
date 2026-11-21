import type {
  CareerTotals,
  Dataset,
  League,
  Player,
  PlayerSummary,
  SeasonRow,
  Team,
} from "./types";

/**
 * The wire format, decoded into the objects the app already expects.
 *
 * `scripts/compact-data.mjs` writes two files from `public/data.json`:
 *
 * - `index.wire.json` — one record per player: id, name, bio, club, photo, and the three summaries a
 *   list needs (latest season, career totals, per-competition peak). Everything a table row or a card
 *   prints comes from here, so Home, Players, Teams, Origins, My roster and Compare never wait for
 *   the history.
 * - `seasons.wire.json` — the full season history, one tuple array per player, aligned to the index's
 *   player order. `applySeasonHistory()` writes it onto the players in place; the routes that need it
 *   (player page, Leaders, History, League boards, a team's season cards) gate on `useSeasons()`.
 *
 * Both files share one `seasonCols` header for the positional tuples, and club ids are indices into
 * `teams`/`leagues`. Player fields holding an empty value are dropped — `normalizePlayer()` in
 * `src/lib/data.ts` restores the same defaults at load. Nothing outside this file knows any of that.
 *
 * Why: 23.8 MB of `data.json` becomes a 13.7 MB index plus a 2.0 MB history (every row except each
 * player's newest, which the index already carries), and the history is off the first-paint path. A
 * new season-row field has to be appended to `SEASON_COLS` in the writer and to `SeasonRow`
 * together — the order **is** the format.
 */

export const INDEX_FORMAT = "laxdb-index/2";
export const SEASONS_FORMAT = "laxdb-seasons/2";

type WireSeason = (string | number | null)[];

type WirePlayer = Omit<Player, "seasons" | "teamId" | "leagueId"> & {
  teamId: number | string;
  leagueId: number | string;
  /** season-row count, so a count is right before the history arrives */
  n?: number;
  /** latest season row */
  cur?: WireSeason;
  /** career totals, against `careerCols` */
  tot?: number[];
  /** per competition: [leagueIdx, peak pts, games, the season that peak came from] */
  pk?: [number, number, number, string][];
  /** distinct clubs, as team indices */
  cl?: number[];
};

export type WireIndex = {
  format: string;
  seasonCols: (keyof SeasonRow)[];
  careerCols?: (keyof CareerTotals)[];
  generated?: string;
  stats?: { players: number; teams: number; leagues: number; seasons: number; first: string; last: string };
  meta: Dataset["meta"];
  leagues: League[];
  teams: Team[];
  history?: Dataset["history"];
  players: WirePlayer[];
};

export type WireSeasons = {
  format: string;
  seasonCols: (keyof SeasonRow)[];
  generated?: string;
  players: WireSeason[][];
};

export const isWireIndex = (w: unknown): w is WireIndex =>
  !!w && typeof w === "object" && String((w as WireIndex).format ?? "").startsWith("laxdb-index/");

export const isWireSeasons = (w: unknown): w is WireSeasons =>
  !!w && typeof w === "object" && String((w as WireSeasons).format ?? "").startsWith("laxdb-seasons/");

const resolve = (ids: { id: string }[], value: number | string | undefined): string => {
  if (typeof value === "number") return ids[value]?.id ?? "";
  return value ?? "";
};

function decodeRow(row: WireSeason | undefined, cols: (keyof SeasonRow)[], teams: Team[], leagues: League[]): SeasonRow {
  const out = {} as Record<string, unknown>;
  if (row) {
    for (let i = 0; i < cols.length; i += 1) {
      const col = cols[i];
      const value = row[i];
      if (col === "teamId") out[col] = resolve(teams, value as number | string);
      else if (col === "leagueId") out[col] = resolve(leagues, value as number | string);
      else out[col] = value;
    }
  }
  return out as unknown as SeasonRow;
}

const EMPTY_CAREER: CareerTotals = {
  gp: 0, g: 0, a: 0, pts: 0, sh: 0, gb: 0, to: 0, ct: 0, pen: 0, sv: 0, ga: 0, min: 0,
  foW: 0, foA: 0, w: 0, l: 0, gaa: 0, svp: 0, fop: 0, ppg: 0,
};

function decodeCareer(tot: number[] | undefined, cols: (keyof CareerTotals)[]): CareerTotals {
  if (!tot) return { ...EMPTY_CAREER };
  const out: Record<string, number> = {};
  cols.forEach((c, i) => { out[c] = tot[i] ?? 0; });
  const career = { ...EMPTY_CAREER, ...out } as CareerTotals;
  career.pts = career.g + career.a;
  career.ppg = career.gp ? career.pts / career.gp : 0;
  career.fop = career.foW + career.foA ? career.foW / (career.foW + career.foA) : 0;
  return career;
}

function decodeSummary(p: WirePlayer, w: WireIndex): PlayerSummary | undefined {
  if (!p.n) return undefined;
  const peaks: Record<string, { season: string; pts: number; gp: number }> = {};
  for (const row of p.pk ?? []) {
    const leagueId = w.leagues[row[0]]?.id;
    if (leagueId) peaks[leagueId] = { season: String(row[3] ?? ""), pts: row[1] ?? 0, gp: row[2] ?? 0 };
  }
  return {
    seasonCount: p.n,
    current: p.cur ? decodeRow(p.cur, w.seasonCols, w.teams, w.leagues) : null,
    career: decodeCareer(p.tot, w.careerCols ?? []),
    peaks,
    clubs: (p.cl ?? []).map((i) => w.teams[i]?.id ?? "").filter(Boolean),
  };
}

/** The index alone: every player with `seasons: []` and a `summary` the list helpers can read. */
export function decodeIndex(wire: WireIndex | Dataset): Dataset {
  if (!isWireIndex(wire)) return wire as Dataset;
  const w = wire as WireIndex;

  const players: Player[] = w.players.map((p) => {
    const summary = decodeSummary(p, w);
    const clean = { ...(p as unknown as Player) } as Player & Record<string, unknown>;
    delete clean.n;
    delete clean.cur;
    delete clean.tot;
    delete clean.pk;
    delete clean.cl;
    return {
      ...(clean as unknown as Player),
      teamId: resolve(w.teams, p.teamId),
      leagueId: resolve(w.leagues, p.leagueId),
      seasons: [],
      summary,
    };
  });

  return {
    meta: w.meta,
    leagues: w.leagues,
    teams: w.teams,
    players,
    history: w.history,
  };
}

/**
 * Write the full history onto the players the app is already rendering, in place — same rows, same
 * object identity, so every memoised index and React reference keeps working. Returns how many
 * players were filled, or -1 when the two files came from different datasets (a stale cached copy),
 * which the caller must treat as "no history" rather than pairing rows with the wrong people.
 */
export function applySeasonHistory(dataset: Dataset, wire: WireSeasons): number {
  if (!isWireSeasons(wire)) return -1;
  const rows = wire.players;
  if (rows.length !== dataset.players.length) return -1;
  const cols = wire.seasonCols;
  let filled = 0;
  for (const [i, p] of dataset.players.entries()) {
    const list = (rows[i] ?? []).map((row) => decodeRow(row, cols, dataset.teams, dataset.leagues));
    // the newest row travels in the index (`summary.current`), so it is not in this file
    if (p.summary?.current) list.push(p.summary.current);
    p.seasons = list;
    if (list.length) filled += 1;
  }
  return filled;
}
