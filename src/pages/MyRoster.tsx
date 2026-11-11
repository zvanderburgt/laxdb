import React from "react";
import { Link } from "../lib/app";
import { careerTotals, currentSeason, leagueById, teamById } from "../lib/data";
import { toggleSaved, useRoster } from "../lib/storage";
import { downloadCsv } from "../lib/export";
import { Card, Empty, PlayerAvatar, PositionBadge } from "../components/ui";

export default function MyRoster() {
  const players = useRoster();

  if (!players.length) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow">Your workspace</div>
            <h1>My roster</h1>
            <p className="muted">Players you save are kept in this browser — no account needed.</p>
          </div>
        </div>
        <Empty
          title="Nothing saved yet"
          body="Open any player and hit ☆ Save to start tracking them here."
        />
        <div style={{ textAlign: "center" }}>
          <Link className="btn btn-primary" to="/players">
            Browse players
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Your workspace</div>
          <h1>My roster</h1>
          <p className="muted">
            {players.length} {players.length === 1 ? "player" : "players"} saved in this browser
          </p>
        </div>
        <div className="head-controls">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() =>
              downloadCsv(
                "laxdb-my-roster.csv",
                ["Player", "Position", "Team", "League", "Season", "GP", "G", "A", "PTS", "Career PTS"],
                players.map((p) => {
                  const s = currentSeason(p);
                  return [
                    p.name,
                    p.positionName,
                    teamById.get(p.teamId)?.name ?? "",
                    leagueById.get(p.leagueId)?.short ?? "",
                    s.season,
                    s.gp,
                    s.g,
                    s.a,
                    s.pts ?? 0,
                    careerTotals(p).pts,
                  ];
                })
              )
            }
          >
            Export CSV
          </button>
        </div>
      </div>

      <Card padded={false}>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Player</th>
                <th className="c">Pos</th>
                <th>Team</th>
                <th className="c">League</th>
                <th className="r">GP</th>
                <th className="r">G</th>
                <th className="r">A</th>
                <th className="r">PTS</th>
                <th className="r">Career</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const s = currentSeason(p);
                const team = teamById.get(p.teamId);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/player/${p.slug}`} className="cell-player">
                        <PlayerAvatar player={p} size={28} />
                        <span className="cell-name">{p.name}</span>
                      </Link>
                    </td>
                    <td className="c">
                      <PositionBadge pos={p.position} />
                    </td>
                    <td>
                      <Link to={`/team/${team?.slug}`} className="team-link">
                        <span className="team-dot" style={{ background: team?.colors[0] }} />
                        {team?.shortName}
                      </Link>
                    </td>
                    <td className="c muted small">{leagueById.get(p.leagueId)?.short}</td>
                    <td className="r num">{s.gp}</td>
                    <td className="r num">{p.position === "G" ? "—" : s.g}</td>
                    <td className="r num">{p.position === "G" ? "—" : s.a}</td>
                    <td className="r num strong">{p.position === "G" ? "—" : s.pts ?? 0}</td>
                    <td className="r num muted">{careerTotals(p).pts}</td>
                    <td className="r">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => toggleSaved(p.id)}
                        aria-label={`Remove ${p.name}`}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
