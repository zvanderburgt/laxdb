import React, { useMemo, useState } from "react";
import { Link } from "../lib/app";
import { data, leagueById, teamById } from "../lib/data";
import { Card, PlayerAvatar, Segmented } from "../components/ui";
import type { Player } from "../lib/types";

/**
 * Leaders by stat, league and season.
 *
 * Qualification matters more than ordering here: a two-game sample should never top a
 * list, so every board applies a minimum-games rule relative to the leader's workload
 * and states it on the page.
 */

type Cat = {
  key: string;
  label: string;
  value: (r: Row) => number | null;
  format: (n: number) => string;
  goalie?: boolean;
  asc?: boolean;
};

type Row = {
  player: Player;
  gp: number;
  g: number;
  a: number;
  pts: number;
  sh: number;
  gb: number;
  ct: number;
  foW: number;
  foA: number;
  sv: number;
  ga: number;
  w: number;
  l: number;
  team: string;
};

const CATS: Cat[] = [
  { key: "pts", label: "Points", value: (r) => r.pts, format: (n) => `${n}` },
  { key: "g", label: "Goals", value: (r) => r.g, format: (n) => `${n}` },
  { key: "a", label: "Assists", value: (r) => r.a, format: (n) => `${n}` },
  { key: "ppg", label: "Pts / game", value: (r) => (r.gp ? r.pts / r.gp : null), format: (n) => n.toFixed(2) },
  { key: "shp", label: "Shooting %", value: (r) => (r.sh >= 15 ? (r.g / r.sh) * 100 : null), format: (n) => `${n.toFixed(1)}%` },
  { key: "gb", label: "Ground balls", value: (r) => r.gb, format: (n) => `${n}` },
  { key: "ct", label: "Caused turnovers", value: (r) => r.ct, format: (n) => `${n}` },
  { key: "fop", label: "Faceoff %", value: (r) => (r.foA >= 25 ? (r.foW / r.foA) * 100 : null), format: (n) => `${n.toFixed(1)}%` },
  // some feeds publish saves without goals against, which would read as a perfect save %;
  // both halves have to exist before a goalie rate is shown
  { key: "svp", label: "Save %", value: (r) => (r.sv >= 25 && r.ga >= 10 ? (r.sv / (r.sv + r.ga)) * 100 : null), format: (n) => `${n.toFixed(1)}%`, goalie: true },
  { key: "gaa", label: "GAA", value: (r) => (r.gp >= 5 && r.ga >= 10 ? r.ga / r.gp : null), format: (n) => n.toFixed(2), goalie: true, asc: true },
];

