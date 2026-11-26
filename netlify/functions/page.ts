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

/**
 * A club page: the record, the roster, one row per season with its leading scorer, where the players
 * come from, and the season series rebuilt from the game log — all of which used to be assembled by
 * scanning 26,234 players in the browser.
 */
async function teamPage(params: URLSearchParams) {
  const slug = params.get("slug") ?? "";
  if (!slug) return { route: "/team", error: "slug required" };

  const found = await rows<any>(`teams?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`);
  const team = found[0];
  if (!team) return { route: "/team", error: "not found" };

  const league = team.leagueId
    ? (await rows<any>(`leagues?id=eq.${encodeURIComponent(team.leagueId)}&select=*`))[0] ?? null
    : null;

  const [seasonRows, leaders, roster, origins, fixtures, totals, metaSnap, span, historySnap] = await Promise.all([
    rows<any>(`team_seasons?teamId=eq.${encodeURIComponent(team.id)}&select=*`),
    rows<any>(`team_season_leader?teamId=eq.${encodeURIComponent(team.id)}&select=*`),
    rows<any>(`team_roster?teamId=eq.${encodeURIComponent(team.id)}&select=*&order=pts.desc,ord`),
    rows<{ kind: string; label: string; n: number }>(
      `team_origins?teamId=eq.${encodeURIComponent(team.id)}&select=kind,label,n&order=n.desc&limit=300`,
    ),
    rows<any>(
      `team_game_rows?teamId=eq.${encodeURIComponent(team.id)}&select=playerSlug,season,date,opponent,result&order=date`,
    ),
    rows<any>(`team_current_totals?teamId=eq.${encodeURIComponent(team.id)}&select=*`),
    rows<{ body: any }>("snapshots?key=eq.meta&select=body&limit=1"),
    rows<{ lo: number; hi: number }>("season_span?select=*"),
    rows<{ body: any }>("snapshots?key=eq.history&select=body&limit=1"),
  ]);
  const played = team.record ? (team.record.w ?? 0) + (team.record.l ?? 0) + (team.record.t ?? 0) : 0;
  const t = totals[0] ?? {};
  const gp = t.gp || played;
  // a published standings row is the better source for per-game figures, exactly as the page does
  const standing = (league?.standings ?? []).find((r: any) => r.teamId === team.id);
  const standingGames = standing ? (standing.w ?? 0) + (standing.l ?? 0) + (standing.t ?? 0) : 0;
  const gpg = standingGames ? standing.gf / standingGames : gp ? (t.g ?? 0) / gp : 0;
  const gapg = standingGames ? standing.ga / standingGames : 0;

  /* lineage: one club under several names — totals across all of them, and which years each name
   * actually played, which is finer than the wiki range */
  const lineageIds = [
    team.id,
    ...((team.franchise?.names ?? []).map((n: any) => n.teamId).filter(Boolean) as string[]),
  ];
  const lineage = await rows<any>(
    `seasons?teamId=in.(${lineageIds.map(encodeURIComponent).join(",")})` +
      `&select=playerSlug,season,teamId,pts`,
  );
  const franchise = {
    players: new Set(lineage.map((r) => r.playerSlug)).size,
    seasons: lineage.length,
    points: lineage.reduce((n, r) => n + (r.pts ?? 0), 0),
  };
  const playedUnder: Record<string, { first: number; last: number }> = {};
  for (const r of lineage) {
    const y = Number(r.season);
    if (!y) continue;
    const cur = playedUnder[r.teamId];
    playedUnder[r.teamId] = { first: cur ? Math.min(cur.first, y) : y, last: cur ? Math.max(cur.last, y) : y };
  }

  /* returning production: the share of the previous season's points still on the roster */
  const own = lineage.filter((r) => r.teamId === team.id);
  const ownSeasons = [...new Set(own.map((r) => String(r.season)))].sort();
  let returning: any = null;
  if (ownSeasons.length >= 2) {
    const from = ownSeasons[ownSeasons.length - 2];
    const to = ownSeasons[ownSeasons.length - 1];
    const later = new Set(own.filter((r) => String(r.season) === to).map((r) => r.playerSlug));
    let total = 0;
    let back = 0;
    let kept = 0;
    const lost: any[] = [];
    const seen = new Set<string>();
    for (const r of own) {
      if (String(r.season) !== from || seen.has(r.playerSlug)) continue;
      seen.add(r.playerSlug);
      const pts = r.pts ?? 0;
      total += pts;
      if (later.has(r.playerSlug)) {
        back += pts;
        kept += 1;
      } else if (pts > 0) {
        const who = roster.find((x) => x.slug === r.playerSlug);
        lost.push({ name: who?.name ?? r.playerSlug, slug: r.playerSlug, pts });
      }
    }
    returning = {
      from,
      to,
      totalPoints: total,
      returningPoints: back,
      share: total ? back / total : 0,
      kept,
      lost: lost.sort((a, b) => b.pts - a.pts).slice(0, 5),
    };
  }

  const bySeason = new Map<string, any>(seasonRows.map((r) => [String(r.season), r]));
  const leaderBy = new Map<string, any>(leaders.map((l) => [String(l.season), l]));
  // `team.history` seasons are numbers and `team_seasons.season` comes back from PostgREST as one
  // too, but a mixed set silently produced two rows per season
  const seasons = [
    ...new Set(
      [...bySeason.keys(), ...(team.history ?? []).map((h: any) => h.season)].filter(Boolean).map(String),
    ),
  ]
    .sort()
    .reverse();

  /* seriesFor(): the newest season with five or more fixtures, aggregated by opponent */
  let seriesSeason = "";
  let seriesFixtures: any[] = [];
  for (const s of seasons) {
    const seen = new Map<string, any>();
    for (const f of fixtures) {
      if (f.season !== s) continue;
      seen.set(`${f.date}|${f.opponent}`, f);
    }
    if (seen.size >= 5) {
      seriesSeason = s;
      seriesFixtures = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
      break;
    }
  }
  const series: any[] = [];
  const byOpp = new Map<string, any>();
  for (const f of seriesFixtures) {
    const row = byOpp.get(f.opponent) ?? { opponent: f.opponent, w: 0, l: 0, last: f.date, result: "" };
    if (f.result === "W") row.w += 1;
    else if (f.result === "L") row.l += 1;
    row.last = f.date;
    row.result = f.result;
    byOpp.set(f.opponent, row);
  }
  for (const row of byOpp.values()) series.push(row);
  series.sort((a, b) => b.last.localeCompare(a.last));


  const opponentNames = new Set<string>([
    ...fixtures.map((f: any) => f.opponent),
    ...series.map((r: any) => r.opponent),
  ].filter(Boolean));
  const opponents = (await rows<any>("teams?select=slug,name,shortName,id")).filter((t) =>
    [...opponentNames].some((n) => {
      const key = String(n).toLowerCase().replace(/[^a-z]/g, "");
      return [t.name, t.shortName, t.slug.replace(/-/g, " ")]
        .map((v: string) => String(v ?? "").toLowerCase().replace(/[^a-z]/g, ""))
        .some((v: string) => v && (v.startsWith(key) || key.startsWith(v)));
    }),
  );

  const top = (kind: string) =>
    origins
      // a birthplace with no city still concatenates to ", MD", which is not a hometown
      .filter((o) => o.kind === kind && o.label && /[a-z]/i.test(o.label))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
      .slice(0, 6)
      .map((o) => ({ label: o.label, count: o.n }));

  return {
    route: "/team",
    team,
    league,
    roster: roster.map((r) => ({
      slug: r.slug, name: r.name, position: r.position, positionName: r.positionName,
      photo: r.photo, classYear: r.classYear, gp: r.gp, g: r.g, a: r.a, pts: r.pts,
      seasons: r.seasons, careerPts: r.careerPts, seasonPts: r.seasonPts, seasonGp: r.seasonGp,
      seasonG: r.seasonG, seasonA: r.seasonA, seasonGb: r.seasonGb, seasonCt: r.seasonCt,
    })),
    seasons: seasons.map((s) => ({
      season: String(s),
      leagueId: bySeason.get(s)?.leagueId ?? "",
      players: bySeason.get(s)?.players ?? 0,
      leader: leaderBy.get(s)
        ? { slug: leaderBy.get(s).slug, name: leaderBy.get(s).name, pts: leaderBy.get(s).pts ?? 0 }
        : null,
    })),
    series: { season: seriesSeason, rows: series },
    opponents,
    // "109 players tracked · 237 player-seasons · 1,416 career points" — career totals, not this club's
    rosterTotals: {
      players: roster.length,
      seasons: roster.reduce((n, r) => n + (r.seasons ?? 0), 0),
      points: roster.reduce((n, r) => n + (r.careerPts ?? 0), 0),
    },
    franchise,
    playedUnder,
    returning,
    origins: { schools: top("school"), towns: top("town") },
    history: historySnap[0]?.body ?? null,
    generated: metaSnap[0]?.body?.generated ?? "",
    meta: metaSnap[0]?.body ?? null,
    playerCount: await count("players"),
    span: span[0] ? [String(span[0].lo), String(span[0].hi)] : ["", ""],
    stats: {
      gp,
      gpg,
      gapg,
      shotPct: t.sh ? ((t.g ?? 0) / t.sh) * 100 : 0,
      foPct: t.foA ? ((t.foW ?? 0) / t.foA) * 100 : 0,
      savePct: (t.sv ?? 0) + (t.ga ?? 0) ? ((t.sv ?? 0) / ((t.sv ?? 0) + (t.ga ?? 0))) * 100 : 0,
    },
  };
}

