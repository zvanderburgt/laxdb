import type { Player, SeasonRow } from "./types";

/**
 * The players table's paged result (docs/supabase-migration.md, step 3).
 *
 * The page shows 150 rows and a count; the database works out which 150. Kept out of src/lib/slice.ts
 * because that one is the player route's whole dataset, and the two have different failure modes.
 */
export type PlayerListRow = {
  slug: string; id: string; name: string; position: string; positionName: string;
  teamId: string; leagueId: string; classYear: number | null; photo: string | null;
  state: string | null; city: string | null; highSchool: string | null; teamName: string; teamShort: string;
  teamSlug: string; teamColor: string; leagueShort: string;
  season: number | null; gp: number | null; g: number | null; a: number | null;
  pts: number | null; gb: number | null; sh: number | null;
  foW: number | null; foA: number | null; sv: number | null; ga: number | null;
  ppg: number | null;
};

export type PlayerListResult = {
  total: number;
  universe: number;
  rows: PlayerListRow[];
  leagues: { id: string; name: string; short: string }[];
  facets: { positions: string[]; years: number[]; states: string[] };
  range: [string, string];
};

let listModeOn = false;

export function enableListMode(): void {
  listModeOn = true;
}

export const listMode = (): boolean => listModeOn;

export async function fetchPlayerList(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<PlayerListResult> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && v !== "all") qs.set(k, v);
  const res = await fetch(`/data/players?${qs}`, { signal });
  if (!res.ok) throw new Error(`player list failed: ${res.status}`);
  return (await res.json()) as PlayerListResult;
}

/** A row as the page's `<Player>` expects: only what a table cell or a card draws. */
export function playerFromRow(r: PlayerListRow): Player {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    firstName: (r.name ?? "").split(" ")[0] ?? "",
    lastName: (r.name ?? "").split(" ").slice(1).join(" "),
    position: r.position,
    positionName: r.positionName,
    teamId: r.teamId,
    leagueId: r.leagueId,
    classYear: r.classYear,
    photo: r.photo ? `${import.meta.env.BASE_URL}${r.photo}` : undefined,
    highSchool: r.highSchool ?? "",
    birthplace: { city: r.city ?? "", state: r.state ?? "", country: "" },
    teamName: r.teamName,
    teamShort: r.teamShort,
    teamSlug: r.teamSlug,
    teamColor: r.teamColor,
    leagueShort: r.leagueShort,
    seasons: [seasonFromRow(r)],
  } as unknown as Player;
}

export function seasonFromRow(r: PlayerListRow): SeasonRow {
  return {
    season: String(r.season ?? ""),
    teamId: r.teamId,
    leagueId: r.leagueId,
    type: "regular",
    gp: r.gp ?? 0, g: r.g ?? 0, a: r.a ?? 0, pts: r.pts ?? 0,
    gb: r.gb ?? 0, sh: r.sh ?? 0, foW: r.foW ?? 0, foA: r.foA ?? 0,
    sv: r.sv ?? 0, ga: r.ga ?? 0,
  } as unknown as SeasonRow;
}
