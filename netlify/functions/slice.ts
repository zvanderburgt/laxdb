/**
 * /data/player?slug=<player-slug> — one player route's data, answered from Postgres.
 *
 * Step 2 of docs/supabase-migration.md: the page asks for its own slice instead of downloading the
 * 13 MB dataset. The work the client used to do by scanning all 26k players — peer ranks, similarity,
 * teammates — is done here, once, and the browser receives about 150 KB instead of 13.19 MB.
 *
 * The three pools are computed by the *same* functions the browser uses (`peerRanks`, `similarTo`,
 * `teammatesOf` semantics), imported from src/lib, so the two modes cannot drift. The browser runs
 * them over `data.players`; this runs them over pools built from Postgres.
 *
 * Reads go through the Data API with the secret key: no Postgres driver in the bundle, no connection
 * pool to keep warm, and the same key the loader already uses.
 */
import type { League, Player, SeasonRow, Team } from "../../src/lib/types";
import { peerRanks, peerGroupOf } from "../../src/lib/peers";
import { similarTo, type Similar } from "../../src/lib/similar";
import { rows, count, CACHE_HEADERS, databaseError } from "../lib/supabase";

// not /api/*: the admin API registers that wildcard and answers everything else "no such route"
export const config = { path: "/data/player" };

/* ------------------------------ player shaping ----------------------------- */
/* A pool member only needs enough to be drawn and to be scored: identity, and one row carrying his
 * career sums, because `careerTotals()` sums `seasons`. */

function careerRow(r: any): SeasonRow {
  return {
    season: "career",
    teamId: r.teamId,
    leagueId: r.leagueId,
    type: "career",
    gp: r.gp, g: r.g, a: r.a, pts: (r.g || 0) + (r.a || 0),
    sh: r.sh, gb: r.gb, to: r.to, ct: r.ct, pen: r.pen,
    sv: r.sv, ga: r.ga, min: r.min, foW: r.foW, foA: r.foA, w: r.w, l: r.l,
  } as unknown as SeasonRow;
}

function mini(r: any): Player {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    firstName: (r.name || "").split(" ")[0] ?? "",
    lastName: (r.name || "").split(" ").slice(1).join(" "),
    position: r.position,
    positionName: r.positionName,
    heightIn: r.heightIn,
    teamId: r.teamId,
    leagueId: r.leagueId,
    photo: r.photo,
    seasons: [careerRow(r)],
  } as unknown as Player;
}

/* ----------------------------------- data ---------------------------------- */

/**
 * A `slug=in.(…)` filter lives in the URL, and PostgREST answers a long one with 414 instead of rows.
 * Ask for the slugs in batches so no single request carries a league's worth of names.
 */
const SLUG_BATCH = 200;

async function bySlugs(
  table: string,
  column: string,
  select: string,
  slugs: string[],
  extra = "",
): Promise<any[]> {
  const batches: string[][] = [];
  for (let i = 0; i < slugs.length; i += SLUG_BATCH) batches.push(slugs.slice(i, i + SLUG_BATCH));

  const out: any[] = [];
  // a few batches in flight at once: MCLA's attackmen are seven of them, and in series that is the
  // slowest thing on the page
  const WAVE = 4;
  for (let i = 0; i < batches.length; i += WAVE) {
    const wave = batches.slice(i, i + WAVE).map((batch) =>
      rows<any>(
        `${table}?${column}=in.(${batch.map(encodeURIComponent).join(",")})&select=${select}${extra}`,
      ),
    );
    for (const part of await Promise.all(wave)) out.push(...part);
  }
  return out;
}

/** Postgres stores a season as an integer; the dataset — and every page — carries it as a string. */
const asSeason = (r: any) => ({ ...r, season: String(r.season) });

