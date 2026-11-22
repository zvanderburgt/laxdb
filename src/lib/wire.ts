import type { Dataset, League, Player, SeasonRow, Team } from "./types";

/**
 * The wire format, decoded into the objects the app already expects.
 *
 * `scripts/compact-data.mjs` writes `public/data.wire.json`: season rows are positional tuples
 * against one `seasonCols` header, club ids are indices into `teams`/`leagues`, and player fields
 * holding an empty value are dropped. Nothing outside this file knows that — the decoder rebuilds
 * the same `Dataset` shape `data.json` had, and `normalizePlayer()` restores the dropped defaults.
 *
 * **One file on purpose.** An index/history split was shipped and then reverted on measurement: the
 * per-player summaries a list route needs cost 717 KB of the index while the entire season history
 * costs 260 KB, because the same numbers re-expressed per player compress far worse than the rows.
 * See `docs/dataset.md` for the numbers.
 *
 * The tuple order is `SEASON_COLS` — do not reorder it without regenerating the file.
 */

export const FORMAT = "laxdb-wire/3";

type WireSeason = (string | number | null)[];
type WirePlayer = Omit<Player, "seasons" | "teamId" | "leagueId"> & {
  teamId: number | string;
  leagueId: number | string;
  seasons?: WireSeason[];
};

export type WireDataset = {
  format: string;
  seasonCols: (keyof SeasonRow)[];
  meta: Dataset["meta"];
  leagues: League[];
  teams: Team[];
  history?: Dataset["history"];
  players: WirePlayer[];
};

const resolve = (ids: { id: string }[], value: number | string | undefined): string => {
  if (typeof value === "number") return ids[value]?.id ?? "";
  return value ?? "";
};

export function decodeDataset(wire: WireDataset | Dataset): Dataset {
  // a build that predates the wire format still loads (the writer is newer than some caches)
  if (!("format" in wire) || !Array.isArray((wire as WireDataset).seasonCols)) {
    return wire as Dataset;
  }
  const w = wire as WireDataset;
  const cols = w.seasonCols;

  const players: Player[] = w.players.map((p) => {
    const seasons: SeasonRow[] = (p.seasons ?? []).map((row) => {
      const out = {} as Record<string, unknown>;
      for (let i = 0; i < cols.length; i += 1) {
        const col = cols[i];
        const value = row[i];
        if (col === "teamId") out[col] = resolve(w.teams, value as number | string);
        else if (col === "leagueId") out[col] = resolve(w.leagues, value as number | string);
        else out[col] = value;
      }
      return out as unknown as SeasonRow;
    });
    return {
      ...(p as unknown as Player),
      teamId: resolve(w.teams, p.teamId),
      leagueId: resolve(w.leagues, p.leagueId),
      seasons,
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
