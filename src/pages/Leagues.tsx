import React, { useMemo, useState } from "react";
import { Link, useRoute } from "../lib/app";
import {
  careerTotals,
  currentSeason,
  data,
  leagueById,
  leaguePlayerCount,
  leagueTeams,
  teamById,
  teamOf,
} from "../lib/data";
import { Avatar, Card, Empty, PositionBadge, SectionHead, Segmented, Stat, PlayerAvatar } from "../components/ui";
import type { League } from "../lib/types";

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
              <span className="team-dot" style={{ background: team?.colors[0] }} />
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
    .sort((a, b) => b.val - a.val)
    .slice(0, 40);

  const teams = leagueTeams(league.id);
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
                  <th className="r">GP</th>
                  <th className="r">G</th>
                  <th className="r">AST</th>
                  <th className="r">PTS</th>
                  <th className="r">PTS/G</th>
                  {stat === "gb" || stat === "ct" || stat === "svp" ? (
                    <th className="r">{stat === "svp" ? "SV%" : stat === "gb" ? "GB" : "CT"}</th>
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
                          <span className="team-dot" style={{ background: team?.colors[0] }} />
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
