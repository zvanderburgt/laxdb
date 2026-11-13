import React, { useMemo, useState } from "react";
import { Link } from "../lib/app";
import { data, leagueById, teamById, teamByName } from "../lib/data";
import { BlockList, Card, PlayerAvatar, Segmented, Term } from "../components/ui";
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

/** index each competition-season to 100 = that league's own scoring level */
function indexCat(leaguePpg: number): Cat | null {
  if (!leaguePpg) return null;
  return {
    key: "idx",
    label: "Pts index",
    value: (r) => (r.gp ? ((r.pts / r.gp) / leaguePpg) * 100 : null),
    format: (n) => n.toFixed(0),
  };
}

/** every club name on the site should reach that club's page */
function linkTeam(name: string) {
  const t = teamByName(name);
  if (!t) return name;
  return (
    <Link to={`/team/${t.slug}`} className="cell-link">
      {t.shortName}
    </Link>
  );
}

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
  const [pos, setPos] = useState<"all" | "A" | "M" | "D" | "G">("all");
  const activeSeason = season && seasons.includes(season) ? season : seasons[0];
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

  const leaguePpg = useMemo(() => {
    const gp = rows.reduce((n, r) => n + r.gp, 0);
    const pts = rows.reduce((n, r) => n + r.pts, 0);
    return gp ? pts / gp : 0;
  }, [rows]);
  const cats = useMemo(() => {
    const idx = indexCat(leaguePpg);
    return idx ? [...CATS, idx] : CATS;
  }, [leaguePpg]);
  const cat = cats.find((c) => c.key === catKey) ?? cats[0];

  const board = useMemo(() => {
    const inGroup = (position: string) => {
      if (pos === "all") return true;
      if (pos === "G") return position === "G";
      if (pos === "D") return position === "D" || position === "LSM";
      if (pos === "M") return position === "M" || position === "SSDM" || position === "FO";
      return position === "A";
    };
    const eligible = rows.filter((r) => {
      if (!inGroup(r.player.position)) return false;
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
  }, [rows, cat, pos]);

  const league = leagueById.get(leagueId);

  // the ranked statistic is the headline column; the fixed G / AST / PTS columns skip it,
  // because "Points" beside "PTS" printed the same number twice
  const catTerm = cat.key === "fop" ? "fo" : cat.key;
  const leads = !["g", "a", "pts"].includes(cat.key);
  const headKeys = ["gp", ...(leads ? [catTerm] : []), "g", "a", "pts"];
  const rowCells = (r: (typeof board.list)[number]["r"], v: number) => {
    const cells: { k: string; value: React.ReactNode; strong?: boolean }[] = [{ k: "gp", value: r.gp }];
    if (leads) cells.push({ k: catTerm, value: cat.format(v), strong: true });
    cells.push({ k: "g", value: r.g, strong: cat.key === "g" });
    cells.push({ k: "a", value: r.a, strong: cat.key === "a" });
    cells.push({ k: "pts", value: r.pts, strong: cat.key === "pts" });
    return cells;
  };

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
            {cat.key === "idx" && leaguePpg
              ? ` · 100 = this competition's ${leaguePpg.toFixed(2)} points per game`
              : ""}
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
            ariaLabel="Position"
            value={pos}
            onChange={setPos}
            options={[
              { value: "all", label: "All positions" },
              { value: "A", label: "Attack" },
              { value: "M", label: "Midfield" },
              { value: "D", label: "Defence" },
              { value: "G", label: "Goalie" },
            ]}
          />
          <Segmented
            ariaLabel="Stat"
            value={catKey}
            onChange={setCatKey}
            options={cats.map((c) => ({ value: c.key, label: c.label }))}
          />
        </div>
      </Card>

      <Card padded={false} className="standings-card">
        <BlockList
          rows={board.list.map(({ r, v }, i) => ({
            key: r.player.id,
            rank: i + 1,
            primary: (
              <Link to={`/player/${r.player.slug}`} className="cell-player">
                <PlayerAvatar player={r.player} size={26} />
                <span className="cell-name">{r.player.name}</span>
              </Link>
            ),
            meta: linkTeam(r.team),
            cells: rowCells(r, v).map((c) => ({ label: <Term k={c.k} />, value: c.value, strong: c.strong })),
          }))}
        />
        <div className="table-scroll hide-sm">
          <table className="data-table leaders-table">
            <thead>
              <tr>
                <th className="c">#</th>
                <th>Player</th>
                <th>Team</th>
                {headKeys.map((k) => (
                  <th key={k} className="r">
                    <Term k={k} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.list.map(({ r, v }, i) => (
                <tr key={r.player.id}>
                  <td className="c num muted">{i + 1}</td>
                  <td>
                    <Link to={`/player/${r.player.slug}`} className="leader-cell">
                      <PlayerAvatar player={r.player} size={26} />
                      <span>{r.player.name}</span>
                    </Link>
                  </td>
                  <td className="muted small">{linkTeam(r.team)}</td>
                  {rowCells(r, v).map((c) => (
                    <td key={c.k} className={`r num${c.strong ? " strong" : ""}`}>
                      {c.value}
                    </td>
                  ))}
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
