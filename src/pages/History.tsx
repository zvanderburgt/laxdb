import React from "react";
import { Link } from "../lib/app";
import { data, teamById } from "../lib/data";
import { Card, Empty, TeamLogo } from "../components/ui";

export default function History() {
  const history = data.history;
  if (!history || (!history.champions.length && !history.tewaaraton.length)) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow">Records</div>
            <h1>History</h1>
          </div>
        </div>
        <Empty title="No history imported yet" body="Run the importer to pull champion and award history." />
      </div>
    );
  }

  const champions = history.champions.slice(0, 40);
  const programs = [...history.programs].sort((a, b) => b.titles - a.titles).slice(0, 12);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Records</div>
          <h1>History</h1>
          <p className="muted">
            {history.champions.length} seasons of national champions · {history.programs.length}{" "}
            programs · {history.tewaaraton.length} Tewaaraton winners
          </p>
        </div>
      </div>

      <div className="leader-grid">
        <Card padded={false} className="leader-table">
          <div className="card-toolbar">
            <div>
              <h3 className="card-title">National champions</h3>
              <p className="muted small">
                Most recent {champions.length} seasons · 2020 had no champion (season cancelled)
              </p>
            </div>
          </div>
          <div className="table-scroll history-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="c">Year</th>
                  <th>Champion</th>
                </tr>
              </thead>
              <tbody>
                {champions.map((c) => {
                  const team = c.teamId ? teamById.get(c.teamId) : undefined;
                  return (
                    <tr key={`${c.year}-${c.team}`}>
                      <td className="c num strong">{c.year}</td>
                      <td>
                        {team ? (
                          <Link to={`/team/${team.slug}`} className="team-link">
                            <TeamLogo team={team} size={20} />
                            {team.shortName}
                          </Link>
                        ) : (
                          <span className="muted">{c.team}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            Counts include pre-NCAA national titles, which is why the totals run higher than NCAA
            championships alone. Programs we carry rosters for are linked.
          </div>
        </Card>

        <div className="stack">
          <Card>
            <div className="eyebrow">
              Titles by program · top {programs.length} of {history.programs.length}
            </div>
            <ul className="origin-list title-list">
              {programs.map((p) => {
                const team = p.teamId ? teamById.get(p.teamId) : undefined;
                return (
                  <li key={p.team}>
                    <span>{team?.shortName ?? p.team}</span>
                    <span className="num muted">{p.titles}</span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <div className="eyebrow">
              Tewaaraton winners · {Math.min(10, history.tewaaraton.length)} of{" "}
              {history.tewaaraton.length}
            </div>
            <ul className="origin-list title-list">
              {history.tewaaraton.slice(0, 10).map((w) => (
                <li key={w.year}>
                  <span>
                    <b className="num">{w.year}</b> {w.player}
                  </span>
                  <span className="muted small">{w.school}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
