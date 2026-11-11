import React, { useMemo, useState } from "react";
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
  const featuredLeagues = useMemo(
    () => data.leagues.filter((l) => data.players.some((p) => p.leagueId === l.id)).slice(0, 4),
    []
  );
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
              Real stat lines from NCAA Division I and the Premier Lacrosse League, 2021–2026.
              Career histories, position-aware metrics, and side-by-side comparison.
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
            </div>
          </div>

          {featured[0] ? (
            <div className="hero-visual reveal" aria-hidden="true">
              <HeroCard player={featured[0]} />
              <div className="hv-mini">
                <div className="hv-mini-head">
                  <span>D1 scoring leaders</span>
                  <span className="num muted">PTS</span>
                </div>
                {leaderboard("ncaa-d1", "pts", 3).map((r, i) => (
                  <div className="hv-mini-row" key={r.player.id}>
                    <span className="num muted">{i + 1}</span>
                    <span className="hv-mini-name">{r.player.name}</span>
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
        <div className="cards-row">
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
                <span className="feature-name">{p.name}</span>
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
          <div className="hv-name">{p.name}</div>
          <div className="hv-team">{team?.shortName} · {p.positionName}</div>
        </div>
      </div>
      <div className="hv-tags">
        <span className="tag tag-accent">
          {p.rankings[0] ? `${p.rankings[0].source} #${p.rankings[0].rank}` : `${p.positionName} · ${team?.conference ?? leagueById.get(p.leagueId)?.short ?? ""}`}
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
        <div><span className="hv-num num">{s.gb}</span><span className="hv-lbl">GB</span></div>
      </div>
      <Sparkline
        values={seasons.map((x) => x.pts ?? 0)}
        labels={seasons.map((x) => x.season)}
        width={330}
        height={104}
        showValues={false}
      />
      <div className="hv-foot">
        <span>Points by season</span>
        <span className="num">{s.season} · {s.gp} GP</span>
      </div>
    </div>
  );
}
