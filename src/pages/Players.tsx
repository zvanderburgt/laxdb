import React, { useMemo, useState } from "react";
import { Link, useRoute, useCompare } from "../lib/app";
import {
  data,
  teamById,
  leagueById,
  classYears,
  careerTotals,
  currentSeason,
  statesList,
  teamOf,
} from "../lib/data";
import { Input } from "../components/shadcn/input";
import { Button } from "../components/shadcn/button";
import { Avatar, Empty, FilterSelect, PlayerAvatar, PositionBadge, Segmented } from "../components/ui";

const POSITIONS = ["A", "M", "D", "G", "FO", "LSM"];
const SORTS = [
  { value: "pts", label: "Sort: points" },
  { value: "ppg", label: "Sort: points per game" },
  { value: "g", label: "Sort: goals" },
  { value: "a", label: "Sort: assists" },
  { value: "gb", label: "Sort: ground balls" },
  { value: "shp", label: "Sort: shooting %" },
  { value: "fop", label: "Sort: faceoff %" },
  { value: "svp", label: "Sort: save %" },
  { value: "gp", label: "Sort: games" },
  { value: "name", label: "Sort: name" },
];

type SortKey =
  | "name" | "position" | "team" | "classYear" | "gp" | "g" | "a" | "pts" | "gb" | "ppg"
  | "shp" | "fop" | "svp";