async function slice(slug: string) {
  const [row] = await rows<any>(`players?slug=eq.${encodeURIComponent(slug)}&select=*`);
  if (!row) return null;

  const seasonRows = (
    await rows<any>(
      // ordered by the dataset's own index: `currentSeason()` means the *last* row, not the newest, and
      // without an order Postgres may hand them back differently for the same player
      `seasons?playerSlug=eq.${encodeURIComponent(slug)}&select=*&order=ord`,
    )
  ).map(asSeason);
  const player = { ...row, seasons: seasonRows } as unknown as Player;

  // numeric, or "2026" and "2025" compare as text and the newest season is whichever row came first
  const latest = [...seasonRows].map((s) => s.season).sort((a, b) => Number(b) - Number(a))[0];

  const [teams, leagues, history, selfCareer] = await Promise.all([
    rows<Team>("teams?select=*"),
    rows<League>("leagues?select=*"),
    rows<{ body: unknown }>("snapshots?key=eq.history&select=body"),
    rows<any>(`player_career?slug=eq.${encodeURIComponent(slug)}&select=*`),
  ]);

  /* peers — one league, one position group, the season being shown. The season rows are what
   * `peerRanks` scores, so they come from `seasons`; identity comes from the career view.
   *
   * Two things this must not do: spell every slug of the league into one `in.()` list (Division I is
   * 6,949 players — a 95 KB URL, and the Data API answers 414, which is what broke every large
   * competition's player page), and narrow the season rows to this league (a peer is scored on the
   * *first* row he has for that season, which can be a summer box season the browser also sees).
   *
   * So: ask the career view for the position group only — the pool `peerRanks` filters to anyway — and
   * fetch those players' season rows in batches. */
  const peerCodes = peerGroupOf(player.position);
  const leagueCareer = await rows<any>(
    `player_career?leagueId=eq.${encodeURIComponent(player.leagueId)}` +
      `&position=in.(${peerCodes.map(encodeURIComponent).join(",")})&select=*&order=slug`,
  );
  const leagueSeasonRows = (
    await bySlugs(
      "seasons",
      "playerSlug",
      "playerSlug,season,teamId,leagueId,type,gp,g,sv,ga,pts",
      leagueCareer.map((c) => c.slug),
      `&season=eq.${latest}&order=playerSlug,ord`,
    )
  ).map(asSeason);
  // first row per player wins: that is what the client's `.find()` does for a split season
  const seasonBySlug = new Map<string, any>();
  for (const s of leagueSeasonRows) if (!seasonBySlug.has(s.playerSlug)) seasonBySlug.set(s.playerSlug, s);
  const peerPool: Player[] = [];
  for (const c of leagueCareer) {
    const s = seasonBySlug.get(c.slug);
    if (!s) continue;
    peerPool.push({ ...mini(c), seasons: [s as unknown as SeasonRow] } as Player);
  }

  /* similarity — the position group's career sums, materialised by the loader into one snapshot:
   * the same rows this used to page through 17 requests at a time. */
  const group = groupOf(player.position);
  const pool = await rows<any>(`snapshots?key=eq.${encodeURIComponent(`pool:career:${group}`)}&select=body`);
  const groupPool = ((pool[0]?.body as any[]) ?? []).map(mini);
  // the player himself must be scored against the same career sums the pool uses
  const self = selfCareer[0] ? mini(selfCareer[0]) : player;

  /* teammates — every roster he shared a club-season with, newest clubs first. */
  const pairs = seasonRows.map((s) => ({ teamId: s.teamId, season: s.season }));
  const mateSlugs = new Set<string>();
  // one round trip per club-season, all in flight together: thirteen in series cost more than the
  // rest of this handler put together
  const rosters = await Promise.all(
    pairs.map((p) =>
      rows<any>(
        `seasons?teamId=eq.${encodeURIComponent(p.teamId)}&season=eq.${p.season}` +
          `&select=playerSlug`,
      ),
    ),
  );
  for (const roster of rosters) {
    for (const r of roster) if (r.playerSlug !== slug) mateSlugs.add(r.playerSlug);
  }
  const mateCareer = mateSlugs.size
    ? await bySlugs("player_career", "slug", "*", [...mateSlugs])
    : [];
  // every mate, not a capped sample: the page prints the count in its heading
  const mates = mateCareer
    .map(mini)
    .sort((a, b) => (b.seasons[0]?.pts ?? 0) - (a.seasons[0]?.pts ?? 0));

  const similar: Similar[] = similarTo(self, 6, groupPool);
  const peers = peerRanks(player, peerPool);

  // the footer and the head quote the dataset's own stamp and totals, not the moment of this request
  const [metaSnap, span] = await Promise.all([
    rows<{ body: any }>("snapshots?key=eq.meta&select=body&limit=1"),
    rows<{ lo: number; hi: number }>("season_span?select=*"),
  ]);
  const totalPlayers = await count("players");

  return {
    generated: metaSnap[0]?.body?.generated ?? new Date().toISOString(),
    meta: metaSnap[0]?.body ?? null,
    playerCount: totalPlayers,
    span: span[0] ? [String(span[0].lo), String(span[0].hi)] : ["", ""],
    player,
    peers,
    similar,
    mates,
    teams,
    leagues,
    history: history[0]?.body ?? null,
    // the player's own game log, which used to be a 3.5 MB file fetched by every page
    games: await rows<any>(
      `player_games?playerSlug=eq.${encodeURIComponent(player.slug)}&select=date,opponent,result,g,a,gb,ct,sv,ga,foW,foA&order=ord`,
    ),
    counts: {
      peerPool: peerPool.length,
      groupPool: groupPool.length,
      mates: mates.length,
    },
  };
}

/** The similarity groups are the client's: G, D(D/LSM), M(M/SSDM/F/T/R), A(A/F), FO. */
const GROUP_OF: Record<string, string> = {
  G: "G", D: "D", LSM: "D", M: "M", SSDM: "M", FO: "FO", A: "A", F: "A", T: "M", R: "M",
};

const groupOf = (position: string): string => GROUP_OF[position] ?? "M";

/* --------------------------------- handler -------------------------------- */

export default async function handler(req: Request): Promise<Response> {
  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return new Response(JSON.stringify({ error: "slug required" }), { status: 400 });

  try {
    const body = await slice(slug);
    if (!body) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    // one query per slug per cache window, the pattern meta.ts already uses for the shell
    return new Response(JSON.stringify(body), { headers: CACHE_HEADERS });
  } catch (err) {
    return databaseError(err);
  }
}
