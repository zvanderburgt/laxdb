import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useCompare, useRoute } from "../lib/app";
import {
  ageOf,
  careerTotals,
  currentSeason,
  data,
  fmtHeight,
  leagueById,
  playerById,
  teamById,
  teamOf,
  searchPlayers,
} from "../lib/data";
import { Avatar, Card, Empty, PositionBadge, PlayerAvatar } from "../components/ui";

const ROWS: { key: string; label: string; get: (p: any) => string | number; raw?: (p: any) => number; max?: number }[] = [
  { key: "gp", label: "Games played", get: (p) => careerTotals(p).gp, raw: (p) => careerTotals(p).gp },
  { key: "g", label: "Goals", get: (p) => careerTotals(p).g, raw: (p) => careerTotals(p).g },
  { key: "a", label: "Assists", get: (p) => careerTotals(p).a, raw: (p) => careerTotals(p).a },
  { key: "pts", label: "Points", get: (p) => careerTotals(p).pts, raw: (p) => careerTotals(p).pts },
  { key: "ppg", label: "Points / game", get: (p) => careerTotals(p).ppg.toFixed(2), raw: (p) => careerTotals(p).ppg * 100 },
  { key: "gb", label: "Ground balls", get: (p) => careerTotals(p).gb, raw: (p) => careerTotals(p).gb },
  { key: "ct", label: "Caused turnovers", get: (p) => careerTotals(p).ct, raw: (p) => careerTotals(p).ct },
  { key: "fop", label: "Faceoff %", get: (p) => (careerTotals(p).fop ? (careerTotals(p).fop * 100).toFixed(1) + "%" : "—"), raw: (p) => careerTotals(p).fop * 100 },
  { key: "svp", label: "Save % (goalies)", get: (p) => (careerTotals(p).svp ? (careerTotals(p).svp * 100).toFixed(1) + "%" : "—"), raw: (p) => careerTotals(p).svp * 100 },
  { key: "gaa", label: "GAA (goalies)", get: (p) => (careerTotals(p).gaa ? careerTotals(p).gaa.toFixed(2) : "—"), raw: (p) => careerTotals(p).gaa, max: 20 },
];

const BIOS: { label: string; get: (p: any) => React.ReactNode }[] = [
  { label: "Team", get: (p) => <Link className="team-link" to={`/team/${teamById.get(p.teamId)?.slug}`}>{teamById.get(p.teamId)?.shortName}</Link> },
  { label: "Competition", get: (p) => leagueById.get(p.leagueId)?.name },
  { label: "Position", get: (p) => <PositionBadge pos={p.position} /> },
  { label: "Class", get: (p) => (p.classYear ? `Class of ${p.classYear}` : "—") },
  { label: "Height / weight", get: (p) => `${fmtHeight(p.heightIn)}${p.weightLb ? ` · ${p.weightLb} lb` : ""}` },
  { label: "Hand", get: (p) => (p.hand === "R" ? "Right" : "Left") },
  { label: "Age", get: (p) => `${ageOf(p.dob) ?? "—"}` },
  { label: "Hometown", get: (p) => (p.birthplace.city ? `${p.birthplace.city}, ${p.birthplace.state}` : "—") },
  { label: "High school", get: (p) => p.highSchool || "—" },
];

