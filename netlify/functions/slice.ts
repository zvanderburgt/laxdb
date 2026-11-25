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
import { peerRanks } from "../../src/lib/peers";
import { similarTo, type Similar } from "../../src/lib/similar";
import { rows, CACHE_HEADERS } from "../lib/supabase";

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

async function slice(slug: string) {
  const [row] = await rows<any>(`players?slug=eq.${encodeURIComponent(slug)}&select=*`);
  if (!row) return null;

  const seasonRows = await rows<any>(
    `seasons?playerSlug=eq.${encodeURIComponent(slug)}&select=*`,
  );
  const player = { ...row, seasons: seasonRows } as unknown as Player;

  const latest = [...seasonRows].map((s) => s.season).sort((a, b) => b - a)[0];

  const [teams, leagues, history, selfCareer] = await Promise.all([
    rows<Team>("teams?select=*"),
    rows<League>("leagues?select=*"),
    rows<{ body: unknown }>("snapshots?key=eq.history&select=body"),
    rows<any>(`player_career?slug=eq.${encodeURIComponent(slug)}&select=*`),
  ]);

  /* peers — one league, one position group, the season being shown. The season rows are what
   * `peerRanks` scores, so they come from `seasons`; identity comes from the career view. */
  const leagueCareer = await rows<any>(
    `player_career?leagueId=eq.${encodeURIComponent(player.leagueId)}&select=*&order=slug`,
  );
  const peerSlugs = leagueCareer.map((c) => c.slug);
  const leagueSeasonRows = peerSlugs.length
    ? await rows<any>(
        `seasons?season=eq.${latest}&playerSlug=in.(${peerSlugs.map(encodeURIComponent).join(",")})` +
          `&select=playerSlug,season,teamId,leagueId,type,gp,g,sv,ga,pts&order=playerSlug,ord`,
      )
    : [];
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
    ? await rows<any>(`player_career?slug=in.(${[...mateSlugs].map(encodeURIComponent).join(",")})&select=*`)
    : [];
  const mates = mateCareer
    .map(mini)
    .sort((a, b) => (b.seasons[0]?.pts ?? 0) - (a.seasons[0]?.pts ?? 0))
    .slice(0, 60);

  const similar: Similar[] = similarTo(self, 6, groupPool);
  const peers = peerRanks(player, peerPool);

  return {
    generated: new Date().toISOString(),
    player,
    peers,
    similar,
    mates,
    teams,
    leagues,
    history: history[0]?.body ?? null,
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
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
