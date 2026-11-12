import React, { useEffect, useMemo, useState } from "react";
import { Link } from "../lib/app";
import { teamByName } from "../lib/data";
import { Card, Segmented } from "../components/ui";

type Game = { date: string; home: string; away: string; hs: number; as: number; venue?: string };
type Payload = { d1: Game[]; pll: Game[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function label(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export default function Scores() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [league, setLeague] = useState<"d1" | "pll">("d1");
  const [season, setSeason] = useState<string | null>(null);
  const [shown, setShown] = useState(4);

  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}scores.json`)
      .then((r) => r.json())
      .then((d: Payload) => alive && setPayload(d))
      .catch(() => alive && setPayload({ d1: [], pll: [] }));
    return () => {
      alive = false;
    };
  }, []);

  const games = useMemo(() => (payload ? payload[league] ?? [] : []), [payload, league]);

  const seasons = useMemo(
    () => [...new Set(games.map((g) => g.date.slice(0, 4)).filter(Boolean))].sort().reverse(),
    [games],
  );
  const activeSeason = season && seasons.includes(season) ? season : seasons[0];

  const byDate = useMemo(() => {
    const map = new Map<string, Game[]>();
    for (const g of games) {
      if (!g.date || (activeSeason && g.date.slice(0, 4) !== activeSeason)) continue;
      map.set(g.date, [...(map.get(g.date) ?? []), g]);
    }
    return [...map.entries()]
      .map(([d, list]) => ({ date: d, games: list.sort((a, b) => a.home.localeCompare(b.home)) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [games, activeSeason]);

  if (!payload) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow">Scores</div>
            <h1>Final scores</h1>
            <p className="muted">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Scores</div>
          <h1>Final scores</h1>
          <p className="muted">
            {league === "d1" ? "NCAA Division I" : "Premier Lacrosse League"}
            {activeSeason ? ` · ${activeSeason}` : ""} · {byDate.reduce((n, d) => n + d.games.length, 0)}{" "}
            games across {byDate.length} dates
          </p>
        </div>
        <div className="scores-controls">
          <Link to="/vs/" className="btn btn-ghost small">
            Head to head
          </Link>
          <Segmented
            ariaLabel="League"
            value={league}
            onChange={(v) => {
              setLeague(v);
              setSeason(null);
              setShown(4);
            }}
            options={[
              { value: "d1", label: "NCAA D1" },
              { value: "pll", label: "PLL" },
            ]}
          />
          <select
            className="input"
            value={activeSeason ?? ""}
            onChange={(e) => setSeason(e.target.value)}
            aria-label="Season"
          >
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {byDate.slice(0, shown).map((day) => (
        <Card key={day.date} padded={false} className="standings-card">
          <div className="scores-day">
            <span className="strong">{label(day.date)}</span>
            <span className="muted small">
              {day.games.length} {day.games.length === 1 ? "game" : "games"}
            </span>
          </div>
          <ul className="scores-list">
            {day.games.map((g) => {
              const homeTeam = teamByName(g.home);
              const awayTeam = teamByName(g.away);
              const homeWon = g.hs > g.as;
              return (
                <li key={`${g.date}-${g.home}-${g.away}`}>
                  <span className={homeWon ? "muted" : "strong"}>
                    {awayTeam ? (
                      <Link to={`/team/${awayTeam.slug}`}>{awayTeam.shortName}</Link>
                    ) : (
                      g.away
                    )}
                  </span>
                  <span className="num score-line">
                    <span className={awayTeam && !homeWon ? "strong" : ""}>{g.as}</span>
                    <span className="muted"> – </span>
                    <span className={homeWon ? "strong" : ""}>{g.hs}</span>
                  </span>
                  <span className={homeWon ? "strong" : "muted"}>
                    {homeTeam ? <Link to={`/team/${homeTeam.slug}`}>{homeTeam.shortName}</Link> : g.home}
                  </span>
                  {g.venue ? <span className="muted small scores-venue">{g.venue}</span> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      {shown < byDate.length ? (
        <button className="btn btn-ghost" onClick={() => setShown((n) => n + 6)}>
          Show earlier dates
        </button>
      ) : null}
    </div>
  );
}
