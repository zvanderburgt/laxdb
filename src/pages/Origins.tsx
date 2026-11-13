import React, { useMemo, useRef, useState } from "react";
import { useFlipRows } from "../lib/motion";
import { Link } from "../lib/app";
import { data, teamById } from "../lib/data";
import { region, regionCode } from "../lib/geo";
import { BlockList, Card, Empty, Segmented, Term, TeamLogo } from "../components/ui";

type Row = {
  code: string;
  name: string;
  country: "US" | "CA";
  players: number;
  share: number;
  per100k: number;
  programs: { id: string; n: number }[];
};

export default function Origins() {
  const [metric, setMetric] = useState<"players" | "rate">("players");

  const rows = useMemo<Row[]>(() => {
    const d1 = data.players.filter((p) => p.leagueId === "ncaa-d1");
    const total = d1.length || 1;
    const byState = new Map<string, { players: number; programs: Map<string, number> }>();

    for (const p of d1) {
      const code = regionCode(p.birthplace?.state);
      if (!code) continue;
      const entry = byState.get(code) ?? { players: 0, programs: new Map() };
      entry.players += 1;
      entry.programs.set(p.teamId, (entry.programs.get(p.teamId) ?? 0) + 1);
      byState.set(code, entry);
    }

    const out: Row[] = [];
    for (const [code, v] of byState) {
      const meta = region(code);
      if (!meta) continue;
      out.push({
        code,
        name: meta.name,
        country: meta.country,
        players: v.players,
        share: (v.players / total) * 100,
        per100k: (v.players / meta.pop) * 100000,
        programs: [...v.programs]
          .map(([id, n]) => ({ id, n }))
          .sort((a, b) => b.n - a.n)
          .slice(0, 3),
      });
    }
    return out.sort((a, b) => b.players - a.players);
  }, []);

  if (!rows.length) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow">Origins</div>
            <h1>Where players come from</h1>
          </div>
        </div>
        <Empty title="No hometown data yet" body="Run the importer to populate player birthplaces." />
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => (metric === "players" ? b.players - a.players : b.per100k - a.per100k));
  const max = Math.max(...sorted.map((r) => (metric === "players" ? r.players : r.per100k)));
  /* switching players ↔ per-100k re-ranks the same states: they trade places */
  const body = useRef<HTMLTableSectionElement>(null);
  useFlipRows(body, [metric], { max: 30 });
  const byRate = [...rows].sort((a, b) => b.per100k - a.per100k);
  const schools = (() => {
    const d1 = data.players.filter((p) => p.leagueId === "ncaa-d1" && p.highSchool);
    const map = new Map<string, { name: string; players: number; programs: Map<string, number>; states: Map<string, number> }>();
    for (const p of d1) {
      const name = (p.highSchool ?? "").trim();
      if (!name || name.length < 3) continue;
      const key = name.toLowerCase();
      const entry = map.get(key) ?? { name, players: 0, programs: new Map(), states: new Map() };
      entry.players += 1;
      entry.programs.set(p.teamId, (entry.programs.get(p.teamId) ?? 0) + 1);
      const st = regionCode(p.birthplace?.state);
      if (st) entry.states.set(st, (entry.states.get(st) ?? 0) + 1);
      map.set(key, entry);
    }
    return [...map.values()]
      .filter((r) => r.players >= 2)
      .sort((a, b) => b.players - a.players)
      .slice(0, 40)
      .map((r) => ({
        ...r,
        state: [...r.states.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
        programs: [...r.programs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      }));
  })();
  const usTotal = rows.filter((r) => r.country === "US").reduce((n, r) => n + r.players, 0);
  const caTotal = rows.filter((r) => r.country === "CA").reduce((n, r) => n + r.players, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Origins</div>
          <h1>Where players come from</h1>
          <p className="muted">
            {usTotal.toLocaleString()} from the United States · {caTotal.toLocaleString()} from
            Canada · {rows.length} states and provinces feed Division I lacrosse
          </p>
        </div>
        <Segmented
          ariaLabel="Rank by"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "players", label: "Players" },
            { value: "rate", label: "Per 100k" },
          ]}
        />
      </div>

      <Card padded={false} className="standings-card">
        <div className="card-toolbar">
          <div>
            <h3 className="card-title">
              {metric === "players" ? "Players by state" : "Players per 100,000 residents"}
            </h3>
            <p className="muted small">
              Birthplace as published by each school · population from the 2020 census
            </p>
          </div>
        </div>
        <BlockList
          motionKey={metric}
          rows={sorted.map((r, i) => ({
            key: r.code,
            rank: i + 1,
            primary: <span className="strong">{r.name}</span>,
            meta: r.code,
            cells: [
              { label: <Term k="players" />, value: r.players, strong: true },
              { label: <Term k="share" />, value: `${r.share.toFixed(1)}%` },
              { label: <Term k="per100k" />, value: r.per100k.toFixed(1) },
            ],
            note: (
              <span className="origin-programs">
                {r.programs.map((pr) => {
                  const team = teamById.get(pr.id);
                  return team ? (
                    <Link key={pr.id} to={`/team/${team.slug}`} className="team-link">
                      <TeamLogo team={team} size={16} />
                      {team.shortName}
                    </Link>
                  ) : null;
                })}
              </span>
            ),
          }))}
        />
        <div className="table-scroll origins-scroll hide-sm">
          <table className="data-table">
            <thead>
              <tr>
                <th className="c">#</th>
                <th>State</th>
                <th className="r"><Term k="players" /></th>
                <th className="r col-share"><Term k="share" /></th>
                <th className="r"><Term k="per100k" /></th>
                <th className="col-programs">Top programs</th>
              </tr>
            </thead>
            <tbody ref={body}>
              {sorted.map((r, i) => (
                <tr key={r.code} data-k={r.code}>
                  <td className="c num muted">{i + 1}</td>
                  <td>
                    <span className="strong">{r.name}</span>
                    <span className="muted small"> {r.code}</span>
                  </td>
                  <td className="r num strong">{r.players}</td>
                  <td className="r num muted col-share">{r.share.toFixed(1)}%</td>
                  <td className="r num">{r.per100k.toFixed(1)}</td>
                  <td className="col-programs">
                    <span className="origin-programs">
                      {r.programs.map((pr) => {
                        const team = teamById.get(pr.id);
                        return team ? (
                          <Link key={pr.id} to={`/team/${team.slug}`} className="team-link">
                            <TeamLogo team={team} size={16} />
                            {team.shortName}
                          </Link>
                        ) : null;
                      })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-note">
          {metric === "players"
            ? `${rows[0].name} alone supplies ${rows[0].share.toFixed(0)}% of Division I players.`
            : `${byRate[0].name} produces ${byRate[0].per100k.toFixed(1)} players per 100,000 residents — the densest lacrosse state per capita.`}{" "}
          Share is of all {rows.reduce((n, r) => n + r.players, 0).toLocaleString()} players with a
          birthplace on file.
        </div>
      </Card>

      {schools.length ? (
        <Card padded={false} className="standings-card">
          <div className="card-toolbar">
            <div>
              <h3 className="card-title">Top high schools</h3>
              <p className="muted small">
                Schools feeding the most Division I rosters · {schools.length} with two or more
                players
              </p>
            </div>
          </div>
          <BlockList
            rows={schools.map((r, i) => ({
              key: r.name,
              rank: i + 1,
              primary: <span className="strong">{r.name}</span>,
              meta: r.state,
              cells: [{ label: <Term k="players" />, value: r.players, strong: true }],
              note: (
                <span className="origin-programs">
                  {r.programs.map(([id, n]) => {
                    const team = teamById.get(id);
                    return team ? (
                      <Link key={id} to={`/team/${team.slug}`} className="team-link">
                        <TeamLogo team={team} size={16} />
                        {team.shortName}
                        <span className="muted small"> {n}</span>
                      </Link>
                    ) : null;
                  })}
                </span>
              ),
            }))}
          />
          <div className="table-scroll hide-sm">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="c">#</th>
                  <th>High school</th>
                  <th className="r"><Term k="players" /></th>
                  <th className="col-programs">Top programs</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((r, i) => (
                  <tr key={r.name}>
                    <td className="c num muted">{i + 1}</td>
                    <td>
                      <span className="strong">{r.name}</span>
                      {r.state ? <span className="muted small"> {r.state}</span> : null}
                    </td>
                    <td className="r num strong">{r.players}</td>
                    <td className="col-programs">
                      <span className="origin-programs">
                        {r.programs.map(([id, n]) => {
                          const team = teamById.get(id);
                          return team ? (
                            <Link key={id} to={`/team/${team.slug}`} className="team-link">
                              <TeamLogo team={team} size={16} />
                              {team.shortName}
                              <span className="muted small"> {n}</span>
                            </Link>
                          ) : null;
                        })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
