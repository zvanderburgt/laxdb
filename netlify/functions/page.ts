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

export default async function handler(req: Request): Promise<Response> {
  const path = new URL(req.url).searchParams.get("path") ?? "";
  try {
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
