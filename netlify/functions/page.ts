/**
 * /data/page?path=/leagues — a route's data, answered from Postgres.
 *
 * The shape of step 2 and 3 for the routes that are still on the dataset file. One endpoint with a
 * `path` switch rather than one function per page: they all answer the same question ("what does this
 * route need to draw?"), and the client already knows its own path.
 *
 * What each branch must preserve is the *numbers the page prints*. `/leagues` shows, per competition,
 * a team count, a player count and the leading scorer by his current-season points — all three are
 * aggregates over 26k players and 53k season rows, which is precisely why the browser was keeping the
 * whole file.
 */
import { rows, count, CACHE_HEADERS } from "../lib/supabase";

export const config = { path: "/data/page" };

type LeagueRow = {
  id: string; name: string; short: string; level: string; type: string;
  country: string; tier: number;
};

type ListRow = {
  slug: string; id: string; name: string; position: string; positionName: string;
  teamId: string; leagueId: string; photo: string | null; pts: number | null;
};

/** The fields a league card (and the nav) reads — standings stay on the league's own page. */
const LEAGUE_COLUMNS = "id,name,short,level,type,country,tier";

async function leaguesPage() {
  const [leagues, teamCounts, playerCounts, topScorers, totalPlayers] = await Promise.all([
    rows<LeagueRow>(`leagues?select=${LEAGUE_COLUMNS}&order=name`),
    rows<{ leagueId: string }>("teams?select=leagueId"),
    rows<{ leagueId: string }>("players?select=leagueId"),
    rows<ListRow>(
      "league_top_scorer?select=slug,id,name,position,positionName,teamId,leagueId,photo,pts",
    ),
    count("players?select=slug"),
  ]);

  const teams = new Map<string, number>();
  for (const t of teamCounts) teams.set(t.leagueId, (teams.get(t.leagueId) ?? 0) + 1);

  const players = new Map<string, number>();
  for (const p of playerCounts) players.set(p.leagueId, (players.get(p.leagueId) ?? 0) + 1);

  // first sighting wins: the list arrives ordered by points, so this is the leader per league
  const top = new Map<string, ListRow>();
  for (const row of topScorers) if (!top.has(row.leagueId)) top.set(row.leagueId, row);

  return {
    route: "/leagues",
    totalPlayers,
    leagues,
    cards: leagues.map((league) => ({
      league,
      teams: teams.get(league.id) ?? 0,
      players: players.get(league.id) ?? 0,
      top: top.get(league.id) ?? null,
    })),
  };
}

type TeamRow = {
  id: string; slug: string; name: string; shortName: string; conference: string | null;
  leagueId: string; logo: string | null; city: string | null;
};

async function teamsPage() {
  const [teams, leagues, totals] = await Promise.all([
    rows<TeamRow>(
      "teams?select=id,slug,name,shortName,conference,leagueId,logo,city&order=name",
    ),
    rows<LeagueRow>(`leagues?select=${LEAGUE_COLUMNS}&order=name`),
    rows<{ teamId: string; players: number; pts: number }>("team_totals?select=*"),
  ]);

  const byTeam = new Map(totals.map((t) => [t.teamId, t]));
  return {
    route: "/teams",
    leagues,
    teams: teams.map((t) => ({
      ...t,
      players: byTeam.get(t.id)?.players ?? 0,
      pts: byTeam.get(t.id)?.pts ?? 0,
    })),
  };
}

/**
 * The coaches directory is a projection of the staff rows already inside each team record: no player
 * data at all, which is why it needs its own branch rather than the full dataset.
 */
async function coachesPage() {
  const [teams, leagues] = await Promise.all([
    rows<TeamRow & { staff: unknown[] | null }>(
      "teams?select=id,slug,name,shortName,conference,leagueId,logo,staff&order=name",
    ),
    rows<LeagueRow>("leagues?select=id,name,short&order=name"),
  ]);
  return { route: "/coaches", leagues, teams };
}

/**
 * The leaders page ranks inside one competition, so this branch takes the league and the scope rather
 * than shipping all 53k season rows: a league-season is a few hundred KB, and the edge caches each
 * combination.
 *
 * The page can also rank a player's *career within that league* (`career_by_league`) and by a
 * league-relative index, which needs the competition's own points per game.
 */
