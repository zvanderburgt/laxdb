import React, { useMemo, useState } from "react";
import { Link, useRoute } from "../lib/app";
import {
  careerTotals,
  currentSeason,
  data,
  leagueById,
  leagueOrigins,
  POLL_LABELS,
  leaguePlayerCount,
  leagueTeams,
  ratedTeams,
  teamById,
  teamOf,
} from "../lib/data";
import { Avatar, Card, Empty, PositionBadge, SectionHead, Segmented, Stat, PlayerAvatar, TeamLogo } from "../components/ui";
import type { League, Team } from "../lib/types";

export function LeaguesPage() {
  const groups = useMemo(() => {
    const map = new Map<string, typeof data.leagues>();
    for (const l of data.leagues) {
      const arr = map.get(l.level) ?? [];
      arr.push(l);
      map.set(l.level, arr);
    }
    const order = [
      "College", "College Club", "Professional", "Senior A", "Senior B",
      "Junior A", "Junior B", "Junior C", "High School", "International",
    ];
    const rank = (lvl: string) => {
      const i = order.indexOf(lvl);
      return i === -1 ? 99 : i;
    };
    return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Competitions</div>
          <h1>Leagues</h1>
          <p className="muted">{data.leagues.length} competitions · field and box · {data.players.length} players</p>
        </div>
      </div>

      {groups.map(([level, leagues]) => (
        <section key={level} className="team-group">
          <SectionHead title={level} />
          <div className="league-grid wide">
            {leagues.map((l) => {
              const top = data.players
                .filter((p) => p.leagueId === l.id)
                .sort((a, b) => (currentSeason(b).pts ?? 0) - (currentSeason(a).pts ?? 0))[0];
              return (
                <Link key={l.id} to={`/league/${l.id}`} className="league-card">
                  <div className="league-card-top">
                    <span className={`league-pill t${l.tier}`}>{l.short}</span>
                    <span className="league-type">{l.type === "box" ? "Box" : "Field"} · {l.country}</span>
                  </div>
                  <h3>{l.name}</h3>
                  <p className="muted">
                    {leagueTeams(l.id).length} teams · {leaguePlayerCount(l.id)} players
                  </p>
                  {top ? (
                    <div className="league-top">
                      <PlayerAvatar player={top} size={28} />
                      <span>{top.name}</span>
                      <span className="num muted">{currentSeason(top).pts} PTS</span>
                    </div>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const STATS = [
  { value: "pts", label: "Points" },
  { value: "g", label: "Goals" },
  { value: "a", label: "Assists" },
  { value: "gb", label: "Ground balls" },
  { value: "ct", label: "Caused TOs" },
  { value: "svp", label: "Save %" },
] as const;

function RatingsCard({ league }: { league: League }) {
  const rows = ratedTeams(league.id);
  if (!rows.length) return null;

  // consensus: average of the ranks this team holds across every poll, plus its Elo rank.
  // The spread is shown because the algorithms disagree more than most readers expect.
  const pollRanks = new Map<string, number[]>();
  for (const poll of league.polls ?? []) {
    for (const row of poll.rows) {
      if (!row.teamId) continue;
      pollRanks.set(row.teamId, [...(pollRanks.get(row.teamId) ?? []), row.rank]);
    }
  }
  const consensus = (teamId: string, eloRank: number) => {
    const ranks = [...(pollRanks.get(teamId) ?? []), eloRank];
    if (ranks.length < 2) return null;
    const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    const spread = Math.max(...ranks) - Math.min(...ranks);
    return { mean, spread, sources: ranks.length };
  };
  return (
    <Card padded={false} className="standings-card">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">Ratings</h3>
          <p className="muted small">
            Elo built from this season&apos;s final scores · SOS is the average opponent rating
          </p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="c">#</th>
              <th>Team</th>
              <th className="r">Elo</th>
              <th className="r">SOS</th>
              <th className="r">Consensus</th>
              <th className="r">W–L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.teamId}>
                <td className="c num muted">{r.rank}</td>
                <td>
                  <Link to={`/team/${r.team?.slug}`} className="team-link">
                    <TeamLogo team={r.team} size={20} />
                    {r.team?.shortName}
                  </Link>
                </td>
                <td className="r num strong">{r.elo}</td>
                <td className="r num">{r.sos}</td>
                <td className="r num">
                  {(() => {
                    const c = consensus(r.teamId, r.rank);
                    if (!c) return <span className="muted">—</span>;
                    return (
                      <span title={`${c.sources} rankings`}>
                        {c.mean.toFixed(1)}
                        <span className="muted small"> ±{c.spread}</span>
                      </span>
                    );
                  })()}
                </td>
                <td className="r num">
                  {r.team?.record ? `${r.team.record.w}–${r.team.record.l}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-note">
        Every team starts at 1500, so ratings describe this season only — they are not a
        cross-era ranking. Consensus averages a team&apos;s Elo rank with its rank in each poll;
        the ± figure is how far apart those sources sit.
      </div>
    </Card>
  );
}

/** Rank movement against the previous snapshot in rankings-history.json. */
function Move({ prev, rank }: { prev?: number | null; rank: number }) {
  if (prev == null) return <span className="move" title="First snapshot for this team">•</span>;
  const delta = prev - rank; // positive means climbed
  if (delta === 0) return <span className="move" title={`Held at #${prev}`}>–</span>;
  return (
    <span
      className={`move ${delta > 0 ? "up" : "down"}`}
      title={`${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} since the previous snapshot`}
    >
      {delta > 0 ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
}

function ConferenceCard({ league }: { league: League }) {
  const byConf = new Map<string, Team[]>();
  for (const t of leagueTeams(league.id)) {
    if (!t.conference) continue;
    byConf.set(t.conference, [...(byConf.get(t.conference) ?? []), t]);
  }
  if (byConf.size < 2) return null;

  const confs = [...byConf.entries()]
    .map(([name, teams]) => ({
      name,
      teams: teams.sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0)),
    }))
    .sort((a, b) => b.teams.length - a.teams.length || a.name.localeCompare(b.name));

  return (
    <Card padded={false} className="standings-card">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">By conference</h3>
          <p className="muted small">
            {confs.length} conferences · ordered by Elo inside each · overall records
          </p>
        </div>
      </div>
      <div className="conf-grid">
        {confs.map((c) => (
          <div key={c.name} className="conf-block">
            <div className="conf-head">
              <span className="strong">{c.name}</span>
              <span className="muted small">{c.teams.length}</span>
            </div>
            <table className="data-table">
              <tbody>
                {c.teams.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/team/${t.slug}`} className="team-link">
                        <TeamLogo team={t} size={16} />
                        {t.shortName}
                      </Link>
                    </td>
                    <td className="r num">{t.record ? `${t.record.w}–${t.record.l}` : "—"}</td>
                    <td className="r num muted">{t.elo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PollCard({ league }: { league: League }) {
  const polls = league.polls ?? [];
  const [key, setKey] = useState(polls[0]?.key ?? "");
  if (!polls.length) return null;
  const current = polls.find((p) => p.key === key) ?? polls[0];
  const hasRecord = current.rows.some((r) => r.record);

  return (
    <Card padded={false} className="standings-card">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">Rankings</h3>
          <p className="muted small">
            {current.source}
            {current.fetched ? ` · retrieved ${current.fetched}` : ""}
          </p>
        </div>
        <Segmented
          size="sm"
          ariaLabel="Poll"
          value={current.key}
          onChange={setKey}
          options={polls.map((p) => ({ value: p.key, label: POLL_LABELS[p.key] ?? p.key }))}
        />
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="c">#</th>
              <th aria-label="Movement" />
              <th>Team</th>
              <th className="r">{hasRecord ? "Record" : "Points"}</th>
            </tr>
          </thead>
          <tbody>
            {current.rows.map((r) => {
              const team = r.teamId ? teamById.get(r.teamId) : undefined;
              return (
                <tr key={`${r.rank}-${r.name}`}>
                  <td className="c num muted">{r.rank}</td>
                  <td className="c">
                    <Move prev={r.prev} rank={r.rank} />
                  </td>
                  <td>
                    {team ? (
                      <Link to={`/team/${team.slug}`} className="team-link">
                        <TeamLogo team={team} size={20} />
                        {team.shortName}
                      </Link>
                    ) : (
                      <span className="muted">{r.name}</span>
                    )}
                  </td>
                  <td className="r num muted">{hasRecord ? r.record : r.extra}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-note">
        Programs we do not carry rosters for are listed without a link. The coaches poll is the
        season&apos;s final ballot; Inside Lacrosse is not included because the site blocks automated
        reads.
      </div>
    </Card>
  );
}

function StandingsCard({ league }: { league: League }) {
  const rows = (league.standings ?? []).slice();
  if (!rows.length) return null;
  rows.sort((a, b) => a.rank - b.rank);

  const groups = [...new Set(rows.map((r) => r.group || ""))].sort();
  const multi = groups.length > 1;
  const hasConf = rows.some((r) => typeof r.confW === "number");
  const hasTies = rows.some((r) => r.t > 0);
  const cols = 6 + (hasConf ? 1 : 0) + (hasTies ? 1 : 0);

  const body = (list: typeof rows) =>
    list.map((r) => {
      const team = teamById.get(r.teamId);
      return (
        <tr key={r.teamId}>
          <td className="c num muted">{multi ? r.groupRank ?? r.rank : r.rank}</td>
          <td>
            <Link to={`/team/${team?.slug}`} className="team-link">
              <TeamLogo team={team} size={20} />
              {team?.shortName ?? r.teamId}
            </Link>
          </td>
          <td className="r num strong">{r.w}</td>
          <td className="r num">{r.l}</td>
          {hasTies ? <td className="r num">{r.t}</td> : null}
          <td className="r num">{r.pct ? r.pct.toFixed(3).replace(/^0/, "") : "—"}</td>
          <td className="r num">{r.gf}</td>
          <td className="r num">{r.ga}</td>
          {hasConf ? (
            <td className="r num">{typeof r.confW === "number" ? `${r.confW}–${r.confL ?? 0}` : "—"}</td>
          ) : null}
        </tr>
      );
    });

  return (
    <Card padded={false} className="standings-card">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">Standings</h3>
          <p className="muted small">
            {data.meta.season} · {rows.length} teams · sorted by win percentage
          </p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="c">#</th>
              <th>Team</th>
              <th className="r">W</th>
              <th className="r">L</th>
              {hasTies ? <th className="r">T</th> : null}
              <th className="r">PCT</th>
              <th className="r">GF</th>
              <th className="r">GA</th>
              {hasConf ? <th className="r">CONF</th> : null}
            </tr>
          </thead>
          <tbody>
            {multi
              ? groups.flatMap((g) => [
                  <tr key={`g-${g}`}>
                    <td colSpan={cols} className="muted strong" style={{ paddingTop: 14 }}>
                      {g}
                    </td>
                  </tr>,
                  ...body(rows.filter((r) => (r.group || "") === g)),
                ])
              : body(rows)}
          </tbody>
        </table>
      </div>
      {league.id === "ncaa-d1" ? (
        <div className="table-note">
          Records are tallied from game results (ESPN scoreboard), not an official standings feed —
          a game missing upstream means a record one short.
        </div>
      ) : null}
    </Card>
  );
}

export function LeaguePage() {
  const route = useRoute();
  const id = route.path.split("/")[2] ?? "";
  const league = leagueById.get(id);
  const [stat, setStat] = useState<(typeof STATS)[number]["value"]>("pts");
  const [pos, setPos] = useState<string>("all");
  const [sortKey, setSortKey] = useState<"val" | "gp" | "g" | "a" | "pts" | "ppg">("val");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  if (!league) {
    return (
      <div className="page">
        <Empty title="League not found" />
        <div style={{ textAlign: "center" }}><Link className="btn btn-primary" to="/leagues">All leagues</Link></div>
      </div>
    );
  }

  const pool = data.players.filter((p) => p.leagueId === league.id && (pos === "all" ? true : p.position === pos));
  const rows = pool
    .map((p) => {
      const s = currentSeason(p);
      const val =
        stat === "svp"
          ? s.sv + s.ga > 0
            ? s.sv / (s.sv + s.ga)
            : s.svp || 0
          : (s[stat] as number) || 0;
      return { p, s, val };
    })
    .filter((r) => r.s.gp >= 3 && (stat === "svp" ? r.s.sv > 15 || (r.s.svp || 0) > 0 : true))
    .sort((a, b) => {
      const pick = (r: (typeof a)) => {
        switch (sortKey) {
          case "gp": return r.s.gp;
          case "g": return r.s.g;
          case "a": return r.s.a;
          case "pts": return r.s.pts ?? 0;
          case "ppg": return r.s.gp ? (r.s.pts ?? 0) / r.s.gp : 0;
          default: return r.val;
        }
      };
      return sortDir === "desc" ? pick(b) - pick(a) : pick(a) - pick(b);
    })
    .slice(0, 40);

  const th = (k: typeof sortKey, label: string) => (
    <th className={`r sortable ${sortKey === k ? "is-sorted" : ""}`} onClick={() => sortBy(k)}>
      {label}
      <span className="sort-caret">{sortKey === k ? (sortDir === "desc" ? "↓" : "↑") : ""}</span>
    </th>
  );

  const sortBy = (k: typeof sortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  const teams = leagueTeams(league.id);
  const origins = leagueOrigins(league.id);
  const totalGoals = data.players
    .filter((p) => p.leagueId === league.id)
    .reduce((n, p) => n + careerTotals(p).g, 0);

  return (
    <div className="profile">
      <div className="profile-hero">
        <div className="profile-hero-inner">
          <div className="crumbs">
            <Link to="/leagues">Leagues</Link>
            <span>/</span>
            <span>{league.short}</span>
          </div>
          <div className="league-hero-head">
            <div>
              <div className="profile-tags">
                <span className={`league-pill t${league.tier}`}>{league.short}</span>
                <span className="tag">{league.type === "box" ? "Box lacrosse" : "Field lacrosse"}</span>
                <span className="tag">{league.country}</span>
              </div>
              <h1>{league.name}</h1>
              <p className="muted">{league.level} · {teams.length} teams · {pool.length} players tracked</p>
            </div>
          </div>
          <div className="profile-stats">
            <Stat label="Players" value={pool.length} tone="accent" />
            <Stat label="Teams" value={teams.length} />
            <Stat label="Career goals" value={totalGoals.toLocaleString()} />
            <Stat
              label="Seasons"
              value={`${(
                pool.flatMap((pl) => pl.seasons.map((s) => s.season)).sort()[0] ?? data.meta.season
              )}–${data.meta.season}`}
            />
          </div>
        </div>
      </div>

      <div className="page">
        <StandingsCard league={league} />
        <ConferenceCard league={league} />
        <RatingsCard league={league} />
        <PollCard league={league} />
        <div className="leader-grid">
          <Card padded={false} className="leader-table">
            <div className="card-toolbar">
              <div>
                <h3 className="card-title">Leaderboard</h3>
                <p className="muted small">{data.meta.season} regular season</p>
              </div>
              <div className="head-controls">
                <select value={pos} onChange={(e) => setPos(e.target.value)} aria-label="Position">
                  <option value="all">All positions</option>
                  {["A", "M", "D", "FO", "LSM", "G"].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="stat-tabs">
              <Segmented size="sm" ariaLabel="Stat" options={STATS.map((s) => ({ value: s.value, label: s.label }))} value={stat} onChange={setStat} />
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="c">#</th>
                  <th>Player</th>
                  <th>Team</th>
                  <th className="c">Pos</th>
                  {th("gp", "GP")}
                  {th("g", "G")}
                  {th("a", "AST")}
                  {th("pts", "PTS")}
                  {th("ppg", "PTS/G")}
                  {stat === "gb" || stat === "ct" || stat === "svp" ? (
                    <th className={`r sortable ${sortKey === "val" ? "is-sorted" : ""}`} onClick={() => sortBy("val")}>
                      {stat === "svp" ? "SV%" : stat === "gb" ? "GB" : "CT"}
                      <span className="sort-caret">{sortKey === "val" ? (sortDir === "desc" ? "↓" : "↑") : ""}</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const team = teamById.get(r.p.teamId);
                  return (
                    <tr key={r.p.id}>
                      <td className="c num muted">{i + 1}</td>
                      <td>
                        <Link to={`/player/${r.p.slug}`} className="cell-player">
                          <PlayerAvatar player={r.p} size={28} />
                          <span className="cell-name">{r.p.name}</span>
                        </Link>
                      </td>
                      <td>
                        <Link to={`/team/${team?.slug}`} className="team-link">
                          <TeamLogo team={team} size={20} />
                          {team?.shortName}
                        </Link>
                      </td>
                      <td className="c"><PositionBadge pos={r.p.position} /></td>
                      <td className="r num">{r.s.gp}</td>
                      <td className="r num">{r.s.g}</td>
                      <td className="r num">{r.s.a}</td>
                      <td className="r num">{r.s.pts ?? 0}</td>
                      <td className="r num">{(r.s.gp ? (r.s.pts ?? 0) / r.s.gp : 0).toFixed(2)}</td>
                      {stat === "gb" || stat === "ct" || stat === "svp" ? (
                        <td className="r num strong">
                          {stat === "svp" ? r.val.toFixed(3).replace(/^0/, "") : r.val}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 ? <div className="table-note">No qualifying players for this filter.</div> : null}
          </Card>

          <div className="stack">
            <Card>
              <div className="eyebrow">Teams</div>
              <div className="rail-teams">
                {teams.map((t) => (
                  <Link key={t.id} to={`/team/${t.slug}`} className="rail-team">
                    <span className="team-dot lg" style={{ background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})` }} />
                    <span>
                      <span>{t.shortName}</span>
                      <span className="muted small">{t.conference}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
            <Card>
              <div className="eyebrow">Where they come from</div>
              <div className="origin-block">
                <h5>High schools</h5>
                <ul className="origin-list">
                  {origins.schools.length ? (
                    origins.schools.map((o) => (
                      <li key={o.label}>
                        <span>{o.label}</span>
                        <span className="num muted">{o.count}</span>
                      </li>
                    ))
                  ) : (
                    <li className="muted">Not published for this league</li>
                  )}
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
            <Card>
              <div className="eyebrow">Goalie leaders · save %</div>
              {data.players
                .filter((p) => p.leagueId === league.id && p.position === "G")
                .sort((a, b) => {
                  const sv = (x: typeof a) => {
                    const s = currentSeason(x);
                    return s.sv + s.ga ? s.sv / (s.sv + s.ga) : s.svp || 0;
                  };
                  return sv(b) - sv(a);
                })
                .slice(0, 5)
                .map((p) => {
                  const s = currentSeason(p);
                  return (
                    <Link key={p.id} to={`/player/${p.slug}`} className="leader-mini">
                      <PlayerAvatar player={p} size={32} />
                      <span className="leader-id">
                        <span className="leader-name">{p.name}</span>
                        <span className="leader-meta">{teamOf(p)?.shortName}</span>
                      </span>
                      <span className="num strong">
                        {s.sv + s.ga ? (s.sv / (s.sv + s.ga)).toFixed(3).replace(/^0/, "") : "—"}
                      </span>
                    </Link>
                  );
                })}
              {data.players.filter((p) => p.leagueId === league.id && p.position === "G").length === 0 ? (
                <p className="muted small">No goalies indexed for this competition.</p>
              ) : null}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
