import React, { useState } from "react";
import { Link } from "../lib/app";
import { data, teamById } from "../lib/data";
import { Card, Empty, Segmented, TeamLogo } from "../components/ui";

const METRICS = [
  { value: "points", label: "Points" },
  { value: "goals", label: "Goals" },
  { value: "assists", label: "Assists" },
  { value: "points-pg", label: "Pts/G" },
  { value: "goals-pg", label: "G/G" },
  { value: "assists-pg", label: "A/G" },
];

function RecordBook() {
  const records = data.history?.records;
  const [scope, setScope] = useState<"career" | "season">("career");
  const [metric, setMetric] = useState("points");
  if (!records || !records.sections.length) return null;

  const section =
    records.sections.find((s) => s.key === `${scope}-${metric}`) ??
    records.sections.find((s) => s.scope === scope);
  if (!section) return null;

  const skip = ["Player", "Team", "Years", "Year", "Games"];
  const statCols = section.columns.filter((c) => !skip.includes(c));
  const ABBREV: Record<string, string> = {
    Goals: "G", Assists: "A", Points: "PTS", PPG: "PTS/G", GPG: "G/GP", APG: "A/G",
    "All-time Wins": "W", "All-time Losses": "L", "Winning Percent": "PCT",
    "National Titles": "TITLES", "Total Games": "GP", "Total Seasons": "SEASONS",
    "Initial Season": "FIRST",
  };
  const head = (c: string) => ABBREV[c] ?? c;

  return (
    <Card padded={false} className="standings-card">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">Record book</h3>
          <p className="muted small">NCAA Division I · {section.label.toLowerCase()}</p>
        </div>
        <Segmented
          size="sm"
          ariaLabel="Scope"
          value={scope}
          onChange={(v) => setScope(v as "career" | "season")}
          options={[
            { value: "career", label: "Career" },
            { value: "season", label: "Single season" },
          ]}
        />
      </div>
      <div className="record-metrics">
        <Segmented
          size="sm"
          ariaLabel="Metric"
          value={METRICS.some((m) => m.value === metric) ? metric : "points"}
          onChange={setMetric}
          options={METRICS}
        />
      </div>
      <div className="table-scroll">
        <table className="data-table record-table">
          <thead>
            <tr>
              <th className="c">#</th>
              <th>{section.scope === "program" ? "University" : "Player"}</th>
              <th>{section.scope === "program" ? "First" : "Team"}</th>
              <th className="r">{scope === "season" ? "Year" : "Years"}</th>
              {statCols.map((c) => (
                <th key={c} className="r">
                  {head(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.slice(0, 12).map((r, i) => (
              <tr key={`${r.Player ?? r.University}-${i}`}>
                <td className="c num muted">{i + 1}</td>
                <td className="strong">{r.Player ?? r.University}</td>
                <td className="muted">{r.Team ?? r["Initial Season"]}</td>
                <td className="r num muted">{r.Year ?? r.Years ?? "—"}</td>
                {statCols.map((c) => (
                  <td key={c} className="r num">
                    {r[c]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-note">
        These lists reach back to the 1970s, so the players are not linked — most predate the
        seasons we index. Source: NCAA record book via Wikipedia.
      </div>
    </Card>
  );
}

function AllAmericans() {
  const blocks = data.history?.allAmericans ?? [];
  const [year, setYear] = useState(blocks[0] ? String(blocks[0].year) : "");
  const [teamKey, setTeamKey] = useState("1st");
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("all");
  if (!blocks.length) return null;

  const block = blocks.find((b) => String(b.year) === year) ?? blocks[0];
  const group = block.teams.find((t) => t.team.startsWith(teamKey)) ?? block.teams[0];

  const everyRow = block.teams.flatMap((t) => t.players.map((p) => ({ ...p, tier: t.team })));
  const positions = [...new Set(everyRow.map((p) => p.position).filter(Boolean))].sort();
  const searching = Boolean(q.trim()) || pos !== "all";
  const list = searching
    ? everyRow.filter((p) => {
        const needle = q.trim().toLowerCase();
        const hit = !needle || `${p.name} ${p.school}`.toLowerCase().includes(needle);
        return hit && (pos === "all" || p.position === pos);
      })
    : group.players.map((p) => ({ ...p, tier: group.team }));

  return (
    <Card padded={false} className="standings-card">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">All-Americans</h3>
          <p className="muted small">
            USILA {block.division} · {block.teams.reduce((n, t) => n + t.players.length, 0)}{" "}
            players
          </p>
        </div>
        {blocks.length > 1 ? (
          <Segmented
            size="sm"
            ariaLabel="Season"
            value={year}
            onChange={setYear}
            options={blocks.map((b) => ({ value: String(b.year), label: String(b.year) }))}
          />
        ) : null}
      </div>
      <div className="aa-filters">
        <input
          className="input"
          placeholder="Filter by name or school"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input" value={pos} onChange={(e) => setPos(e.target.value)}>
          <option value="all">All positions</option>
          {positions.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        {searching ? (
          <span className="muted small">
            {list.length} of {everyRow.length} across every team
          </span>
        ) : null}
      </div>
      <div className="record-metrics aa-teams">
        <span className="aa-label">Team</span>
        <Segmented
          size="sm"
          ariaLabel="Team"
          value={group.team}
          onChange={setTeamKey}
          options={block.teams.map((t) => ({
            value: t.team,
            label: `${t.team} (${t.players.length})`,
          }))}
        />
      </div>
      <ul className="aa-list">
        {list.map((p) => {
          const team = p.teamId ? teamById.get(p.teamId) : undefined;
          return (
            <li key={`${p.name}-${p.school}`}>
              <span className="aa-name">{p.name}</span>
              <span className="aa-school">
                {team ? (
                  <Link to={`/team/${team.slug}`} className="team-link">
                    <TeamLogo team={team} size={16} />
                    {team.shortName}
                  </Link>
                ) : (
                  <span className="muted">{p.school}</span>
                )}
              </span>
              <span className="aa-class muted small">
                {p.position} · {p.class}
                {searching ? ` · ${p.tier}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

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

      <div className="leader-grid history-second">
        <RecordBook />
        <div className="stack">
          <AllAmericans />
        </div>
      </div>
    </div>
  );
}
