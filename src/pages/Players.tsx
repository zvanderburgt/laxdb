import React, { useMemo, useRef, useState } from "react";
import { Link, navigate, useRoute, useCompare } from "../lib/app";
import { useFlipRows } from "../lib/motion";
import {
  data,
  teamById,
  leagueById,
  classYears,
  careerTotals,
  currentSeason,
  statesList,
  teamOf,
  positionLabel,
  positionOrder,
  playerMatchesQuery,
  searchKey,
  searchTokens,
  SEASON_RANGE,
} from "../lib/data";
import { Avatar, BlockList, Empty, PositionBadge, Provenance, Segmented, PlayerAvatar, Skeleton, SkeletonRows, Term } from "../components/ui";
import { fetchPlayerList, listMode, playerFromRow, seasonFromRow, type PlayerListResult } from "../lib/list";

/** In list mode the row carries its club; the dataset's team map is empty there. */
const clubOf = (p: { teamId?: string; teamName?: string }) =>
  (p as { teamName?: string }).teamName || teamById.get(p.teamId ?? "")?.name || "";

function clubFor(p: { teamId?: string; teamSlug?: string; teamShort?: string; teamColor?: string }) {
  const team = teamById.get(p.teamId ?? "");
  return {
    slug: p.teamSlug || team?.slug || "",
    shortName: p.teamShort || team?.shortName || "",
    color: p.teamColor || team?.colors?.[0] || "",
  };
}

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
  // a 12-column table is unusable at phone width; start on cards there
  const [view, setView] = useState<"table" | "cards">(() =>
    typeof window !== "undefined" && window.innerWidth < 700 ? "cards" : "table",
  );

  // list mode: the database answers the page, filters and sort included (src/lib/list.ts)
  const [remote, setRemote] = useState<PlayerListResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // the first answer is a blank table with no count, so it needs a skeleton of its own; every later
  // answer keeps the current rows on screen and only marks them busy
  const [loading, setLoading] = useState(false);
  // bumped by Try again, so the retry re-runs exactly the request that failed
  const [attempt, setAttempt] = useState(0);

  React.useEffect(() => {
    if (!listMode()) return;
    const ctl = new AbortController();
    setLoading(true);
    // one request per settled interaction, not per keystroke
    const t = setTimeout(() => {
      fetchPlayerList(
        { q, pos: pos.join(","), league, year, state, hs, gp: minGp, sort, dir },
        ctl.signal,
      )
        .then((r) => {
          setRemote(r);
          setLoadError(null);
        })
        .catch((err) => {
          if (ctl.signal.aborted) return;
          // No redirect and no blank table: the failure is a state of this page, with its own retry
          setLoadError(String(err instanceof Error ? err.message : err));
        })
        .finally(() => {
          if (!ctl.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, pos, league, year, state, hs, minGp, sort, dir, attempt]);

  /** The first answer has not landed: there is nothing to draw yet, only a skeleton. */
  const pending = listMode() && remote === null && !loadError;
  /** A later answer is in flight: the rows on screen are the previous answer, so keep them. */
  const refreshing = listMode() && loading && remote !== null;

  // only the positions this scope actually holds: a box league offers Forward /
  // Transition / Defense / Runner, a college league keeps Attack / Midfield / …
  const posOptions = useMemo(() => {
    if (listMode()) {
      const seen = new Set(remote?.facets.positions ?? []);
      const opts: string[] = positionOrder.filter((c) => seen.has(c));
      for (const c of pos) if (!opts.includes(c)) opts.push(c);
      return opts;
    }
    const seen = new Set<string>();
    for (const p of data.players) {
      if (league !== "all" && p.leagueId !== league) continue;
      if (p.position) seen.add(p.position);
    }
    const opts: string[] = positionOrder.filter((c) => seen.has(c));
    for (const c of pos) if (!opts.includes(c)) opts.push(c);
    return opts;
  }, [league, pos, remote]);

  const rows = useMemo(() => {
    if (listMode()) {
      // already filtered, sorted and cut to the page by the server
      return (remote?.rows ?? []).map((r) => ({
        p: playerFromRow(r),
        s: seasonFromRow(r),
        c: { ppg: r.ppg ?? 0 },
      }));
    }
    const needle = searchTokens(q);
    const list = data.players
      .filter((p) => (pos.length ? pos.includes(p.position) : true))
      .filter((p) => (league === "all" ? true : p.leagueId === league))
      .filter((p) => (year === "all" ? true : p.classYear === Number(year)))
      .filter((p) => (state === "all" ? true : p.birthplace.state === state))
      .filter((p) => (hs.trim() ? searchKey(p.highSchool).includes(searchKey(hs)) : true))
      .filter((p) => (minGp ? currentSeason(p).gp >= Number(minGp) : true))
      // punctuation-insensitive and token-based: "oneill" finds O'Neill, and the
      // same helper backs the ⌘K palette so the two cannot disagree
      .filter((p) => playerMatchesQuery(p, needle))
      .map((p) => {
        const s = currentSeason(p);
        const c = careerTotals(p);
        return { p, s, c };
      });

    const val = (r: (typeof list)[number]) => {
      switch (sort) {
        case "name": return r.p.name;
        case "position": return r.p.position;
        case "team": return clubOf(r.p);
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
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      // ties resolve by slug so the database's page and this one order them the same way
      return (dir === "asc" ? cmp : -cmp) || a.p.slug.localeCompare(b.p.slug);
    });
    return list;
  }, [q, pos, league, year, state, hs, minGp, sort, dir, remote]);

  /* every row on this page is keyed, so a filter or a sort re-orders in place
     instead of the list cutting to a new arrangement */
  const body = useRef<HTMLTableSectionElement>(null);
  const cards = useRef<HTMLDivElement>(null);
  const motionKey = `${q}|${pos.join(",")}|${league}|${year}|${state}|${minGp}|${hs}|${sort}|${dir}|${rows.length}`;
  useFlipRows(body, [motionKey], { max: 40 });
  useFlipRows(cards, [motionKey], { max: 40 });

  // the page used to draw all 150 returned rows at once — 9,085 DOM nodes and a 0.13 layout shift
  // on the route most visitors enter from search. Fifty rows a page keeps the answer intact (the
  // count and the filters still cover the whole match) while a third of the tree is ever mounted.
  const PAGE = 50;
  const [page, setPage] = useState(0);
  React.useEffect(() => {
    setPage(0);
  }, [q, pos, league, year, state, minGp, hs, sort, dir]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const from = rows.length ? safePage * PAGE + 1 : 0;
  const to = Math.min(rows.length, (safePage + 1) * PAGE);

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
    navigate(`/players${qs ? `?${qs}` : ""}`, { replace: true });
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

  const th = (k: SortKey, label: React.ReactNode, cls = "") => (
    <th
      className={`sortable ${cls} ${sort === k ? "is-sorted" : ""}`}
      aria-sort={sort === k ? (dir === "desc" ? "descending" : "ascending") : "none"}
      tabIndex={0}
      onClick={() => toggleSort(k)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleSort(k);
        }
      }}
    >
      {label}
      <span className="sort-caret" aria-hidden="true">
        {sort === k ? (dir === "desc" ? "↓" : "↑") : ""}
      </span>
    </th>
  );

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <div className="eyebrow">Database</div>
          <h1>Players</h1>
          <p className="muted" aria-busy={pending || undefined}>
            {pending ? (
              <Skeleton w={300} h={12} />
            ) : (
              <>
                {(remote?.total ?? rows.length).toLocaleString()} of{" "}
                {(remote?.universe ?? data.players.length).toLocaleString()} players ·{" "}
                {(remote?.range ?? SEASON_RANGE)[0]}–{(remote?.range ?? SEASON_RANGE)[1]} seasons
                <Provenance feed="school and league statistics feeds" />
              </>
            )}
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

      {loadError && rows.length > 0 ? (
        <p className="muted small list-error-note" data-list-error role="status">
          Couldn't refresh this table — showing the previous answer.{" "}
          <button className="link-btn" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      ) : null}

      <div className="filterbar">
        <div className="filter-search">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12.8 12.8L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, team or high school"
            aria-label="Search players"
          />
          {q ? <button className="clear-x" onClick={() => setQ("")} aria-label="Clear">×</button> : null}
        </div>

        <div className="pos-pills">
          {/* nine placeholder pills while the facets are in flight: an empty pill row is 84px
              shorter than a full one, and that is the 0.4 layout shift at 720px */}
          {pending
            ? Array.from({ length: 9 }).map((_, i) => <span key={i} className="pill pill-skel" aria-hidden="true" />)
            : posOptions.map((p) => (
            <button
              key={p}
              className={`pill ${pos.includes(p) ? "is-on" : ""}`}
              title={positionLabel[p] ?? p}
              aria-label={positionLabel[p] ?? p}
              onClick={() => setPos((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))}
            >
              {p}
            </button>
          ))}
        </div>

        <select value={league} onChange={(e) => setLeague(e.target.value)} aria-label="League">
          <option value="all">All leagues</option>
          {(remote?.leagues ?? data.leagues).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Class year">
          <option value="all">All classes</option>
          {(remote?.facets.years ?? classYears()).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
          <option value="all">All regions</option>
          {(remote?.facets.states ?? statesList()).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort by"
        >
          <option value="pts">Sort: points</option>
          <option value="ppg">Sort: points per game</option>
          <option value="g">Sort: goals</option>
          <option value="a">Sort: assists</option>
          <option value="gb">Sort: ground balls</option>
          <option value="shp">Sort: shooting %</option>
          <option value="fop">Sort: faceoff %</option>
          <option value="svp">Sort: save %</option>
          <option value="gp">Sort: games</option>
          <option value="name">Sort: name</option>
        </select>

        <input
          className="filter-input"
          value={hs}
          onChange={(e) => setHs(e.target.value)}
          placeholder="High school"
          aria-label="High school"
        />

        <input
          className="filter-input narrow"
          value={minGp}
          onChange={(e) => setMinGp(e.target.value.replace(/\D/g, ""))}
          placeholder="Min GP"
          aria-label="Minimum games played"
          inputMode="numeric"
        />

        {activeFilters > 0 ? (
          <button
            className="btn btn-ghost btn-sm"
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
          </button>
        ) : null}
      </div>

      {loadError && rows.length === 0 ? (
        <div className="card players-error" data-list-error role="alert">
          <h3>The players table didn't load</h3>
          <p className="muted small">
            Filtering, sorting and paging all run on the database, so the table needs that request to
            answer. Retrying sends it again; the rest of the site still works.
          </p>
          <div className="load-error-actions">
            <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
            <a className="btn btn-ghost" href="/">
              Back home
            </a>
          </div>
        </div>
      ) : pending ? (
        <div className="card players-loading" aria-busy="true">
          <span className="sr-only" role="status">Loading the player table</span>
          {/* a page's worth of placeholder rows: the answer is fifty rows, and a shorter skeleton is
              what pushed the footer down when the data landed (CLS 0.13 → 0.054 at 1440) */}
          <SkeletonRows rows={PAGE} cols={6} />
        </div>
      ) : rows.length === 0 ? (
        <Empty title="No players match" body="Try clearing a filter or searching a different name." />
      ) : view === "table" ? (
        <div className="players-board" aria-busy={refreshing || undefined}>
        <BlockList
          motionKey={motionKey}
          rows={pageRows.map(({ p, s }) => {
            const club = clubFor(p as any);
            return {
              key: p.id,
              primary: (
                <Link to={`/player/${p.slug}`} className="cell-player">
                  <PlayerAvatar player={p} size={30} />
                  <span>
                    <span className="cell-name">{p.name}</span>
                    {[p.birthplace.city, p.birthplace.state].filter(Boolean).length ? (
                      <span className="cell-sub">
                        {[p.birthplace.city, p.birthplace.state].filter(Boolean).join(", ")}
                      </span>
                    ) : null}
                  </span>
                </Link>
              ),
              meta: (
                <Link to={`/team/${club.slug}`} className="team-link">
                  <span className="team-dot" style={{ background: club.color }} />
                  {club.shortName}
                </Link>
              ),
              action: (
                <button
                  className={`cmp-btn ${has(p.id) ? "is-on" : ""}`}
                  onClick={() => toggle(p.id)}
                  aria-label={`Compare ${p.name}`}
                  title="Add to comparison"
                >
                  +
                </button>
              ),
              cells: [
                { label: <Term k="pos" />, value: p.position ?? "—" },
                { label: "GP", value: s.gp },
                { label: "G", value: s.g },
                { label: "AST", value: s.a },
                { label: "PTS", value: s.pts, strong: true },
                { label: "GB", value: s.gb },
                { label: "PTS/G", value: (s.gp ? ((s.pts ?? 0) / s.gp) : 0).toFixed(2) },
              ],
            };
          })}
        />
        <div className="table-wrap hide-sm">
          <table className="data-table">
            <thead>
              <tr>
                {th("name", "Player")}
                {th("position", <Term k="pos" />, "c")}
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
            <tbody ref={body}>
              {pageRows.map(({ p, s }) => {
                const club = clubFor(p as any);
                return (
                  <tr key={p.id} data-k={p.id}>
                    <td>
                      <Link to={`/player/${p.slug}`} className="cell-player">
                        <PlayerAvatar player={p} size={30} />
                        <span>
                          <span className="cell-name">{p.name}</span>
                          {[p.birthplace.city, p.birthplace.state].filter(Boolean).length ? (
                            <span className="cell-sub">
                              {[p.birthplace.city, p.birthplace.state].filter(Boolean).join(", ")}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </td>
                    <td className="c"><PositionBadge pos={p.position} /></td>
                    <td>
                      <Link to={`/team/${club.slug}`} className="team-link">
                        <span className="team-dot" style={{ background: club.color }} />
                        <span className="team-name">{club.shortName}</span>
                      </Link>
                    </td>
                    <td className="muted small">{(p as { leagueShort?: string }).leagueShort || leagueById.get(p.leagueId)?.short}</td>
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
        </div>
        </div>
      ) : (
        <div className="cards-grid" ref={cards}>
          {pageRows.map(({ p }) => (
            <Link key={p.id} to={`/player/${p.slug}`} className="mini-card" data-k={`c-${p.id}`}>
              <PlayerAvatar player={p} size={46} />
              <div>
                <div className="cell-name">{p.name}</div>
                <div className="cell-sub">
                  {clubOf(p)} · {p.positionName}
                </div>
              </div>
              <div className="mini-card-pts num">{currentSeason(p).pts ?? 0}<span>PTS</span></div>
            </Link>
          ))}
        </div>
      )}

      {rows.length > 0 ? (
        <nav className="pager" aria-label="Player list pages">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setPage((n) => Math.max(0, n - 1))}
            disabled={safePage === 0}
          >
            Previous
          </button>
          <span className="muted small" aria-live="polite">
            Showing {from}–{to} of {rows.length}
            {rows.length < (remote?.total ?? rows.length) ? " (narrow the filters to see more)" : ""}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setPage((n) => Math.min(pageCount - 1, n + 1))}
            disabled={safePage >= pageCount - 1}
          >
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}