async function leadersPage(params: URLSearchParams) {
  const scope = params.get("scope") === "career" ? "career" : "season";
  // the page's default is the first league the dataset lists, so the order has to travel with it
  const leagues = await rows<LeagueRow>(
    "leagues?select=id,name,short,level,type,country,tier&order=ord",
  );
  let league = params.get("league") ?? "";
  if (!league) {
    const seen = await rows<{ leagueId: string }>("league_seasons?select=leagueId&limit=1");
    league = leagues.find((l) => seen.some((s) => s.leagueId === l.id))?.id ?? leagues[0]?.id ?? "";
  }
  const seasons = await rows<{ season: number }>(
    `league_seasons?leagueId=eq.${encodeURIComponent(league)}&select=season`,
  );
  const seasonList = seasons.map((s) => String(s.season)).sort().reverse();
  const season = params.get("season") ?? seasonList[0] ?? "";

  // one row per entry, identity included; a split season has two rows, and the page's `.find()`
  // means the first one in the player's own order
  const raw =
    scope === "career"
      ? await rows<any>(
          // both filters matter: the man must *be* in this league now, and the seasons summed must be
          // this league's (his junior career does not belong on his college board)
          `leader_career?playerLeague=eq.${encodeURIComponent(league)}` +
            `&leagueId=eq.${encodeURIComponent(league)}&select=*&order=pts.desc`,
        )
      : await rows<any>(
          // the board filters on the player's *current* league, which is what the page does — a man
          // whose newest row is a summer box league still appears on his college board
          `leader_season?playerLeague=eq.${encodeURIComponent(league)}&season=eq.${Number(season)}` +
            `&select=*&order=ord`,
        );

  const teams = await rows<{ id: string; shortName: string; name: string }>(
    "teams?select=id,shortName,name",
  );
  const teamName = new Map(teams.map((t) => [t.id, t.shortName || t.name]));

  const firstPerPlayer = new Map<string, any>();
  for (const r of raw) if (!firstPerPlayer.has(r.slug)) firstPerPlayer.set(r.slug, r);

  const out = [...firstPerPlayer.values()]
    .sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0))
    .map((r) => ({
      slug: r.slug, name: r.name, position: r.position, positionName: r.positionName,
      teamId: r.teamId, photo: r.photo, team: teamName.get(r.teamId) ?? "",
      gp: r.gp ?? 0, g: r.g ?? 0, a: r.a ?? 0, pts: r.pts ?? 0, sh: r.sh ?? 0, gb: r.gb ?? 0,
      ct: r.ct ?? 0, foW: r.foW ?? 0, foA: r.foA ?? 0, sv: r.sv ?? 0, ga: r.ga ?? 0,
      w: r.w ?? 0, l: r.l ?? 0,
    }));

  // the Opp-adj board needs the weighting, which the loader resolved to one number per player-season;
  // only the two competitions with a game log can carry it
  if (scope === "season" && (league === "ncaa-d1" || league === "pll")) {
    const adj = await rows<{ playerSlug: string; adjusted: number }>(
      `player_adj?season=eq.${encodeURIComponent(season)}&select=playerSlug,adjusted`,
    );
    const byPlayer = new Map(adj.map((a) => [a.playerSlug, a.adjusted]));
    for (const r of out) (r as any).adj = byPlayer.get(r.slug) ?? null;
  }

  const gp = out.reduce((n, r) => n + r.gp, 0);
  const pts = out.reduce((n, r) => n + r.pts, 0);

  const stamp = await rows<{ body: { generated?: string } }>(
    "snapshots?key=eq.meta&select=body&limit=1",
  );

  return {
    route: "/leaders",
    generated: stamp[0]?.body?.generated ?? "",
    league,
    scope,
    season,
    seasons: seasonList,
    leagues,
    leaguePpg: gp ? pts / gp : 0,
    rows: out,
  };
}

/**
 * A competition's page: its record, its clubs, and one row per player carrying the season the page
 * calls current. The origin lists are two group-bys, not 3,000 birthplaces.
 */
