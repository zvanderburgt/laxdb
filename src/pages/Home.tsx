import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, navigate } from "../lib/app";
import {
  careerTotals,
  currentSeason,
  data,
  leaderboard,
  leagueById,
  teamById,
  PLAYER_COUNT,
  TEAM_COUNT,
  SEASON_COUNT,
  teamOf,
} from "../lib/data";
import { Avatar, PlayerCard, PositionBadge, SectionHead, Segmented, Sparkline, PlayerAvatar } from "../components/ui";
import type { Player } from "../lib/types";

const STATS = [
  { value: "pts", label: "Points" },
  { value: "g", label: "Goals" },
  { value: "a", label: "Assists" },
  { value: "gb", label: "Ground balls" },
] as const;

export default function Home() {
  const featuredLeagues = useMemo(() => {
    const live = data.leagues.filter((l) => data.players.some((p) => p.leagueId === l.id));
    const preferred = ["ncaa-d1", "pll", "nf-nll", "nf-ojcll"];
    const picked = preferred.map((id) => live.find((l) => l.id === id)).filter(Boolean) as typeof live;
    return [...picked, ...live.filter((l) => !preferred.includes(l.id))].slice(0, 4);
  }, []);
  const [league, setLeague] = useState<string>(featuredLeagues[0]?.id ?? "ncaa-d1");
  const [stat, setStat] = useState<(typeof STATS)[number]["value"]>("pts");
  const [q, setQ] = useState("");

  const rows = useMemo(() => leaderboard(league, stat, 6), [league, stat]);

  const featured = useMemo(
    () =>
      data.players
        .filter((p) => (p.leagueId === "ncaa-d1" || p.leagueId === "pll") && p.position === "A")
        .sort((a, b) => careerTotals(b).pts - careerTotals(a).pts)
        .slice(0, 6),
    []
  );

  // Hero card: the leading scorer of each competition we cover, so the rotation
  // shows one player from field, pro field and box rather than six attackers.
  const spotlight = useMemo(() => {
    // one or two headline names per competition, weighted to the leagues the site
    // covers deepest — a Junior C scorer is not a "notable player" for the hero
    const plan: [string, number][] = [
      ["ncaa-d1", 2],
      ["pll", 2],
      ["nf-nll", 1],
      ["mcla", 1],
    ];
    const picks: Player[] = [];
    for (const [leagueId, want] of plan) {
      // peak season, not career: several older D1 seasons carry no stat rows, so a
      // career sum ranks a recent sophomore above a four-year starter
      const peak = (p: Player) => p.seasons.reduce((best, s) => Math.max(best, s.pts ?? 0), 0);
      const pool = data.players
        .filter((p) => p.leagueId === leagueId && p.seasons.reduce((t, s) => t + (s.gp ?? 0), 0) >= 12)
        .sort((a, b) => peak(b) - peak(a))
        .filter((p) => peak(p) > 0)
        .slice(0, 8);
      if (!pool.length) continue;
      const withPhoto = pool.filter((p) => p.photo);
      const chosen = (withPhoto.length >= want ? withPhoto : pool).slice(0, want);
      picks.push(...chosen);
    }
    return picks;
  }, []);

  const [spot, setSpot] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  // manual moves restart the autoplay clock instead of waiting out the old interval
  const [tick, setTick] = useState(0);
  const count = spotlight.length;

  useEffect(() => {
    if (paused || dragging || count < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setDir(1);
      setSpot((i) => (i + 1) % count);
    }, 6500);
    return () => window.clearInterval(id);
  }, [paused, dragging, count, tick]);

  const go = useCallback(
    (delta: number) => {
      if (count < 2) return;
      setDir(delta > 0 ? 1 : -1);
      setSpot((i) => (i + delta + count) % count);
      setTick((t) => t + 1);
    },
    [count]
  );

  // one pointer drag = one slide. touch-action: pan-y on the wrapper lets the page
  // scroll vertically while horizontal drags arrive here.
  const drag = useRef<{ x: number; y: number; id: number; live: boolean } | null>(null);
  const swallowClick = useRef(0);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, live: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.live && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      d.live = true;
      setDragging(true);
      // capture so a fast flick that leaves the card still lands as one gesture
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic or already-released pointer cannot be captured; the
           drag still works while the pointer stays over the card */
      }
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.live) return;
    setDragging(false);
    // the card holds links: a drag that ends over one must not navigate
    swallowClick.current = performance.now() + 350;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.2) go(dx < 0 ? 1 : -1);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (performance.now() < swallowClick.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const current = spotlight[spot % Math.max(spotlight.length, 1)];

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-copy">
            <div className="eyebrow reveal">The lacrosse player database</div>
            <h1 className="reveal">
              {PLAYER_COUNT.toLocaleString()} players. <span className="shine">One profile.</span>
            </h1>
            <p className="hero-sub reveal">
              Field and box, from NCAA Division I, the MCLA and the PLL down through 16 Canadian
              box leagues — Junior A, Junior B, Junior C, Senior and the NLL. Career histories,
              position-aware metrics, side-by-side comparison.
            </p>
            <form
              className="hero-search reveal"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/players${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
              }}
            >
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12.8 12.8L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search a player, team or high school"
                aria-label="Search players"
              />
              <button type="submit" className="btn btn-primary btn-sm">Search</button>
            </form>
            <div className="chips reveal">
              <Link className="chip" to="/players?pos=A&league=ncaa-d1">D1 attackmen</Link>
              <Link className="chip" to="/players?pos=G">Goalie leaders</Link>
              <Link className="chip" to="/players?pos=FO">Faceoff specialists</Link>
              <Link className="chip" to="/players?league=pll">PLL players</Link>
              <Link className="chip" to="/players?league=nf-ojcll">Junior C players</Link>
              <Link className="chip" to="/players?league=nf-nll">NLL players</Link>
            </div>
          </div>

          {current ? (
            <div className="hero-visual reveal">
              <div
                className={`hv-rotate${dir < 0 ? " dir-prev" : ""}${dragging ? " is-dragging" : ""}`}
                role="group"
                aria-roledescription="carousel"
                aria-label={`Featured players, slide ${spot + 1} of ${count}`}
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClickCapture={onClickCapture}
                onDragStart={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") {
                    e.preventDefault();
                    go(1);
                  } else if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    go(-1);
                  }
                }}
              >
                <HeroCard key={current.id} player={current} />
                <div className="hv-nav">
                  <button
                    type="button"
                    className="hv-arrow"
                    aria-label="Previous featured player"
                    onClick={() => go(-1)}
                  >
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                      <path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <div className="hv-dots">
                    {spotlight.map((p, i) => (
                      <button
                        type="button"
                        key={p.id}
                        className={"hv-dot" + (i === spot ? " on" : "")}
                        aria-label={`Show ${p.name}`}
                        aria-current={i === spot ? "true" : undefined}
                        onClick={() => go(i - spot)}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="hv-arrow"
                    aria-label="Next featured player"
                    onClick={() => go(1)}
                  >
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                      <path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="hv-mini">
                <div className="hv-mini-head">
                  <span>D1 scoring leaders</span>
                  <span className="num muted">PTS</span>
                </div>
                {leaderboard("ncaa-d1", "pts", 3).map((r, i) => (
                  <div className="hv-mini-row" key={r.player.id}>
                    <span className="num muted">{i + 1}</span>
                    <span className="hv-mini-name">
                      <Link to={`/player/${r.player.slug}`} className="cell-link">
                        {r.player.name}
                      </Link>
                    </span>
                    <span className="hv-mini-team muted">
                      {(() => {
                        const t = teamById.get(r.player.teamId);
                        return t ? (
                          <Link to={`/team/${t.slug}`} className="cell-link">
                            {t.shortName}
                          </Link>
                        ) : null;
                      })()}
                    </span>
                    <span className="num">{r.season.pts}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="hero-strip">
          {[
            ["Players", PLAYER_COUNT.toLocaleString()],
            ["Teams", TEAM_COUNT.toLocaleString()],
            ["Player-seasons", SEASON_COUNT.toLocaleString()],
            ["Competitions", String(data.leagues.length)],
          ].map(([label, value]) => (
            <div key={label} className="hero-stat">
              <span className="hero-stat-value">{value}</span>
              <span className="hero-stat-label">{label}</span>
            </div>
          ))}
        </div>
        <div className="hero-coverage">
          Coverage:{" "}
          {data.leagues
            .filter((l) => data.players.some((p) => p.leagueId === l.id))
            .map((l) => `${data.teams.filter((t) => t.leagueId === l.id).length} ${l.short}`)
            .join(" · ")}{" "}
          · seasons 2021–2026 · headshots for pro players
        </div>
      </section>

      <section className="section">
        <SectionHead
          eyebrow={`${leagueById.get(league)?.short ?? ""} · ${data.meta.season} regular season`}
          title="Who's producing"
          action={
            <div className="head-controls">
              <Segmented
                size="sm"
                ariaLabel="League"
                options={featuredLeagues.map((l) => ({ value: l.id, label: l.short }))}
                value={league}
                onChange={setLeague}
              />
              <Segmented
                size="sm"
                ariaLabel="Stat"
                options={STATS.map((s) => ({ value: s.value, label: s.label }))}
                value={stat}
                onChange={(v) => setStat(v)}
              />
            </div>
          }
        />

        <div className="leader-grid">
          <div className="card pad-0 leader-table">
            {rows.map((r, i) => {
              const team = teamOf(r.player);
              return (
                <Link key={r.player.id} to={`/player/${r.player.slug}`} className="leader-row">
                  <span className="leader-rank">{String(i + 1).padStart(2, "0")}</span>
                  <PlayerAvatar player={r.player} size={38} />
                  <span className="leader-id">
                    <span className="leader-name">{r.player.name}</span>
                    <span className="leader-meta">
                      {team?.shortName} <span className="dot">·</span> {r.player.positionName}
                      {r.player.classYear ? ` · ’${String(r.player.classYear).slice(2)}` : ""}
                    </span>
                  </span>
                  <span className="leader-val num">
                    {stat === "pts" || stat === "g" || stat === "a" || stat === "gb"
                      ? (r.season[stat] as number)
                      : r.value.toFixed(3)}
                  </span>
                  <span className="leader-gp num">{r.season.gp} GP</span>
                  <span className="leader-bar">
                    <span
                      style={{
                        width: `${Math.max(6, (r.value / (rows[0]?.value || 1)) * 100)}%`,
                        background: `linear-gradient(90deg, ${team?.colors[0]}, ${team?.colors[1]})`,
                      }}
                    />
                  </span>
                </Link>
              );
            })}
            <Link to={`/league/${league}`} className="leader-more">
              Full {leagueById.get(league)!.name} leaderboard →
            </Link>
          </div>

          <div className="card pad leader-side">
            <div className="eyebrow">League snapshot</div>
            <h3>{leagueById.get(league)?.name ?? "—"}</h3>
            <p className="muted">
              {leagueById.get(league)?.level} · {leagueById.get(league)?.type === "box" ? "Box lacrosse" : "Field lacrosse"}
            </p>
            <div className="mini-stats">
              <div>
                <span className="num">{data.players.filter((p) => p.leagueId === league).length}</span>
                <span>players tracked</span>
              </div>
              <div>
                <span className="num">{data.teams.filter((t) => t.leagueId === league).length}</span>
                <span>teams</span>
              </div>
            </div>
            <div className="side-list">
              <div className="side-list-title">Scoring leaders</div>
              {leaderboard(league, "pts", 3).map((r) => (
                <Link key={r.player.id} to={`/player/${r.player.slug}`} className="side-item">
                  <span>{r.player.name}</span>
                  <span className="num">{r.season.pts}</span>
                </Link>
              ))}
            </div>
            <Link className="btn btn-secondary btn-block" to={`/league/${league}`}>
              Explore league
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHead
          eyebrow="Profiles"
          title="Players to know"
          action={<Link className="link-arrow" to="/players">Browse all players →</Link>}
        />
        <div className="pcard-grid">
          {featured.map((p) => (
            <PlayerCard key={p.id} player={p} team={teamById.get(p.teamId)} />
          ))}
        </div>
      </section>

      <section className="section">
        <SectionHead eyebrow="Competitions" title="Every level of the game" />
        <div className="league-grid">
          {data.leagues.map((l) => {
            const teams = data.teams.filter((t) => t.leagueId === l.id);
            return (
              <Link to={`/league/${l.id}`} key={l.id} className="league-card">
                <div className="league-card-top">
                  <span className={`league-pill t${l.tier}`}>{l.short}</span>
                  <span className="league-type">{l.type === "box" ? "Box" : "Field"}</span>
                </div>
                <h3>{l.name}</h3>
                <p className="muted">
                  {teams.length} teams · {data.players.filter((p) => p.leagueId === l.id).length} players
                </p>
                <div className="league-swatches">
                  {teams.slice(0, 7).map((t) => (
                    <span key={t.id} style={{ background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})` }} />
                  ))}
                  {teams.length > 7 ? <span className="swatch-more">+{teams.length - 7}</span> : null}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="feature-band">
          <div className="feature-copy">
            <div className="eyebrow">Built for evaluation</div>
            <h2>From the box score to the scouting report.</h2>
            <p>
              Every profile carries the full picture: season splits by team and league, a game log,
              career milestones, draft and recruiting rankings, and graded scouting notes. Compare
              up to three players side by side.
            </p>
            <div className="feature-actions">
              <Link to="/players" className="btn btn-primary">Browse players</Link>
              <Link to="/compare" className="btn btn-secondary">Open comparison</Link>
            </div>
          </div>
          <div className="feature-visual">
            {data.players.slice(4, 8).map((p) => (
              <div className="feature-row" key={p.id}>
                <PositionBadge pos={p.position} />
                <PlayerAvatar player={p} size={34} />
                <span className="feature-name">
                  <Link to={`/player/${p.slug}`} className="cell-link">
                    {p.name}
                  </Link>
                </span>
                <span className="num muted">{currentSeason(p).pts} PTS</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function careerScore(p: { awards: unknown[]; rankings: { rank: number }[]; draft: unknown }) {
  return p.awards.length * 10 + (p.rankings.length ? 30 - (p.rankings[0].rank ?? 60) / 4 : 0) + (p.draft ? 8 : 0);
}

function HeroCard({ player }: { player: Player }) {
  const p = player;
  const team = teamOf(p);
  const s = currentSeason(p);
  const seasons = p.seasons.slice(-4);
  return (
    <div className="hv-card">
      <div className="hv-top">
        <PlayerAvatar player={p} size={54} radius={16} />
        <div className="hv-id">
          <div className="hv-name">
            <Link to={`/player/${p.slug}`} className="cell-link">
              {p.name}
            </Link>
          </div>
          <div className="hv-team">
            {team ? (
              <Link to={`/team/${team.slug}`} className="cell-link">
                {team.shortName}
              </Link>
            ) : null}
            {` · ${p.positionName}`}
          </div>
        </div>
      </div>
      <div className="hv-tags">
        <span className="tag tag-accent">
          {p.rankings[0]
            ? `${p.rankings[0].source} #${p.rankings[0].rank}`
            : `${p.positionName} · ${
                p.leagueId === "ncaa-d1"
                  ? team?.conference ?? "Division I"
                  : leagueById.get(p.leagueId)?.short ?? ""
              }`}
        </span>
        {p.heightIn > 0 ? (
          <span className="tag">
            {Math.floor(p.heightIn / 12)}'{p.heightIn % 12}"{p.weightLb ? ` · ${p.weightLb} lb` : ""}
          </span>
        ) : null}
        {p.jersey > 0 ? <span className="tag">#{p.jersey}</span> : null}
      </div>
      <div className="hv-stats">
        <div><span className="hv-num num">{s.pts}</span><span className="hv-lbl">PTS</span></div>
        <div><span className="hv-num num">{s.g}</span><span className="hv-lbl">G</span></div>
        <div><span className="hv-num num">{s.a}</span><span className="hv-lbl">A</span></div>
        {s.gb > 0 ? (
          <div><span className="hv-num num">{s.gb}</span><span className="hv-lbl">GB</span></div>
        ) : (s.min ?? 0) > 0 ? (
          <div><span className="hv-num num">{s.min}</span><span className="hv-lbl">PIM</span></div>
        ) : null}
      </div>
      {(() => {
        const bySeason = new Map<string, number>();
        for (const s of p.seasons) bySeason.set(s.season, (bySeason.get(s.season) ?? 0) + (s.pts ?? 0));
        const years = [...bySeason.keys()].sort();
        return (
          <Sparkline
            values={years.map((y) => bySeason.get(y) ?? 0)}
            labels={years}
            width={330}
            height={104}
            showValues={false}
          />
        );
      })()}
      <div className="hv-foot">
        <span>Points by season</span>
        <span className="num">{s.season} · {s.gp} GP</span>
      </div>
    </div>
  );
}
