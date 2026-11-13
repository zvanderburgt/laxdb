import React, { useMemo, useState } from "react";
import { Link, useRoute } from "../lib/app";
import { seriesFor } from "../lib/series";
import { returningProduction } from "../lib/returning";
import {
  careerTotals,
  loadGames,
  currentSeason,
  data,
  leagueById,
  leaguePlayerCount,
  POLL_LABELS,
  rosterOf,
  teamOrigins,
  teamSeasonStats,
  teamById,
  teamByName,
  teamBySlug,
  teamOf,
} from "../lib/data";
import { Avatar, BlockList, Card, Empty, PositionBadge, SectionHead, SkeletonCard, Stat, PlayerAvatar, Term, TermFor, TeamLogo } from "../components/ui";
import type { Team } from "../lib/types";

function ReturningCard({ team }: { team: Team }) {
  const r = React.useMemo(() => returningProduction(team), [team.id]);
  if (!r) return null;
  const pct = Math.round(r.share * 100);
  return (
    <Card padded={false} className="standings-card">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">Returning production</h3>
          <p className="muted small">
            Share of {r.from} points from players who also appear on the {r.to} roster
          </p>
        </div>
        <span className="num strong returning-pct">{pct}%</span>
      </div>
      <div className="returning-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="returning-body">
        <span className="muted small">
          {r.returningPoints} of {r.totalPoints} points · {r.kept} players back
        </span>
        {r.lost.length ? (
          <span className="muted small">
            Biggest departures:{" "}
            {r.lost.map((l, i) => (
              <React.Fragment key={l.slug}>
                {i ? " · " : ""}
                <Link to={`/player/${l.slug}`}>
                  {l.name} ({l.pts})
                </Link>
              </React.Fragment>
            ))}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

function HonoursCard({ team }: { team: Team }) {
  const picks = React.useMemo(() => {
    const out: { year: number; tier: string; name: string; slug?: string }[] = [];
    for (const block of data.history?.allAmericans ?? []) {
      for (const group of block.teams) {
        for (const sel of group.players) {
          if (sel.teamId !== team.id) continue;
          const player = data.players.find(
            (p) => p.name.toLowerCase().replace(/[^a-z]/g, "") === sel.name.toLowerCase().replace(/[^a-z]/g, ""),
          );
          out.push({ year: block.year, tier: group.team, name: sel.name, slug: player?.slug });
        }
      }
    }
    return out.sort((a, b) => b.year - a.year || a.tier.localeCompare(b.tier));
  }, [team.id]);

  if (!picks.length) return null;

  return (
    <Card padded={false} className="standings-card">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">All-Americans</h3>
          <p className="muted small">USILA selections 2023–2026 · {picks.length} honors</p>
        </div>
      </div>
      <ul className="honour-list">
        {picks.map((p, i) => (
          <li key={`${p.year}-${p.name}-${i}`}>
            <span className="num muted small">{p.year}</span>
            <span>
              {p.slug ? <Link to={`/player/${p.slug}`}>{p.name}</Link> : p.name}
            </span>
            <span className="muted small">{p.tier}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SeriesCard({ team }: { team: Team }) {
  const [result, setResult] = React.useState<{ season: string; rows: import("../lib/series").Series[] } | null>(null);
  const [scores, setScores] = React.useState<Map<string, { us: number; them: number }>>(new Map());

  React.useEffect(() => {
    let alive = true;
    loadGames().then((all) => {
      if (alive) setResult(seriesFor(team, all));
    });
    // final scores for the same fixtures, keyed by opponent name
    fetch(`${import.meta.env.BASE_URL}scores.json`)
      .then((r) => r.json())
      .then((payload: { d1?: { date: string; home: string; away: string; hs: number; as: number }[] }) => {
        if (!alive || !payload.d1) return;
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
        const mine = [norm(team.name), norm(team.shortName), norm(team.slug.replace(/-/g, " "))];
        const out = new Map<string, { us: number; them: number; date: string }>();
        for (const g of payload.d1) {
          const isHome = mine.some((m) => norm(g.home).startsWith(m) || m.startsWith(norm(g.home)));
          const isAway = mine.some((m) => norm(g.away).startsWith(m) || m.startsWith(norm(g.away)));
          if (!isHome && !isAway) continue;
          const key = isHome ? g.away : g.home;
          const row = { us: isHome ? g.hs : g.as, them: isHome ? g.as : g.hs, date: g.date };
          const prev = out.get(key);
          if (!prev || row.date > prev.date) out.set(key, row);
        }
        setScores(out);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [team.id]);

  if (!result) return <SkeletonCard title="Season series" sub="Rebuilding from the box scores" rows={5} cols={4} />;
  if (result.rows.length < 3) return null;

  // one lookup per cell, shared by the table and the phone block, so they cannot drift
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "");
  const scoreCell = (opponent: string, fallback: string) => {
    const key = [...scores.keys()].find(
      (k) => norm(k).startsWith(norm(opponent)) || norm(opponent).startsWith(norm(k)),
    );
    const s = key ? scores.get(key) : undefined;
    if (!s) return fallback;
    return (
      <span className={s.us > s.them ? "strong" : ""}>
        {s.us}–{s.them}
      </span>
    );
  };
  const opponentCell = (name: string) => {
    const opp = teamByName(name);
    return opp ? (
      <Link to={`/team/${opp.slug}`} className="cell-link">
        {opp.shortName}
      </Link>
    ) : (
      name
    );
  };

  return (
    <Card padded={false} className="standings-card">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">Season series</h3>
          <p className="muted small">
            {result.season} · rebuilt from the box scores ·{" "}
            <Link to={`/vs/${team.slug}/`}>head to head →</Link>
          </p>
        </div>
      </div>
      <BlockList
        rows={result.rows.map((r) => ({
          key: r.opponent,
          primary: opponentCell(r.opponent),
          cells: [
            { label: <Term k="wl" />, value: `${r.w}–${r.l}`, strong: true },
            { label: "Last meeting", value: r.last },
            { label: "Score", value: scoreCell(r.opponent, r.result) },
          ],
        }))}
      />
      <div className="table-scroll hide-sm">
        <table className="data-table">
          <thead>
            <tr>
              <th>Opponent</th>
              <th className="r"><Term k="wl" /></th>
              <th className="r">Last meeting</th>
              <th className="r">Score</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.opponent}>
                <td>{opponentCell(r.opponent)}</td>
                <td className="r num strong">
                  {r.w}–{r.l}
                </td>
                <td className="r num muted">{r.last}</td>
                <td className="r num">{scoreCell(r.opponent, r.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function TeamsPage() {
  const [q, setQ] = useState("");
  const [league, setLeague] = useState("all");

  const teams = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.teams
      .filter((t) => (league === "all" ? true : t.leagueId === league))
      .filter((t) =>
        needle ? t.name.toLowerCase().includes(needle) || t.city.toLowerCase().includes(needle) : true
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [q, league]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof teams>();
    for (const t of teams) {
      const arr = map.get(t.leagueId) ?? [];
      arr.push(t);
      map.set(t.leagueId, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [teams]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Directory</div>
          <h1>Teams</h1>
          <p className="muted">{teams.length} programs across {grouped.length} competitions</p>
        </div>
      </div>

      <div className="filterbar">
        <div className="filter-search">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12.8 12.8L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teams or cities" aria-label="Search teams" />
        </div>
        <select value={league} onChange={(e) => setLeague(e.target.value)} aria-label="League">
          <option value="all">All competitions</option>
          {data.leagues.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>

      {grouped.length === 0 ? <Empty title="No teams match" /> : null}

      {grouped.map(([lid, list]) => (
        <section key={lid} className="team-group">
          <SectionHead
            eyebrow={leagueById.get(lid)?.level}
            title={leagueById.get(lid)?.name ?? lid}
            action={<Link className="link-arrow small" to={`/league/${lid}`}>League page →</Link>}
          />
          <div className="team-grid">
            {list.map((t) => {
              const roster = rosterOf(t.id);
              const pts = roster.reduce((n, p) => n + careerTotals(p).pts, 0);
              return (
                <Link key={t.id} to={`/team/${t.slug}`} className="team-card">
                  <span
                    className={`team-crest ${t.logo ? "has-logo" : ""}`}
                    style={{ background: `linear-gradient(150deg, ${t.colors[0]}, ${t.colors[1]})` }}
                  >
                    {t.logo ? <TeamLogo team={t} size={44} /> : t.shortName.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="team-card-body">
                    <span className="team-card-name">{t.shortName}</span>
                    <span className="team-card-sub">{[t.conference, t.city].filter(Boolean).join(" · ")}</span>
                    <span className="team-card-meta">
                      {roster.length} players · {pts.toLocaleString()} career pts
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function TeamPage() {
  const route = useRoute();
  const slug = route.path.split("/")[2] ?? "";
  const team = teamBySlug.get(slug);
  if (!team) {
    return (
      <div className="page">
        <Empty title="Team not found" />
        <div style={{ textAlign: "center" }}><Link className="btn btn-primary" to="/teams">All teams</Link></div>
      </div>
    );
  }
  const league = leagueById.get(team.leagueId);
  const roster = rosterOf(team.id);
  const origins = teamOrigins(team.id);
  const stats = teamSeasonStats(team.id);
  const skaters = roster.filter((p) => p.position !== "G");
  const goalies = roster.filter((p) => p.position === "G");
  const leaders = [...skaters].sort((a, b) => (currentSeason(b).pts ?? 0) - (currentSeason(a).pts ?? 0)).slice(0, 3);
  // box feeds publish penalties, not ground balls — a GB column there is a column of zeros
  const box = league?.type === "box";
  const lastCol = box ? "PIM" : "GB";

  // one club under several names: totals across the lineage, not just this row
  const franchiseTotals = (() => {
    const ids = new Set(
      ((team.franchise?.names ?? []).map((n) => n.teamId).filter(Boolean) as string[]).concat(team.id),
    );
    const players = new Set<string>();
    let seasons = 0;
    let points = 0;
    for (const p of data.players) {
      let hit = false;
      for (const s of p.seasons) {
        if (!ids.has(s.teamId)) continue;
        seasons += 1;
        points += s.pts ?? 0;
        hit = true;
      }
      if (hit) players.add(p.id);
    }
    return { players: players.size, seasons, points };
  })();

  // what each name actually played in our data, which is finer than the wiki range
  const playedUnder = (teamId?: string | null) => {
    if (!teamId) return null;
    let first = 0;
    let last = 0;
    for (const p of data.players) {
      for (const s of p.seasons) {
        if (s.teamId !== teamId) continue;
        const y = Number(s.season);
        if (!y) continue;
        first = first ? Math.min(first, y) : y;
        last = Math.max(last, y);
      }
    }
    return first ? { first, last } : null;
  };

  return (
    <div className="profile">
      <div
        className="profile-hero team-hero"
        style={{ background: `radial-gradient(120% 160% at 0% 0%, ${team.colors[0]}2b, transparent 60%), radial-gradient(80% 120% at 100% 0%, ${team.colors[1]}22, transparent 55%)` }}
      >
        <div className="profile-hero-inner">
          <div className="crumbs">
            <Link to="/teams">Teams</Link>
            <span>/</span>
            <Link to={`/league/${team.leagueId}`}>{league?.name}</Link>
            <span>/</span>
            <span aria-current="page">{team.name}</span>
          </div>
          <div className="profile-head">
            <span
              className={`team-crest xl ${team.logo ? "has-logo" : ""}`}
              style={{ background: `linear-gradient(150deg, ${team.colors[0]}, ${team.colors[1]})` }}
            >
              {team.logo ? <TeamLogo team={team} size={88} /> : team.shortName.slice(0, 2).toUpperCase()}
            </span>
            <div className="profile-id">
              <div className="profile-tags">
                <span className="tag">{league?.short}</span>
                {team.conference && team.conference !== league?.name ? (
                  <span className="tag">{team.conference}</span>
                ) : null}
                <span className="tag">{league?.type === "box" ? "Box lacrosse" : "Field lacrosse"}</span>
              </div>
              <h1>{team.name}</h1>
              {(() => {
                // the tags above already carry the league and the code; repeating them
                // here left a hero with the same string twice and no city line
                const shown = new Set(
                  [league?.short, team.conference, box ? "Box lacrosse" : "Field lacrosse"]
                    .filter(Boolean)
                    .map((x) => String(x).toLowerCase()),
                );
                const city = team.city && !shown.has(team.city.toLowerCase()) ? team.city : null;
                const leagueName = league?.name && !shown.has(league.name.toLowerCase()) ? league.name : null;
                if (!city && !leagueName) return null;
                return (
                  <div className="profile-sub">
                    {city ? <span>{city}</span> : null}
                    {city && leagueName ? <span className="dot">·</span> : null}
                    {leagueName ? <Link to={`/league/${team.leagueId}`}>{leagueName}</Link> : null}
                  </div>
                );
              })()}
              <div className="profile-meta">
                {team.record ? (
                  <span>
                    <b>{team.record.w}–{team.record.l}</b> record
                    {team.record.rank ? (
                      <>
                        {" · "}
                        <b>#{team.record.rank}</b> of {team.record.teams}
                        {team.record.group && team.record.overallRank ? ` in ${team.record.group}` : ""}
                      </>
                    ) : null}
                  </span>
                ) : null}
                <span><b>{roster.length}</b> players tracked</span>
                <span><b>{roster.reduce((n, p) => n + p.seasons.length, 0)}</b> player-seasons</span>
                <span><b>{roster.reduce((n, p) => n + careerTotals(p).pts, 0).toLocaleString()}</b> career points</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page">
        {team.franchise ? (
          <Card className="franchise-card">
            <div className="eyebrow">Franchise</div>
            <p className="muted small">
              {team.franchise.source === "alias"
                ? "Our sources record this club under more than one name. Each name keeps its own seasons and is linked here."
                : "This club has been renamed. Seasons under each name stay with that name and are linked here."}
            </p>
            <ul className="franchise-list">
              {team.franchise.names.map((n) => {
                const t = n.teamId ? teamById.get(n.teamId) : undefined;
                const viewing = n.teamId === team.id;
                const isLatest = n.to === null;
                const played = playedUnder(n.teamId);
                // the wiki ranges overlap at the rename year; our own seasons do not
                const from = played?.first ?? n.from ?? null;
                const to = n.to === null ? "now" : played && played.last < n.to ? played.last : n.to;
                return (
                  <li key={n.name} className={viewing ? "is-viewing" : undefined}>
                    <span className="franchise-name">
                      {t && !viewing ? <Link to={`/team/${t.slug}`}>{t.name}</Link> : n.name}
                    </span>
                    <span className="franchise-years num">
                      {from && to === from ? from : `${from ?? "—"}–${to}`}
                    </span>
                    <span className="franchise-status">
                      {isLatest ? <span className="tag tag-accent">Current</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="muted small franchise-total">
              Across every name: {franchiseTotals.players} players ·{" "}
              {franchiseTotals.seasons} player-seasons ·{" "}
              {franchiseTotals.points.toLocaleString()} career points
            </p>
          </Card>
        ) : null}
        <ReturningCard team={team} />
        <HonoursCard team={team} />
        <SeriesCard team={team} />

        {team.history && team.history.length ? (
          <Card padded={false} className="standings-card">
            <div className="card-toolbar">
              <div>
                <h3 className="card-title">Recent seasons</h3>
                <p className="muted small">Final regular-season record, from ESPN results</p>
              </div>
            </div>
            <BlockList
              rows={team.history.map((h) => ({
                key: h.season,
                primary: <span className="num strong">{h.season}</span>,
                cells: [
                  { label: <Term k="w" />, value: h.w },
                  { label: <Term k="l" />, value: h.l },
                  { label: <Term k="gf" />, value: h.gf },
                  { label: <Term k="ga" />, value: h.ga },
                  {
                    label: <Term k="diff" />,
                    value: `${h.gf - h.ga > 0 ? "+" : ""}${h.gf - h.ga}`,
                    strong: true,
                  },
                ],
              }))}
            />
            <div className="table-scroll hide-sm">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Season</th>
                    <th className="r"><Term k="w" /></th>
                    <th className="r"><Term k="l" /></th>
                    <th className="r"><Term k="gf" /></th>
                    <th className="r"><Term k="ga" /></th>
                    <th className="r"><Term k="diff" /></th>
                  </tr>
                </thead>
                <tbody>
                  {team.history.map((h) => (
                    <tr key={h.season}>
                      <td className="num strong">{h.season}</td>
                      <td className="r num">{h.w}</td>
                      <td className="r num">{h.l}</td>
                      <td className="r num">{h.gf}</td>
                      <td className="r num">{h.ga}</td>
                      <td className={`r num ${h.gf - h.ga >= 0 ? "" : "muted"}`}>
                        {h.gf - h.ga > 0 ? "+" : ""}
                        {h.gf - h.ga}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        <Card>
          <div className="card-toolbar">
            <div>
              <h3 className="card-title">Season at a glance</h3>
              <p className="muted small">
                {data.meta.season} · rolled up from the roster{stats.gapg ? " and league results" : ""}
              </p>
            </div>
          </div>
          <div className="stat-group-grid team-stats">
            <Stat label="Goals / game" value={stats.gpg ? stats.gpg.toFixed(1) : "—"} tone="accent" />
            <Stat label="Goals allowed / game" value={stats.gapg ? stats.gapg.toFixed(1) : "—"} />
            <Stat label="Shooting %" value={stats.shotPct ? stats.shotPct.toFixed(1) : "—"} />
            <Stat label="Save %" value={stats.savePct ? stats.savePct.toFixed(1) : "—"} />
            {stats.foPct ? <Stat label="Faceoff %" value={stats.foPct.toFixed(1)} /> : null}
          </div>
        </Card>
        <div className="leader-grid">
          <Card padded={false} className="leader-table">
            <div className="card-toolbar">
              <div>
                <h3 className="card-title">Roster</h3>
                <p className="muted small">{data.meta.season} season · {skaters.length} skaters · {goalies.length} goalies</p>
              </div>
            </div>
            {/* a table cannot fit eight columns on a phone without sideways scrolling,
                so each player is a block that reflows to two rows under 640px */}
            <div className="roster-list">
              <div className="roster-head" aria-hidden="true">
                <span>Player</span>
                <span className="roster-pos">Pos</span>
                <span className="roster-class">Class</span>
                <span className="roster-stats">
                  <span><Term k="gp" /></span>
                  <span><Term k="g" /></span>
                  <span><Term k="a" /></span>
                  <span><Term k="pts" /></span>
                  <span><Term k={lastCol === "PIM" ? "pim" : "gb"} /></span>
                </span>
              </div>
              {roster.map((p) => {
                const s = currentSeason(p);
                const isG = p.position === "G";
                return (
                  <div className="roster-row" key={p.id}>
                    <Link to={`/player/${p.slug}`} className="cell-player roster-who">
                      <PlayerAvatar player={p} size={28} />
                      <span className="cell-name">{p.name}</span>
                    </Link>
                    <span className="roster-pos"><PositionBadge pos={p.position} /></span>
                    <span className="roster-class muted">{p.classYear ?? "—"}</span>
                    <span className="roster-stats">
                      <span><b className="num">{s.gp}</b><i><Term k="gp" /></i></span>
                      <span><b className="num">{isG ? "—" : s.g}</b><i><Term k="g" /></i></span>
                      <span><b className="num">{isG ? "—" : s.a}</b><i><Term k="a" /></i></span>
                      <span><b className="num strong">{isG ? "—" : s.pts}</b><i><Term k="pts" /></i></span>
                      <span>
                        <b className="num">{box ? s.pen ?? 0 : s.gb}</b>
                        <i><Term k={lastCol === "PIM" ? "pim" : "gb"} /></i>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            {roster.length === 0 ? <div className="table-note">No players indexed for this program yet.</div> : null}
          </Card>

          <div className="stack">
            <Card>
              <div className="eyebrow">Team leaders · {data.meta.season}</div>
              {leaders.map((p) => {
                const s = currentSeason(p);
                return (
                  <Link key={p.id} to={`/player/${p.slug}`} className="leader-mini">
                    <PlayerAvatar player={p} size={36} />
                    <span className="leader-id">
                      <span className="leader-name">{p.name}</span>
                      <span className="leader-meta">{p.positionName}</span>
                    </span>
                    <span className="leader-pts">
                      <span className="num strong">{s.pts}</span>
                      <span className="leader-pts-lbl">PTS</span>
                    </span>
                  </Link>
                );
              })}
              {leaders.length === 0 ? <p className="muted small">No skaters indexed.</p> : null}
            </Card>
            {origins.schools.length || origins.towns.length ? (
              <Card>
                <div className="eyebrow">Where they come from</div>
                <div className="origin-block">
                  <h5>High schools</h5>
                  <ul className="origin-list">
                    {origins.schools.map((o) => (
                      <li key={o.label}>
                        <span>{o.label}</span>
                        <span className="num muted">{o.count}</span>
                      </li>
                    ))}
                    {origins.schools.length === 0 ? <li className="muted">Not published for this league</li> : null}
                  </ul>
                </div>
                <div className="origin-block">
                  <h5>Hometowns</h5>
                  <ul className="origin-list">
                    {origins.towns.map((o) => (
                      <li key={o.label}>
                        <span>{o.label}</span>
                        <span className="num muted">{o.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            ) : null}
            {team.staff && team.staff.length ? (
              <Card>
                <div className="eyebrow">Support staff</div>
                <ul className="staff-list">
                  {team.staff.map((s, i) => (
                    <li key={`${s.name}-${i}`}>
                      <span className="staff-role">{s.role}</span>
                      <span className="staff-name">{s.name}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            <Card>
              <div className="eyebrow">Program</div>
              <dl className="facts">
                <div><dt>Conference</dt><dd>{team.conference}</dd></div>
                <div><dt>City</dt><dd>{team.city}</dd></div>
                <div>
                  <dt>Competition</dt>
                  <dd>
                    {league ? (
                      <Link to={`/league/${league.id}`} className="cell-link">
                        {league.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                {team.elo ? <div><dt>Elo rating</dt><dd>{team.elo}{team.sos ? ` · SOS ${team.sos}` : ""}</dd></div> : null}
                {team.pollRanks && Object.keys(team.pollRanks).length ? (
                  <div>
                    <dt>Rankings</dt>
                    <dd>
                      {Object.entries(team.pollRanks)
                        .map(([k, v]) => `${POLL_LABELS[k] ?? k} #${v}`)
                        .join(" · ")}
                    </dd>
                  </div>
                ) : null}
                <div><dt>Format</dt><dd>{league?.type === "box" ? "Box (6v6)" : "Field (10v10)"}</dd></div>
              </dl>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