/**
 * The history page is one snapshot plus name resolution: record books, All-America lists and award
 * winners print names ("CJ Kirst", "C.J. Kirst"), not ids, and the page links each one.
 */
async function historyPage() {
  const [snap, teams, span, metaSnap] = await Promise.all([
    rows<{ body: any }>("snapshots?key=eq.history&select=body&limit=1"),
    // a colour comes with each club: the record books tint their club chips from it
    rows<any>("teams?select=id,slug,name,shortName,colors,logo"),
    rows<{ lo: number; hi: number }>("season_span?select=*"),
    rows<{ body: any }>("snapshots?key=eq.meta&select=body&limit=1"),
  ]);
  const history = snap[0]?.body ?? null;

  // every name the page can link, resolved with the rule `playerByName()` uses
  const names = new Set<string>();
  const take = (v: unknown) => {
    if (typeof v === "string" && v.trim()) names.add(v.trim());
  };
  for (const r of history?.records?.sections ?? []) for (const row of r.rows ?? []) take(row.Player);
  for (const b of history?.allAmericans ?? []) {
    for (const team of b.teams ?? []) for (const p of team.players ?? []) take(p.name ?? p.Player);
    take(b.Player);
  }
  for (const c of history?.champions ?? []) for (const p of c.players ?? []) take(p.player ?? p.name);
  for (const t of history?.tewaaraton ?? []) take(t.player ?? t.name);

  const key = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "");
  const keys = [...new Set([...names].map(key))].filter(Boolean);
  const found: any[] = [];
  for (let i = 0; i < keys.length; i += 120) {
    const chunk = keys.slice(i, i + 120).map(encodeURIComponent);
    if (!chunk.length) continue;
    found.push(
      ...(await rows<any>(`player_lookup?key=in.(${chunk.join(",")})&select=key,slug,name,rank`)),
    );
  }
  // the same tie-break as `playerByName()`: a portrait and a longer career win
  const ranked = new Map<string, any>();
  for (const r of found) {
    const cur = ranked.get(r.key);
    if (!cur || (r.rank ?? 0) > (cur.rank ?? 0)) ranked.set(r.key, r);
  }

  /* "Climbing the record book": an active D1 player within three best-seasons of the lowest figure
   * printed on the board, and only where his career starts inside the seasons we hold. */
  const numOf = (v: unknown) => Number(String(v ?? "").replace(/[^0-9]/g, "")) || 0;
  const boards = [
    { key: "career-points", stat: "pts", column: "Points" },
    { key: "career-goals", stat: "g", column: "Goals" },
    { key: "career-assists", stat: "a", column: "Assists" },
  ] as const;
  const windowRow = (await rows<{ first: number; last: number }>("climb_window?select=*"))[0];
  const sections: any[] = history?.records?.sections ?? [];
  let climbers: any[] = [];
  if (sections.length && windowRow) {
    const pool = await rows<any>("d1_climb?select=*");
    const candidates = new Map<string, any>();
    for (const b of boards) {
      const section = sections.find((s) => s.key === b.key);
      if (!section || (section.rows?.length ?? 0) < 2) continue;
      const values = section.rows.map((r: any) => numOf(r[b.column])).filter((n: number) => n > 0);
      if (values.length < 2) continue;
      const cutoff = Math.min(...values);
      const leader = Math.max(...values);
      const leaderName = section.rows.find((r: any) => numOf(r[b.column]) === leader)?.Player ?? "";
      for (const p of pool) {
        if ((p.seasons ?? 0) < 2 || !p.active) continue;
        if (Number(p.firstSeason) <= Number(windowRow.first)) continue;
        const career = b.stat === "pts" ? p.careerPts : b.stat === "g" ? p.careerG : p.careerA;
        const best = b.stat === "pts" ? p.bestPts : b.stat === "g" ? p.bestG : p.bestA;
        if (career < cutoff * 0.5 || career >= cutoff || !best) continue;
        const seasonsNeeded = Math.ceil((cutoff + 1 - career) / best);
        if (seasonsNeeded > 3) continue;
        const cur = candidates.get(p.slug);
        if (
          !cur ||
          seasonsNeeded < cur.seasonsNeeded ||
          (seasonsNeeded === cur.seasonsNeeded && career > cur.career)
        ) {
          candidates.set(p.slug, {
            slug: p.slug, name: p.name, position: p.position, positionName: p.positionName,
            photo: p.photo, teamId: p.lastTeam, stat: b.stat, career, cutoff, leader, leaderName,
            bestSeason: best, seasons: p.seasons, seasonsNeeded,
          });
        }
      }
    }
    climbers = [...candidates.values()]
      .sort((a, b) => a.seasonsNeeded - b.seasonsNeeded || b.career - a.career)
      .slice(0, 6);
  }

  return {
    route: "/history",
    climbers,
    history,
    teams,
    span: span[0] ? [String(span[0].lo), String(span[0].hi)] : ["", ""],
    generated: metaSnap[0]?.body?.generated ?? "",
    meta: metaSnap[0]?.body ?? null,
    playerCount: await count("players"),
    players: [...ranked.values()].map((r) => ({ key: r.key, slug: r.slug, name: r.name })),
  };
}

