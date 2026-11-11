import React, { useMemo, useState } from "react";
import { Link, useRoute } from "../lib/app";
import {
  careerTotals,
  currentSeason,
  data,
  leagueById,
  leaguePlayerCount,
  rosterOf,
  teamById,
  teamBySlug,
  teamOf,
} from "../lib/data";
import { Avatar, Card, Empty, PositionBadge, SectionHead, PlayerAvatar } from "../components/ui";

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
                  <span className="team-crest" style={{ background: `linear-gradient(150deg, ${t.colors[0]}, ${t.colors[1]})` }}>
                    {t.shortName.slice(0, 2).toUpperCase()}
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
  const skaters = roster.filter((p) => p.position !== "G");
  const goalies = roster.filter((p) => p.position === "G");
  const leaders = [...skaters].sort((a, b) => (currentSeason(b).pts ?? 0) - (currentSeason(a).pts ?? 0)).slice(0, 3);

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
          </div>
          <div className="profile-head">
            <span className="team-crest xl" style={{ background: `linear-gradient(150deg, ${team.colors[0]}, ${team.colors[1]})` }}>
              {team.shortName.slice(0, 2).toUpperCase()}
            </span>
            <div className="profile-id">
              <div className="profile-tags">
                <span className="tag">{league?.short}</span>
                <span className="tag">{team.conference}</span>
                <span className="tag">{league?.type === "box" ? "Box lacrosse" : "Field lacrosse"}</span>
              </div>
              <h1>{team.name}</h1>
              <div className="profile-sub">
                {team.city ? <span>{team.city}</span> : null}
                {team.city ? <span className="dot">·</span> : null}
                <Link to={`/league/${team.leagueId}`}>{league?.name}</Link>
              </div>
              <div className="profile-meta">
                <span><b>{roster.length}</b> players tracked</span>
                <span><b>{roster.reduce((n, p) => n + p.seasons.length, 0)}</b> player-seasons</span>
                <span><b>{roster.reduce((n, p) => n + careerTotals(p).pts, 0).toLocaleString()}</b> career points</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page">
        <div className="leader-grid">
          <Card padded={false} className="leader-table">
            <div className="card-toolbar">
              <div>
                <h3 className="card-title">Roster</h3>
                <p className="muted small">{data.meta.season} season · {skaters.length} skaters · {goalies.length} goalies</p>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="c">Pos</th>
                  <th className="c">Class</th>
                  <th className="r">GP</th>
                  <th className="r">G</th>
                  <th className="r">AST</th>
                  <th className="r">PTS</th>
                  <th className="r">GB</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((p) => {
                  const s = currentSeason(p);
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/player/${p.slug}`} className="cell-player">
                          <PlayerAvatar player={p} size={28} />
                          <span className="cell-name">{p.name}</span>
                        </Link>
                      </td>
                      <td className="c"><PositionBadge pos={p.position} /></td>
                      <td className="c muted">{p.classYear ?? "—"}</td>
                      <td className="r num">{s.gp}</td>
                      <td className="r num">{p.position === "G" ? "—" : s.g}</td>
                      <td className="r num">{p.position === "G" ? "—" : s.a}</td>
                      <td className="r num strong">{p.position === "G" ? "—" : s.pts}</td>
                      <td className="r num">{s.gb}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
            <Card>
              <div className="eyebrow">Program</div>
              <dl className="facts">
                <div><dt>Conference</dt><dd>{team.conference}</dd></div>
                <div><dt>City</dt><dd>{team.city}</dd></div>
                <div><dt>Competition</dt><dd>{league?.name}</dd></div>
                <div><dt>Format</dt><dd>{league?.type === "box" ? "Box (6v6)" : "Field (10v10)"}</dd></div>
              </dl>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