export default function Leaders() {
  const leagues = useMemo(
    () => data.leagues.filter((l) => data.players.some((p) => p.leagueId === l.id)),
    [],
  );
  const [leagueId, setLeagueId] = useState(leagues[0]?.id ?? "ncaa-d1");
  const [catKey, setCatKey] = useState("pts");

  const seasons = useMemo(() => {
    const set = new Set<string>();
    for (const p of data.players) {
      if (p.leagueId !== leagueId) continue;
      for (const s of p.seasons) set.add(s.season);
    }
    return [...set].sort().reverse();
  }, [leagueId]);

  const [season, setSeason] = useState<string | null>(null);
  const [scope, setScope] = useState<"season" | "career">("season");
  const activeSeason = season && seasons.includes(season) ? season : seasons[0];
  const cat = CATS.find((c) => c.key === catKey) ?? CATS[0];

  const rows = useMemo<Row[]>(() => {
    if (!activeSeason) return [];
    const out: Row[] = [];
    for (const p of data.players) {
      if (p.leagueId !== leagueId) continue;
      const s = scope === "career" ? careerRow(p, leagueId) : p.seasons.find((x) => x.season === activeSeason);
      if (!s || !s.gp) continue;
      out.push({
        player: p,
        gp: s.gp || 0,
        g: s.g || 0,
        a: s.a || 0,
        pts: s.pts || 0,
        sh: s.sh || 0,
        gb: s.gb || 0,
        ct: s.ct || 0,
        foW: s.foW || 0,
        foA: s.foA || 0,
        sv: s.sv || 0,
        ga: s.ga || 0,
        w: s.w || 0,
        l: s.l || 0,
        team: teamById.get(s.teamId)?.shortName ?? "",
      });
    }
    return out;
  }, [leagueId, activeSeason, scope]);

  const board = useMemo(() => {
    const eligible = rows.filter((r) => {
      if (cat.goalie) return (r.sv + r.ga) > 0 || r.ga > 0;
      return r.gp > 0;
    });
    const values = eligible
      .map((r) => ({ r, v: cat.value(r) }))
      .filter((x): x is { r: Row; v: number } => typeof x.v === "number" && Number.isFinite(x.v));
    if (!values.length) return { list: [], minGames: 0 };

    // A player must have played at least half as many games as the busiest qualifier,
    // so a 2-game cameo cannot sit above a full season.
    const maxGp = Math.max(...values.map((x) => x.r.gp));
    const minGames = cat.goalie ? Math.max(4, Math.ceil(maxGp * 0.4)) : Math.max(5, Math.ceil(maxGp * 0.5));
    const list = values
      .filter((x) => x.r.gp >= minGames)
      .sort((a, b) => (cat.asc ? a.v - b.v : b.v - a.v))
      .slice(0, 25);
    return { list, minGames };
  }, [rows, cat]);

  const league = leagueById.get(leagueId);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Leaders</div>
          <h1>Stat leaders</h1>
          <p className="muted">
            {league?.name}
            {scope === "career" ? " · career" : activeSeason ? ` · ${activeSeason}` : ""}
            {board.minGames ? ` · minimum ${board.minGames} games played to qualify` : ""}
          </p>
        </div>
      </div>

      <Card>
        <div className="leaders-controls">
          <label className="field">
            <span className="field-label">Competition</span>
            <select
              className="input"
              value={leagueId}
              onChange={(e) => {
                setLeagueId(e.target.value);
                setSeason(null);
                setCatKey("pts"); // a goalie board on a box league just looks broken
              }}
            >
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Scope</span>
            <select
              className="input"
              value={scope}
              onChange={(e) => setScope(e.target.value as "season" | "career")}
            >
              <option value="season">Single season</option>
              <option value="career">Career (all seasons held)</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Season</span>
            <select
              className="input"
              value={activeSeason ?? ""}
              onChange={(e) => setSeason(e.target.value)}
              disabled={scope === "career"}
            >
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="leaders-tabs">
          <Segmented
            ariaLabel="Stat"
            value={catKey}
            onChange={setCatKey}
            options={CATS.map((c) => ({ value: c.key, label: c.label }))}
          />
        </div>
      </Card>

      <Card padded={false} className="standings-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="c">#</th>
                <th>Player</th>
                <th>Team</th>
                <th className="r">GP</th>
                <th className="r">{cat.label}</th>
                <th className="r">G</th>
                <th className="r">A</th>
                <th className="r">PTS</th>
              </tr>
            </thead>
            <tbody>
              {board.list.map(({ r, v }, i) => (
                <tr key={r.player.id}>
                  <td className="c num muted">{i + 1}</td>
                  <td>
                    <Link to={`/player/${r.player.slug}`} className="leader-name">
                      <PlayerAvatar player={r.player} size={26} />
                      <span>{r.player.name}</span>
                    </Link>
                  </td>
                  <td className="muted small">{r.team}</td>
                  <td className="r num">{r.gp}</td>
                  <td className="r num strong">{cat.format(v)}</td>
                  <td className="r num">{r.g}</td>
                  <td className="r num">{r.a}</td>
                  <td className="r num">{r.pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!board.list.length ? (
          <p className="muted small" style={{ padding: 18 }}>
            No qualified players for this category yet.
          </p>
        ) : null}
      </Card>
    </div>
  );
}

/** Sum a player's seasons inside one competition, for the career view. */
function careerRow(p: Player, leagueId: string) {
  const acc = { gp: 0, g: 0, a: 0, pts: 0, sh: 0, gb: 0, ct: 0, foW: 0, foA: 0, sv: 0, ga: 0, w: 0, l: 0, teamId: p.teamId };
  for (const x of p.seasons) {
    if (x.leagueId !== leagueId) continue;
    acc.gp += x.gp || 0;
    acc.g += x.g || 0;
    acc.a += x.a || 0;
    acc.pts += x.pts || 0;
    acc.sh += x.sh || 0;
    acc.gb += x.gb || 0;
    acc.ct += x.ct || 0;
    acc.foW += x.foW || 0;
    acc.foA += x.foA || 0;
    acc.sv += x.sv || 0;
    acc.ga += x.ga || 0;
    acc.w += x.w || 0;
    acc.l += x.l || 0;
  }
  return acc;
}