export default function ComparePage() {
  const { ids, toggle, clear, has } = useCompare();
  const route = useRoute();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Deep links carry ?ids=p-0001,p-0002 — seed the comparison from them once.
  useEffect(() => {
    const qs = route.query.get("ids");
    if (!qs) return;
    for (const id of qs.split(",").filter(Boolean)) {
      if (playerById.has(id) && !has(id)) toggle(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const picks = ids.map((id) => playerById.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  const results = useMemo(() => (q ? searchPlayers(q, 6) : []), [q]);

  const add = (id: string) => {
    if (!has(id)) toggle(id);
    setQ("");
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Tools</div>
          <h1>Compare players</h1>
          <p className="muted">Line up to three players side by side. Careers, size, and production.</p>
        </div>
        <div className="page-actions">
          {picks.length < 3 ? (
            <button className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.focus()}>
              Add player
            </button>
          ) : null}
          {picks.length ? <button className="btn btn-ghost btn-sm" onClick={clear}>Clear all</button> : null}
        </div>
      </div>

      <div className="cmp-picker">
        <div className="filter-search grow">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12.8 12.8L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={picks.length >= 3 ? "Remove someone to add another" : "Add a player by name…"}
            aria-label="Add player"
            disabled={picks.length >= 3}
          />
        </div>
        {results.length > 0 ? (
          <div className="cmp-results">
            {results.map((p) => (
              <button key={p.id} className="cmp-result" onClick={() => add(p.id)}>
                <PlayerAvatar player={p} size={30} />
                <span className="cell-name">{p.name}</span>
                <span className="muted small">{teamById.get(p.teamId)?.shortName} · {p.position}</span>
                <span className="cmp-add">Add</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {picks.length === 0 ? (
        <Card>
          <Empty title="Nothing to compare yet" body="Add players above, or start from one of these." />
          <div className="cards-row compact">
            {data.players.slice(0, 4).map((p) => (
              <button key={p.id} className="mini-card as-button" onClick={() => add(p.id)}>
                <PlayerAvatar player={p} size={42} />
                <div>
                  <div className="cell-name">{p.name}</div>
                  <div className="cell-sub">{teamById.get(p.teamId)?.shortName}</div>
                </div>
                <span className="cmp-add">Add</span>
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <Card padded={false} className="cmp-card">
          <div className="table-scroll">
            <table className="cmp-table">
              <thead>
                <tr>
                  <th className="cmp-corner">Player</th>
                  {picks.map((p) => (
                    <th key={p.id}>
                      <div className="cmp-head">
                        <PlayerAvatar player={p} size={56} />
                        <Link to={`/player/${p.slug}`} className="cmp-name">{p.name}</Link>
                        <span className="muted small">{teamById.get(p.teamId)?.shortName}</span>
                        <PositionBadge pos={p.position} />
                        <button className="cmp-remove" onClick={() => toggle(p.id)} aria-label={`Remove ${p.name}`}>×</button>
                      </div>
                    </th>
                  ))}

                </tr>
              </thead>
              <tbody>
                <tr className="cmp-section">
                  <td className="cmp-label" colSpan={picks.length + 1}>Profile</td>
                </tr>
                {BIOS.map((r) => (
                  <tr key={r.label} className="bio-row">
                    <td className="cmp-label">{r.label}</td>
                    {picks.map((p) => <td key={p.id}>{r.get(p)}</td>)}
                  </tr>
                ))}
                <tr className="cmp-section">
                  <td className="cmp-label" colSpan={picks.length + 1}>Career production</td>
                </tr>
                {ROWS.map((r) => {
                  const vals = picks.map((p) => r.raw!(p));
                  const max = r.max ?? Math.max(...vals, 1);
                  return (
                    <tr key={r.key}>
                      <td className="cmp-label">{r.label}</td>
                      {picks.map((p, i) => (
                        <td key={p.id}>
                          <div className="cmp-val">
                            <span className="num strong">{r.get(p)}</span>
                            <span className="cmp-bar">
                              <span style={{ width: `${Math.min(100, (vals[i] / max) * 100)}%` }} />
                            </span>
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
                <tr className="bio-row">
                  <td className="cmp-label">Current season</td>
                  {picks.map((p) => (
                    <td key={p.id}>
                      <Link className="link-arrow small" to={`/player/${p.slug}`}>
                        {currentSeason(p).g}G · {currentSeason(p).a}A · {currentSeason(p).pts}PTS →
                      </Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="table-note">
            Bars are scaled to the highest value in each row. Career totals cover every indexed season.
          </div>
        </Card>
      )}
    </div>
  );
}