/** The origins page: one competition's players reduced to birthplace, school and programme. */
async function originsPage() {
  const [origins, teams, span, metaSnap] = await Promise.all([
    rows<any>(`d1_origins?select=teamId,state,school&order=seq`),
    // the programme each player reached, so the page can name and link it
    rows<any>(`teams?leagueId=eq.ncaa-d1&select=id,slug,name,shortName,colors,logo&order=name`),
    rows<{ lo: number; hi: number }>("season_span?select=*"),
    rows<{ body: any }>("snapshots?key=eq.meta&select=body&limit=1"),
  ]);
  return {
    route: "/origins",
    generated: metaSnap[0]?.body?.generated ?? "",
    meta: metaSnap[0]?.body ?? null,
    playerCount: await count("players"),
    span: span[0] ? [String(span[0].lo), String(span[0].hi)] : ["", ""],
    teams,
    origins,
  };
}

/**
 * A handful of named players, in full — the primitive the comparison, roster, head-to-head and game
 * pages need. They take arbitrary players (from a URL, or the visitor's saved roster), so they cannot
 * be one page slice; they ask for exactly the records on screen.
 */
async function playersByKey(params: URLSearchParams) {
  const slugs = (params.get("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ids = (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length && !ids.length) return { route: "/player-set", players: [], teams: [], leagues: [] };

  const filter = [
    slugs.length ? `slug.in.(${slugs.map(encodeURIComponent).join(",")})` : "",
    ids.length ? `id.in.(${ids.map(encodeURIComponent).join(",")})` : "",
  ]
    .filter(Boolean)
    .join(",");
  const base = await rows<any>(`players?or=(${filter})&select=*`);
  if (!base.length) return { route: "/player-set", players: [], teams: [], leagues: [] };

  const slugList = base.map((p) => p.slug).map(encodeURIComponent).join(",");
  const seasons = await rows<any>(`seasons?playerSlug=in.(${slugList})&select=*&order=ord`);
  const bySlug = new Map<string, any[]>();
  for (const s of seasons) {
    const arr = bySlug.get(s.playerSlug) ?? [];
    arr.push(s);
    bySlug.set(s.playerSlug, arr);
  }

  const teamIds = new Set<string>();
  const leagueIds = new Set<string>();
  for (const s of seasons) {
    if (s.teamId) teamIds.add(s.teamId);
    if (s.leagueId) leagueIds.add(s.leagueId);
  }
  for (const p of base) {
    if (p.teamId) teamIds.add(p.teamId);
    if (p.leagueId) leagueIds.add(p.leagueId);
  }

  const [teams, leagues, metaSnap, span] = await Promise.all([
    teamIds.size
      ? rows<any>(`teams?id=in.(${[...teamIds].map(encodeURIComponent).join(",")})&select=*`)
      : Promise.resolve([]),
    leagueIds.size
      ? rows<any>(`leagues?id=in.(${[...leagueIds].map(encodeURIComponent).join(",")})&select=*&order=ord`)
      : Promise.resolve([]),
    rows<{ body: any }>("snapshots?key=eq.meta&select=body&limit=1"),
    rows<{ lo: number; hi: number }>("season_span?select=*"),
  ]);

  return {
    route: "/player-set",
    generated: metaSnap[0]?.body?.generated ?? "",
    meta: metaSnap[0]?.body ?? null,
    playerCount: await count("players"),
    span: span[0] ? [String(span[0].lo), String(span[0].hi)] : ["", ""],
    players: base.map((p) => ({ ...p, seasons: bySlug.get(p.slug) ?? [] })),
    teams,
    leagues,
  };
}

/** The typeahead on the comparison page: eight names, no dataset in the browser. */
async function searchPage(params: URLSearchParams) {
  const q = (params.get("q") ?? "").trim();
  if (q.length < 2) return { route: "/search", players: [] };
  const hits = await rows<any>(
    `player_list?name=ilike.*${encodeURIComponent(q)}*&select=slug,id,name,position,positionName,teamId,leagueId,photo,classYear&order=name&limit=8`,
  );
  return {
    route: "/search",
    players: hits.map((p) => ({
      slug: p.slug, id: p.id, name: p.name, position: p.position, positionName: p.positionName,
      teamId: p.teamId, leagueId: p.leagueId, photo: p.photo, classYear: p.classYear, seasons: [],
    })),
  };
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  try {
    if (path === "/search") {
      return new Response(JSON.stringify(await searchPage(url.searchParams)), { headers: CACHE_HEADERS });
    }
    if (path === "/player-set") {
      return new Response(JSON.stringify(await playersByKey(url.searchParams)), { headers: CACHE_HEADERS });
    }
    if (path === "/origins") {
      return new Response(JSON.stringify(await originsPage()), { headers: CACHE_HEADERS });
    }
    if (path === "/history") {
      return new Response(JSON.stringify(await historyPage()), { headers: CACHE_HEADERS });
    }
    if (path === "/team") {
      return new Response(JSON.stringify(await teamPage(url.searchParams)), { headers: CACHE_HEADERS });
    }
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