export default function Players() {
  const route = useRoute();
  const { has, toggle } = useCompare();
  const [q, setQ] = useState(route.query.get("q") ?? "");
  const [pos, setPos] = useState<string[]>(() => {
    const p = route.query.get("pos");
    return p ? p.split(",") : [];
  });
  const [league, setLeague] = useState(route.query.get("league") ?? "all");
  const [year, setYear] = useState(route.query.get("year") ?? "all");
  const [state, setState] = useState(route.query.get("state") ?? "all");
  const [minGp, setMinGp] = useState(route.query.get("gp") ?? "");
  const [hs, setHs] = useState(route.query.get("hs") ?? "");
  const [sort, setSort] = useState<SortKey>("pts");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [view, setView] = useState<"table" | "cards">("table");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = data.players
      .filter((p) => (pos.length ? pos.includes(p.position) : true))
      .filter((p) => (league === "all" ? true : p.leagueId === league))
      .filter((p) => (year === "all" ? true : p.classYear === Number(year)))
      .filter((p) => (state === "all" ? true : p.birthplace.state === state))
      .filter((p) => (hs.trim() ? p.highSchool.toLowerCase().includes(hs.trim().toLowerCase()) : true))
      .filter((p) => (minGp ? currentSeason(p).gp >= Number(minGp) : true))
      .filter((p) =>
        needle
          ? p.name.toLowerCase().includes(needle) ||
            (teamOf(p)?.name ?? "").toLowerCase().includes(needle) ||
            p.highSchool.toLowerCase().includes(needle)
          : true
      )
      .map((p) => {
        const s = currentSeason(p);
        const c = careerTotals(p);
        return { p, s, c };
      });

    const val = (r: (typeof list)[number]) => {
      switch (sort) {
        case "name": return r.p.name;
        case "position": return r.p.position;
        case "team": return teamById.get(r.p.teamId)?.name ?? "";
        case "classYear": return r.p.classYear ?? 0;
        case "gp": return r.s.gp;
        case "g": return r.s.g;
        case "a": return r.s.a;
        case "pts": return r.s.pts ?? 0;
        case "gb": return r.s.gb;
        case "ppg": return r.c.ppg;
        case "shp": return r.s.sh ? (r.s.g / r.s.sh) * 100 : 0;
        case "fop": return r.s.foA ? (r.s.foW / r.s.foA) * 100 : 0;
        case "svp": return r.s.sv + r.s.ga ? (r.s.sv / (r.s.sv + r.s.ga)) * 100 : 0;
      }
    };
    list.sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "string" && typeof bv === "string") {
        return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return dir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
    return list;
  }, [q, pos, league, year, state, hs, minGp, sort, dir]);

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (pos.length) params.set("pos", pos.join(","));
    if (league !== "all") params.set("league", league);
    if (year !== "all") params.set("year", year);
    if (state !== "all") params.set("state", state);
    if (hs.trim()) params.set("hs", hs.trim());
    if (minGp) params.set("gp", minGp);
    const qs = params.toString();
    window.history.replaceState(null, "", `#/players${qs ? `?${qs}` : ""}`);
  }, [q, pos, league, year, state, hs, minGp]);

  const toggleSort = (k: SortKey) => {
    if (sort === k) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(k);
      setDir(k === "name" || k === "team" || k === "position" ? "asc" : "desc");
    }
  };

  const activeFilters =
    pos.length +
    (league !== "all" ? 1 : 0) +
    (year !== "all" ? 1 : 0) +
    (state !== "all" ? 1 : 0) +
    (hs.trim() ? 1 : 0) +
    (minGp ? 1 : 0);

  const th = (k: SortKey, label: string, cls = "") => (
    <th className={`${cls} ${sort === k ? "is-sorted" : ""}`} onClick={() => toggleSort(k)}>
      {label}
      <span className="sort-caret">{sort === k ? (dir === "desc" ? "↓" : "↑") : ""}</span>
    </th>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Database</div>
          <h1>Players</h1>
          <p className="muted">
            {rows.length.toLocaleString()} of {data.players.length.toLocaleString()} players ·{" "}
            {Math.min(...data.players.flatMap((p) => p.seasons.map((s) => Number(s.season))))}–
            {Math.max(...data.players.flatMap((p) => p.seasons.map((s) => Number(s.season))))} seasons
          </p>
        </div>
        <Segmented
          ariaLabel="View"
          options={[
            { value: "table", label: "Table" },
            { value: "cards", label: "Cards" },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[210px] flex-1 sm:max-w-[280px]">
          <svg
            viewBox="0 0 20 20"
            width="15"
            height="15"
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12.8 12.8L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, team or high school"
            aria-label="Search players"
            className="h-8 rounded-full pl-8 pr-7 text-[12.5px]"
          />
          {q ? (
            <button
              className="absolute right-2 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
              onClick={() => setQ("")}
              aria-label="Clear"
            >
              ×
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {POSITIONS.map((p) => {
            const on = pos.includes(p);
            return (
              <Button
                key={p}
                size="sm"
                variant={on ? "default" : "outline"}
                onClick={() => setPos((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))}
                className="h-8 min-w-8 rounded-full px-2 text-[12px]"
              >
                {p}
              </Button>
            );
          })}
        </div>

        <FilterSelect
          value={league}
          onChange={setLeague}
          ariaLabel="League"
          options={[
            { value: "all", label: "All leagues" },
            ...data.leagues.map((l) => ({ value: l.id, label: l.name })),
          ]}
        />

        <FilterSelect
          value={year}
          onChange={setYear}
          ariaLabel="Class year"
          options={[
            { value: "all", label: "All classes" },
            ...classYears().map((y) => ({ value: String(y), label: String(y) })),
          ]}
        />

        <FilterSelect
          value={state}
          onChange={setState}
          ariaLabel="State"
          options={[
            { value: "all", label: "All regions" },
            ...statesList().map((s) => ({ value: s, label: s })),
          ]}
        />

        <FilterSelect
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          ariaLabel="Sort by"
          className="min-w-[168px]"
          options={SORTS}
        />

        <Input
          value={hs}
          onChange={(e) => setHs(e.target.value)}
          placeholder="High school"
          aria-label="High school"
          className="h-8 w-[148px] rounded-full text-[12.5px]"
        />

        <Input
          value={minGp}
          onChange={(e) => setMinGp(e.target.value.replace(/\D/g, ""))}
          placeholder="Min GP"
          aria-label="Minimum games played"
          inputMode="numeric"
          className="h-8 w-[92px] rounded-full text-[12.5px]"
        />

        {activeFilters > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full text-[12.5px]"
            onClick={() => {
              setPos([]);
              setLeague("all");
              setYear("all");
              setState("all");
              setHs("");
              setMinGp("");
            }}
          >
            Reset {activeFilters}
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Empty title="No players match" body="Try clearing a filter or searching a different name." />
      ) : view === "table" ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {th("name", "Player")}
                {th("position", "Pos", "c")}
                {th("team", "Team")}
                <th>League</th>
                {th("classYear", "Class", "c")}
                {th("gp", "GP", "r")}
                {th("g", "G", "r")}
                {th("a", "AST", "r")}
                {th("pts", "PTS", "r")}
                {th("gb", "GB", "r")}
                {th("ppg", "PTS/G", "r")}
                <th className="r" aria-label="Compare" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 150).map(({ p, s }) => {
                const team = teamById.get(p.teamId);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/player/${p.slug}`} className="cell-player">
                        <PlayerAvatar player={p} size={30} />
                        <span>
                          <span className="cell-name">{p.name}</span>
                          <span className="cell-sub">{p.birthplace.city}, {p.birthplace.state}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="c"><PositionBadge pos={p.position} /></td>
                    <td>
                      <Link to={`/team/${team?.slug}`} className="team-link">
                        <span className="team-dot" style={{ background: team?.colors[0] }} />
                        {team?.shortName}
                      </Link>
                    </td>
                    <td className="muted small">{leagueById.get(p.leagueId)?.short}</td>
                    <td className="c muted">{p.classYear ?? "—"}</td>
                    <td className="r num">{s.gp}</td>
                    <td className="r num">{s.g}</td>
                    <td className="r num">{s.a}</td>
                    <td className="r num strong">{s.pts}</td>
                    <td className="r num">{s.gb}</td>
                    <td className="r num">{(s.gp ? ((s.pts ?? 0) / s.gp) : 0).toFixed(2)}</td>
                    <td className="r">
                      <button
                        className={`cmp-btn ${has(p.id) ? "is-on" : ""}`}
                        onClick={() => toggle(p.id)}
                        aria-label={`Compare ${p.name}`}
                        title="Add to comparison"
                      >
                        +
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 150 ? (
            <div className="table-note">Showing 150 of {rows.length}. Narrow the filters to see more.</div>
          ) : null}
        </div>
      ) : (
        <div className="cards-grid">
          {rows.slice(0, 48).map(({ p }) => (
            <Link key={p.id} to={`/player/${p.slug}`} className="mini-card">
              <PlayerAvatar player={p} size={46} />
              <div>
                <div className="cell-name">{p.name}</div>
                <div className="cell-sub">
                  {teamById.get(p.teamId)?.shortName} · {p.positionName}
                </div>
              </div>
              <div className="mini-card-pts num">{currentSeason(p).pts ?? 0}<span>PTS</span></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
