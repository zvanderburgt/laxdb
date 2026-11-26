import type { League, Player, Team } from "./types";
import type { GameRow } from "./types";
import type { PeerRank } from "./peers";
import type { Similar } from "./similar";

/**
 * The slice the database answers for one player route (docs/supabase-migration.md, step 2).
 *
 * It carries the page's own data plus the three blocks that used to be computed by scanning all
 * 26,234 players in the browser: peer ranks, similar players and teammates. The browser holds those
 * results, so the page must not recompute them from a partial `data.players`.
 */
export type PlayerSlice = {
  generated: string;
  player: Player;
  peers: PeerRank[];
  similar: Similar[];
  mates: Player[];
  teams: Team[];
  leagues: League[];
  history: unknown;
  games: GameRow[];
  playerCount?: number;
  span?: [string, string];
  meta?: { generated?: string; season?: string; sources?: string[] } | null;
  counts: { peerPool: number; groupPool: number; mates: number };
};

let current: PlayerSlice | null = null;

export function setSlice(slice: PlayerSlice | null): void {
  current = slice;
}

/** Non-null only when this page load came from the database rather than the dataset file. */
export function sliceFor(slug: string): PlayerSlice | null {
  return current && current.player.slug === slug ? current : null;
}

export const sliceMode = (): boolean => current !== null;
