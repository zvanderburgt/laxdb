import React, { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "../lib/app";
import { data, teamBySlug } from "../lib/data";
import { Card, Empty, TeamLogo } from "../components/ui";

type Game = { date: string; home: string; away: string; hs: number; as: number };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function matches(teamName: string, other: string) {
  const a = norm(teamName);
  const b = norm(other);
  return a.startsWith(b) || b.startsWith(a);
}

export default function Versus() {
  const route = useRoute();
  const [, , slugA = "", slugB = ""] = route.path.split("/");
  const teamA = teamBySlug.get(slugA);
  const teamB = teamBySlug.get(slugB);
  const [games, setGames] = useState<Game[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}scores.json`)
      .then((r) => r.json())
      .then((p: { d1?: Game[] }) => alive && setGames(p.d1 ?? []))
      .catch(() => alive && setGames([]));
    return () => {
      alive = false;
    };
  }, []);

  const meetings = useMemo(() => {
    if (!games || !teamA || !teamB) return [];
    return games
      .filter(
        (g) =>
          (matches(g.home, teamA.name) && matches(g.away, teamB.name)) ||
          (matches(g.home, teamB.name) && matches(g.away, teamA.name)),
      )
      .map((g) => {
        const aHome = matches(g.home, teamA.name);
        return {
          date: g.date,
          us: aHome ? g.hs : g.as,
          them: aHome ? g.as : g.hs,
          at: aHome ? "home" : "away",
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [games, teamA, teamB]);

  const teams = useMemo(
    () => data.teams.filter((t) => t.leagueId === "ncaa-d1").sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  if (!teamA || !teamB) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow">Head to head</div>
            <h1>Pick two programs</h1>
          </div>
        </div>
        <Empty title="Choose both programs" body="Use the selectors to compare any two Division I teams." />
        <TeamPickers teams={teams} a={slugA} b={slugB} />
      </div>
    );
  }

  const wins = meetings.filter((m) => m.us > m.them).length;
  const losses = meetings.filter((m) => m.us < m.them).length;
  const avgFor = meetings.length ? meetings.reduce((n, m) => n + m.us, 0) / meetings.length : 0;
  const avgAgainst = meetings.length ? meetings.reduce((n, m) => n + m.them, 0) / meetings.length : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Head to head</div>
          <h1 className="vs-title">
            <Link to={`/team/${teamA.slug}`} className="vs-team">
              <TeamLogo team={teamA} size={34} />
              {teamA.shortName}
            </Link>
            <span className="vs-record num">
              {wins}–{losses}
            </span>
            <Link to={`/team/${teamB.slug}`} className="vs-team">
              <TeamLogo team={teamB} size={34} />
              {teamB.shortName}
            </Link>
          </h1>
          <p className="muted">
            {meetings.length
              ? `${meetings.length} meetings on record (${meetings[meetings.length - 1].date.slice(0, 4)}–${meetings[0].date.slice(0, 4)}) · ${teamA.shortName} ${avgFor.toFixed(1)} – ${avgAgainst.toFixed(1)}`
              : "No meetings in the results we hold"}
          </p>
        </div>
      </div>

      <TeamPickers teams={teams} a={slugA} b={slugB} />

      {meetings.length ? (
        <Card padded={false} className="standings-card">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="r">Score</th>
                  <th className="r">Result</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.date}>
                    <td className="num">{m.date}</td>
                    <td className="r num">
                      {m.us}–{m.them}
                    </td>
                    <td className={`r num ${m.us > m.them ? "strong" : "muted"}`}>
                      {m.us > m.them ? "W" : "L"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            Only seasons in the scores feed appear — currently 2025 and 2026, so this is not an
            all-time series. Venue is omitted: the feed marks neutral-site tournament games as
            home for the higher seed.
          </div>
        </Card>
      ) : null}

      <p className="muted small">
        Open either program: <Link to={`/team/${teamA.slug}`}>{teamA.shortName}</Link> ·{" "}
        <Link to={`/team/${teamB.slug}`}>{teamB.shortName}</Link>
      </p>
    </div>
  );
}

function TeamPickers({ teams, a, b }: { teams: ReturnType<typeof data.teams.filter>; a: string; b: string }) {
  const go = (nextA: string, nextB: string) => {
    window.location.hash = `#/vs/${nextA}/${nextB}`;
  };
  return (
    <Card>
      <div className="vs-pickers">
        <label className="field">
          <span className="field-label">Program A</span>
          <select className="input" value={a} onChange={(e) => go(e.target.value, b)}>
            <option value="">Choose…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Program B</span>
          <select className="input" value={b} onChange={(e) => go(a, e.target.value)}>
            <option value="">Choose…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Card>
  );
}