async function leaguePage(params: URLSearchParams) {
  const id = params.get("id") ?? "";
  if (!id) return { route: "/league", error: "id required" };

  const [leagues, teams, totals, originRows, span] = await Promise.all([
    rows<any>(`leagues?id=eq.${encodeURIComponent(id)}&select=*`),
    rows<any>(
      `teams?leagueId=eq.${encodeURIComponent(id)}&select=id,slug,name,shortName,logo,colors,record,conference&order=name`,
    ),
    rows<{ players: number; careerGoals: number }>(
      `league_totals?leagueId=eq.${encodeURIComponent(id)}&select=*`,
    ),
    rows<{ kind: string; label: string; n: number }>(
      `league_origins?leagueId=eq.${encodeURIComponent(id)}&select=kind,label,n&order=n.desc&limit=400`,
    ),
    // the hero prints the span the dataset covers, not just the league's newest season
    rows<{ lo: number; hi: number }>("season_span?select=*"),
  ]);
  const league = leagues[0];
  if (!league) return { route: "/league", error: "not found" };

  const rowsOut = await rows<any>(
    `league_player_current?playerLeague=eq.${encodeURIComponent(id)}&select=*&order=pts.desc`,
  );

  const top = (kind: string) =>
    originRows
      .filter((o) => o.kind === kind && o.label)
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
      .slice(0, 6)
      .map((o) => ({ label: o.label, count: o.n }));

  return {
    route: "/league",
    league,
    teams,
    players: totals[0]?.players ?? rowsOut.length,
    careerGoals: totals[0]?.careerGoals ?? 0,
    span: span[0] ? [String(span[0].lo), String(span[0].hi)] : ["", ""],
    origins: { schools: top("school"), towns: top("town") },
    rows: rowsOut.map((r) => ({
      slug: r.slug, name: r.name, position: r.position, positionName: r.positionName,
      teamId: r.teamId, photo: r.photo, season: r.season,
      gp: r.gp ?? 0, g: r.g ?? 0, a: r.a ?? 0, pts: r.pts ?? 0, sh: r.sh ?? 0, gb: r.gb ?? 0,
      ct: r.ct ?? 0, foW: r.foW ?? 0, foA: r.foA ?? 0, sv: r.sv ?? 0, ga: r.ga ?? 0,
      w: r.w ?? 0, l: r.l ?? 0,
    })),
  };
}

/**
 * The importer's auxiliary files — the scorecard, the record books, rankings, the franchise shells —
 * as one endpoint. Six pages used to fetch scores.json themselves; now they ask here.
 */
const SNAPSHOT_KEYS = new Set(["scores", "history-results", "rankings", "rankings-history", "franchises", "meta", "history"]);

async function snapshotPage(params: URLSearchParams) {
  const key = params.get("key") ?? "";
  if (!SNAPSHOT_KEYS.has(key)) return { error: "unknown snapshot" };
  const hit = await rows<{ body: unknown }>(
    `snapshots?key=eq.${encodeURIComponent(key)}&select=body&limit=1`,
  );
  return hit[0]?.body ?? null;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  try {
    if (path === "/snapshot") {
      return new Response(JSON.stringify(await snapshotPage(url.searchParams)), { headers: CACHE_HEADERS });
    }
    if (path === "/league") {
      return new Response(JSON.stringify(await leaguePage(url.searchParams)), { headers: CACHE_HEADERS });
    }
    if (path === "/leaders") {
      return new Response(JSON.stringify(await leadersPage(url.searchParams)), { headers: CACHE_HEADERS });
    }
    if (path === "/coaches") {
      return new Response(JSON.stringify(await coachesPage()), { headers: CACHE_HEADERS });
    }
    if (path === "/teams") {
      return new Response(JSON.stringify(await teamsPage()), { headers: CACHE_HEADERS });
    }
    if (path === "/leagues") {
      return new Response(JSON.stringify(await leaguesPage()), { headers: CACHE_HEADERS });
    }
    return new Response(JSON.stringify({ error: `no slice for ${path}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
