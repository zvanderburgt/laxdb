import React, { useMemo, useState } from "react";
import { Link, useCompare, useRoute, useTheme } from "../lib/app";
import {
  ageOf,
  allAmericansFor,
  careerTotals,
  currentSeason,
  data,
  fmtDate,
  fmtHeight,
  leagueById,
  teamByName,
  playerBySlug,
  seasonTotals,
  teamById,
  gameSummary,
  teamOf,
  teammatesOf,
  usePlayerGames,
} from "../lib/data";
import type { GameRow, Player, SeasonRow } from "../lib/types";
import { downloadCsv, downloadPlayerCard } from "../lib/export";
import { similarTo } from "../lib/similar";
import { distinctEach, liftForDark } from "../lib/palette";
import { peerRanks } from "../lib/peers";
import { splits } from "../lib/splits";
import { adjustedRate } from "../lib/adjusted";
import { toggleSaved, useRoster } from "../lib/storage";
import {
  Avatar,
  Card,
  Empty,
  GradeBar,
  PositionBadge,
  SeasonLines,
  Segmented,
  Sparkline,
  Stat,
  PlayerAvatar,
  TeamLogo,
} from "../components/ui";

type Tab = "overview" | "stats" | "gamelog" | "awards" | "scouting";

export default function PlayerPage() {
  const route = useRoute();
  const slug = route.path.split("/")[2] ?? "";
  const player = playerBySlug.get(slug);
  if (!player) {
    return (
      <div className="page">
        <Empty title="Player not found" body="That profile may have moved. Search the database instead." />
        <div style={{ textAlign: "center" }}>
          <Link to="/players" className="btn btn-primary">Browse players</Link>
        </div>
      </div>
    );
  }
  return <Profile player={player} />;
}

function Profile({ player }: { player: Player }) {
  const [tab, setTab] = useState<Tab>("overview");
  const { has, toggle } = useCompare();
  const [copied, setCopied] = useState(false);

  const team = teamOf(player);
  const league = leagueById.get(player.leagueId);
  // a competition that publishes no bios leaves the Profile card with three rows and no
  // person in them; say so rather than letting it read as a failed import
  const hasBio = Boolean(
    player.dob || player.heightIn || player.weightLb || player.photo ||
    player.highSchool || player.classYear || (player.birthplace || {}).city,
  );
  const cur = currentSeason(player);
  const career = careerTotals(player);
  // box feeds publish rates instead of raw minutes/saves
  const svPct = cur.sv + cur.ga ? cur.sv / (cur.sv + cur.ga) : (cur.svp || 0);
  const gaaVal = cur.min ? (cur.ga * 60) / cur.min : (cur.gaa || 0);
  const isGoal = player.position === "G";
  const isBox = league?.type === "box";

  const roster = useRoster();
  const saved = roster.some((p) => p.id === player.id);
  const mates = useMemo(() => teammatesOf(player), [player.id]);
  const similar = useMemo(() => similarTo(player, 6), [player.id]);
  const peers = useMemo(() => peerRanks(player), [player.id]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="profile">
      <div
        className="profile-hero"
        style={{
          background: `radial-gradient(120% 140% at 0% 0%, ${team?.colors[0]}1f, transparent 62%), radial-gradient(90% 120% at 100% 0%, ${team?.colors[1]}18, transparent 60%)`,
        }}
      >
        <div className="profile-hero-inner">
          <div className="crumbs">
            <Link to="/players">Players</Link>
            <span>/</span>
            <Link to={`/league/${player.leagueId}`}>{league?.short}</Link>
            <span>/</span>
            <Link to={`/team/${team?.slug}`}>{team?.shortName}</Link>
          </div>
          <div className="profile-head">
            <PlayerAvatar player={player} size={112} radius={30} className="hero-avatar" />
            <div className="profile-id">
              <div className="profile-tags">
                <span className={`tag tag-pos pos-${player.position.toLowerCase()}`}>{player.positionName}</span>
                {player.status !== "Active" ? <span className="tag tag-warn">{player.status}</span> : null}
                {league ? <span className="tag">{league.type === "box" ? "Box lacrosse" : "Field lacrosse"}</span> : null}
                {player.commit ? <span className="tag tag-accent">Committed · {player.commit.college}</span> : null}
              </div>
              <h1>{player.name}</h1>
              <div className="profile-sub">
                <Link to={`/team/${team?.slug}`} className="profile-team">
                  <TeamLogo team={team} size={18} />
                  {team?.name}
                </Link>
                <span className="dot">·</span>
                <Link to={`/league/${player.leagueId}`}>{league?.name}</Link>
                {player.classYear ? (
                  <>
                    <span className="dot">·</span>
                    <span>Class of {player.classYear}</span>
                  </>
                ) : null}
              </div>
              <div className="profile-meta">
                {player.heightIn > 0 ? <span><b>{fmtHeight(player.heightIn)}</b> height</span> : null}
                {player.weightLb > 0 ? <span><b>{player.weightLb} lb</b> weight</span> : null}
                {player.hand ? (
                  <span><b>{player.hand}H</b> {player.hand === "R" ? "right-handed" : "left-handed"}</span>
                ) : null}
                {ageOf(player.dob) ? <span><b>{ageOf(player.dob)}</b> years old</span> : null}
                {player.jersey > 0 ? <span><b>#{player.jersey}</b> jersey</span> : null}
                {player.experience ? <span><b>{player.experience}</b> yrs pro</span> : null}
              </div>
              {!hasBio ? (
                <p className="bio-note hero-bio-note">
                  Statistics only — {league?.short ?? "this competition"} publishes no player bios.
                </p>
              ) : null}
            </div>
            <div className="profile-actions">
              <button
                className={`btn ${has(player.id) ? "btn-secondary" : "btn-primary"}`}
                onClick={() => toggle(player.id)}
              >
                {has(player.id) ? "In comparison ✓" : "Compare"}
              </button>
              <button className="btn btn-secondary" onClick={copy}>
                {copied ? "Link copied" : "Share"}
              </button>
              <button
                className={`btn ${saved ? "btn-secondary is-saved" : "btn-secondary"}`}
                aria-pressed={saved}
                onClick={() => toggleSaved(player.id)}
                title={saved ? "Remove from my roster" : "Save to my roster"}
              >
                {saved ? "★ Saved" : "☆ Save"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => downloadPlayerCard(player, team, league)}
                title="Download a shareable card"
              >
                Card
              </button>
            </div>
          </div>

          <div className="profile-stats">
            <div className="stat-group">
              <div className="stat-group-label">{cur.season} regular season</div>
              <div className="stat-group-grid">
                {isGoal ? (
                  <>
                    <Stat
                      label="Save %"
                      value={svPct ? svPct.toFixed(3).replace(/^0/, "") : "—"}
                      sub={cur.sv ? `${cur.sv} saves` : `${cur.gp} games`}
                      tone="accent"
                    />
                    <Stat label="GAA" value={gaaVal ? gaaVal.toFixed(2) : "—"} sub={cur.min ? `${cur.min} min` : "goals-against avg."} />
                    <Stat
                      label={cur.w + cur.l ? "Record" : "Games"}
                      value={cur.w + cur.l ? `${cur.w}–${cur.l}` : cur.gp}
                      sub={`${cur.gp} games`}
                    />
                    {isBox ? (
                      <Stat label="Career wins" value={career.w ?? 0} sub={`${career.gp} games`} />
                    ) : (
                      <Stat label="Shots faced" value={cur.sv + cur.ga} sub={`${((cur.sv + cur.ga) / Math.max(1, cur.gp)).toFixed(1)} per game`} />
                    )}
                  </>
                ) : (
                  <>
                    <Stat label="Points" value={cur.pts ?? 0} sub={`${cur.g}G · ${cur.a}A`} tone="accent" />
                    <Stat label="Points / game" value={(cur.gp ? ((cur.pts ?? 0) / cur.gp) : 0).toFixed(2)} sub={`${cur.gp} games`} />
                    {isBox ? (
                      <Stat label="Penalty minutes" value={cur.pen} sub={`${(cur.pen / Math.max(1, cur.gp)).toFixed(1)} per game`} />
                    ) : (
                      <Stat label="Ground balls" value={cur.gb} sub={`${(cur.gb / Math.max(1, cur.gp)).toFixed(1)} per game`} />
                    )}
                    {player.position === "FO" ? (
                      <Stat label="Faceoff %" value={cur.foA ? (cur.foW / cur.foA).toFixed(3).replace(/^0/, "") : "—"} sub={`${cur.foW}–${cur.foA}`} />
                    ) : (
                      <Stat label="Caused turnovers" value={cur.ct} sub={`${(cur.ct / Math.max(1, cur.gp)).toFixed(1)} per game`} />
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="stat-group career">
              <div className="stat-group-label">Career</div>
              <div className="stat-group-grid">
                <Stat
                  label={isGoal ? "Saves" : "Points"}
                  value={isGoal ? career.sv : career.pts}
                  sub={isGoal ? `${career.gaa.toFixed(2)} GAA` : `${career.g}G · ${career.a}A`}
                />
                <Stat
                  label={isGoal ? "Save %" : "Games played"}
                  value={isGoal ? (career.svp ? career.svp.toFixed(3).replace(/^0/, "") : "—") : career.gp}
                  sub={isGoal ? "career" : `${player.seasons.length} seasons`}
                />
              </div>
            </div>
          </div>
          <div className="stat-note">
            Career totals cover every season indexed for this player ({player.seasons[0]?.season}–{player.seasons[player.seasons.length - 1]?.season}).
          </div>
        </div>
      </div>

      <div className="profile-bar">
        <div className="tabs">
          <Segmented
            ariaLabel="Profile sections"
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: "Overview" },
              { value: "stats", label: "Stats" },
              ...(player.leagueId === "ncaa-d1" ? [{ value: "gamelog" as Tab, label: "Game log" }] : []),
              ...(player.awards.length || player.draft || player.rankings.length ||
              allAmericansFor(player).length
                ? [{ value: "awards" as Tab, label: "Awards" }]
                : []),
              ...(player.scouting.report || Object.keys(player.scouting.grades).length
                ? [{ value: "scouting" as Tab, label: "Scouting" }]
                : []),
            ]}
          />
        </div>
      </div>

      <div className="profile-body">
        <div className="profile-main">
          {tab === "overview" && <Overview player={player} onStats={() => setTab("stats")} />}
          {tab === "stats" && <StatsTab player={player} />}
          {tab === "gamelog" && (
            <>
              <Highs player={player} />
              <Splits player={player} />
              <GameLog player={player} />
            </>
          )}
          {tab === "awards" && <AwardsTab player={player} />}
          {tab === "scouting" && <Scouting player={player} />}
        </div>

        <aside className="rail">
          <Card>
            <div className="eyebrow">Profile</div>
            <dl className="facts">
              {player.dob ? <div><dt>Born</dt><dd>{fmtDate(player.dob)}</dd></div> : null}
              {ageOf(player.dob) ? <div><dt>Age</dt><dd>{ageOf(player.dob)}</dd></div> : null}
              {player.birthplace.city ? (
                <div><dt>Hometown</dt><dd>{[player.birthplace.city, player.birthplace.state].filter(Boolean).join(", ")}</dd></div>
              ) : null}
              {player.highSchool ? <div><dt>High school</dt><dd>{player.highSchool}</dd></div> : null}
              {player.classYear ? <div><dt>Class</dt><dd>{player.classYear}</dd></div> : null}
              <div><dt>Position</dt><dd>{player.positionName}</dd></div>
              <div><dt>Status</dt><dd>{player.status}</dd></div>
              {player.jersey > 0 ? <div><dt>Jersey</dt><dd>#{player.jersey}</dd></div> : null}
            </dl>
            {!hasBio ? (
              <p className="muted small bio-note">
                Statistics only — {league?.name ?? "this competition"} publishes no player bios, so there
                is no birth date, hometown, height or photo in the source.
              </p>
            ) : null}
          </Card>

          {mates.length ? (
            <Card>
              <div className="eyebrow">Teammates · {mates.length}</div>
              <div className="mate-list">
                {mates.slice(0, 6).map((m) => (
                  <Link key={m.id} to={`/player/${m.slug}`} className="leader-mini">
                    <PlayerAvatar player={m} size={30} />
                    <span className="leader-id">
                      <span className="leader-name">{m.name}</span>
                      <span className="leader-meta">
                        {m.positionName} · {leagueById.get(m.leagueId)?.short ?? ""}
                      </span>
                    </span>
                    <span className="leader-pts">
                      <span className="num strong">{careerTotals(m).pts}</span>
                      <span className="leader-pts-lbl">PTS</span>
                    </span>
                  </Link>
                ))}
              </div>
              {mates.length > 6 ? (
                <p className="muted small mate-more">and {mates.length - 6} more from the same rosters</p>
              ) : null}
            </Card>
          ) : null}

          {player.draft ? (
            <Card>
              <div className="eyebrow">Draft</div>
              <div className="draft-card">
                <div className="draft-league">{player.draft.league}</div>
                <div className="draft-main">
                  Round {player.draft.round}, Pick {player.draft.pick}
                </div>
                <div className="muted">to {player.draft.team} · {player.draft.year}</div>
              </div>
            </Card>
          ) : null}

          {player.rankings.length ? (
            <Card>
              <div className="eyebrow">Rankings</div>
              <div className="rank-list">
                {player.rankings.map((r) => (
                  <div key={r.label + r.rank} className="rank-row">
                    <span className="rank-num num">#{r.rank}</span>
                    <span>
                      <span className="rank-label">{r.label}</span>
                      <span className="rank-sub">{r.source} · {r.year}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {player.awards.length ? (
            <Card>
              <div className="card-head" style={{ marginBottom: 8 }}>
                <div className="eyebrow" style={{ marginBottom: 0 }}>Career highlights</div>
                <button className="link-arrow small link-btn" onClick={() => setTab("awards")}>All</button>
              </div>
              <div className="highlight-list">
                {[...player.awards].sort((a, b) => b.year - a.year).slice(0, 3).map((a, i) => (
                  <div key={i} className="highlight">
                    <span className="highlight-year num">{a.year}</span>
                    <span>{a.title}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {Object.keys(player.scouting.grades).length ? (
            <Card>
              <div className="card-head" style={{ marginBottom: 10 }}>
                <div className="eyebrow" style={{ marginBottom: 0 }}>Scouting snapshot</div>
                <button className="link-arrow small link-btn" onClick={() => setTab("scouting")}>Report</button>
              </div>
              <div className="snapshot-grades">
                {Object.entries(player.scouting.grades)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([label, value]) => (
                    <div key={label} className="snapshot-grade">
                      <span>{label}</span>
                      <span className="num">{value}</span>
                      <span className="snapshot-track"><span style={{ width: `${value}%` }} /></span>
                    </div>
                  ))}
              </div>
            </Card>
          ) : null}

          {peers.length ? (
            <Card>
              <div className="eyebrow">Where he ranks</div>
              <ul className="peer-list">
                {peers.map((r) => (
                  <li key={r.label}>
                    <span className="muted small">{r.label}</span>
                    <span className="peer-rank num">
                      {ordinal(r.rank)} <span className="muted small">of {r.pool}</span>
                    </span>
                    <span className="num small">{r.value}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small similar-note">
                Same position group, competition and season — minimum five games.
              </p>
            </Card>
          ) : null}

          <Card>
            <div className="eyebrow">Comparable players</div>
            <div className="similar">
              {similar.map(({ player: s, score }) => (
                <Link key={s.id} to={`/player/${s.slug}`} className="similar-row">
                  <PlayerAvatar player={s} size={32} />
                  <span className="similar-id">
                    <span>{s.name}</span>
                    <span className="muted small">{teamById.get(s.teamId)?.shortName} · {s.position}</span>
                  </span>
                  <span className="similar-pts">
                    <span className="num small">{score}</span>
                    <span className="similar-lbl">match</span>
                  </span>
                </Link>
              ))}
              {!similar.length ? <p className="muted small">Not enough games to compare yet.</p> : null}
            </div>
            <p className="muted small similar-note">
              Rate similarity within the same position group, shown 1–99.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Overview({ player, onStats }: { player: Player; onStats: () => void }) {
  const { theme } = useTheme();
  const cur = currentSeason(player);
  const team = teamOf(player);
  const league = leagueById.get(player.leagueId);
  const isGoal = player.position === "G";
  const seasons = [...player.seasons].reverse();
  // box feeds publish penalties, not ground balls, so a box-only summary ends on PIM
  const summaryBoxOnly =
    seasons.length > 0 && seasons.slice(0, 4).every((s) => leagueById.get(s.leagueId)?.type === "box");
  // one line per club: a merged career is several clubs and the chart should show which
  // produced the points. A rate (save %) takes the best of a season, never a sum.
  // A clan that changed its name is one club — Elora Mohawks 2024 and Elora Hawks 2026
  // are the same franchise, so they share a series and a colour.
  const chartSeries = (() => {
    const map = new Map<
      string,
      {
        label: string;
        color: string;
        to?: string;
        leagueId: string;
        points: Record<string, number>;
        /** earlier names of a renamed club, so the chart can say so */
        former: string[];
      }
    >();
    for (const s of seasons) {
      const team = teamById.get(s.teamId);
      const franchise = team?.franchise;
      const key = franchise?.id ?? s.teamId;
      if (!map.has(key)) {
        // the newest name is the one to show, not the first season we happen to walk
        const newest = franchise?.names?.find((n) => n.to === null) ?? franchise?.names?.[0];
        const shown = (newest?.teamId ? teamById.get(newest.teamId) : undefined) ?? team;
        map.set(key, {
          label: shown?.shortName ?? team?.shortName ?? s.teamId,
          color: shown?.colors?.[0] ?? "var(--accent)",
          to: shown ? `/team/${shown.slug}` : undefined,
          leagueId: s.leagueId,
          points: {},
          former: [],
        });
      }
      const entry = map.get(key)!;
      const clubName = team?.shortName ?? s.teamId;
      if (franchise && clubName !== entry.label && !entry.former.includes(clubName)) {
        entry.former.push(clubName);
      }
      const value = isGoal
        ? s.sv + s.ga > 0
          ? Math.round((s.sv / (s.sv + s.ga)) * 1000) / 10
          : 0
        : s.pts ?? 0;
      entry.points[s.season] = isGoal
        ? Math.max(entry.points[s.season] ?? 0, value)
        : (entry.points[s.season] ?? 0) + value;
    }
    // two clubs can share a name across leagues (Oakville Rock in the OSL and the MSL),
    // so a repeated label carries its league to keep the legend unambiguous
    const rows = [...map.values()];
    const count = new Map<string, number>();
    rows.forEach((r) => count.set(r.label, (count.get(r.label) ?? 0) + 1));
    rows.forEach((r) => {
      if ((count.get(r.label) ?? 0) > 1) {
        const lge = leagueById.get(r.leagueId);
        if (lge) r.label = `${r.label} · ${lge.short}`;
      }
    });
    // three reds and one exact duplicate: spread them so each line is its own colour,
    // then lift dark clubs so they survive the dark theme's near-black card
    const spread = distinctEach(rows.map((r) => r.color));
    (theme === "dark" ? liftForDark(spread) : spread).forEach((c, i) => (rows[i].color = c));
    return rows;
  })();
  // every year in range, not just the years he played: otherwise 2020 and 2022 sit
  // side by side and a line joins them across the missing season
  const chartCategories = (() => {
    const years = seasons.map((s) => Number(s.season)).filter((y) => Number.isFinite(y));
    if (!years.length) return [];
    const min = Math.min(...years);
    const max = Math.max(...years);
    if (max - min > 14) return [...new Set(seasons.map((s) => s.season))].sort((a, b) => Number(a) - Number(b));
    return Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
  })();

  return (
    <>
      {player.bio || player.strengths.length ? (
        <Card>
          <h3 className="card-title">Bio</h3>
          {player.bio ? <p className="prose">{player.bio}</p> : null}
          {player.strengths.length ? (
            <div className="strength-row">
              {player.strengths.map((s) => (
                <span key={s} className="tag">{s}</span>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <div className="card-head">
          <h3 className="card-title">{isGoal ? "Save percentage by season" : "Points by season"}</h3>
          <span className="muted small">{player.seasons[0]?.season}–{cur.season}</span>
        </div>
        <SeasonLines
          categories={chartCategories}
          series={chartSeries}
          suffix={isGoal ? "%" : ""}
        />
        {chartSeries.some((s) => s.former.length) ? (
          <p className="muted small chart-note">
            {chartSeries
              .filter((s) => s.former.length)
              .map((s) => `${s.label} includes seasons played as ${s.former.join(" and ")}`)
              .join(". ")}
            .
          </p>
        ) : null}
      </Card>

      <Card>
        <div className="card-head">
          <h3 className="card-title">Season summary</h3>
          <button className="link-arrow small link-btn" onClick={onStats}>View full stats</button>
        </div>
        <div className="table-scroll">
        <table className="mini-table season-summary">
          <thead>
            <tr>
              <th>Season</th>
              <th>Team</th>
              <th className="col-league">League</th>
              <th className="r">GP</th>
              {isGoal ? (
                <>
                  <th className="r">MIN</th>
                  <th className="r">SV</th>
                  <th className="r">GA</th>
                  <th className="r">SV%</th>
                  <th className="r">GAA</th>
                </>
              ) : (
                <>
                  <th className="r col-detail">G</th>
                  <th className="r col-detail">AST</th>
                  <th className="r">PTS</th>
                  <th className="r col-detail">PTS/G</th>
                  <th className="r">{summaryBoxOnly ? "PIM" : "GB"}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {seasons.slice(0, 4).map((s, i) => (
              <tr key={`${s.season}-${s.teamId}-${i}`}>
                <td className="num">{s.season}</td>
                <td>
                  {(() => {
                    const t = teamById.get(s.teamId);
                    return t ? (
                      <Link to={`/team/${t.slug}`} className="cell-link">
                        {t.shortName}
                      </Link>
                    ) : (
                      "—"
                    );
                  })()}
                </td>
                <td className="muted small col-league">
                  {(() => {
                    const l = leagueById.get(s.leagueId);
                    return l ? (
                      <Link to={`/league/${l.id}`} className="cell-link">
                        {l.short}
                      </Link>
                    ) : (
                      "—"
                    );
                  })()}
                </td>
                <td className="r num">{s.gp}</td>
                {isGoal ? (
                  <>
                    <td className="r num">{s.min}</td>
                    <td className="r num">{s.sv}</td>
                    <td className="r num">{s.ga}</td>
                    <td className="r num strong">{s.sv + s.ga ? (s.sv / (s.sv + s.ga)).toFixed(3).replace(/^0/, "") : "—"}</td>
                    <td className="r num">{s.min ? ((s.ga * 60) / s.min).toFixed(2) : "—"}</td>
                  </>
                ) : (
                  <>
                    <td className="r num col-detail">{s.g}</td>
                    <td className="r num col-detail">{s.a}</td>
                    <td className="r num strong">{s.pts ?? 0}</td>
                    <td className="r num col-detail">{(s.gp ? (s.pts ?? 0) / s.gp : 0).toFixed(2)}</td>
                    <td className="r num">
                      {leagueById.get(s.leagueId)?.type === "box" ? s.pen : s.gb}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="table-note">
          {team ? (
            <Link to={`/team/${team.slug}`} className="cell-link">
              {team.name}
            </Link>
          ) : null}
          {league ? (
            <>
              {" · "}
              <Link to={`/league/${league.id}`} className="cell-link">
                {league.name}
              </Link>
            </>
          ) : null}
          {` · ${player.positionName}`}
        </div>
      </Card>
    </>
  );
}

type SeasonCellData = { label: string; value: React.ReactNode; strong?: boolean };

type SeasonLineData = {
  key: string;
  season: string;
  league: string;
  team: React.ReactNode;
  cells: SeasonCellData[];
};

/**
 * Season-by-season rows. A fifteen-column table cannot fit a phone, so this is a grid
 * list in the roster's shape: one line per season above 640px, a two-row block below
 * it with the stat labels printed under each value. No sideways scrolling either way.
 */
function SeasonBoard({
  lines,
  totals,
  totalCaption,
}: {
  lines: SeasonLineData[];
  totals: SeasonCellData[];
  totalCaption: string;
}) {
  return (
    <div className={`season-board${totals.length >= 10 ? " is-wide" : ""}`}>
      <div className="season-head" aria-hidden="true">
        <span>Season</span>
        <span>Team</span>
        <span>League</span>
        <span className="season-cells">
          {totals.map((c) => (
            <span key={c.label}>{c.label}</span>
          ))}
        </span>
      </div>
      {lines.map((ln) => (
        <div className="season-row" key={ln.key}>
          <span className="season-year num">{ln.season}</span>
          <span className="season-team">{ln.team}</span>
          <span className="season-league muted">{ln.league}</span>
          <span className="season-cells">
            {ln.cells.map((c) => (
              <span key={c.label}>
                <b className={c.strong ? "num strong" : "num"}>{c.value}</b>
                <i>{c.label}</i>
              </span>
            ))}
          </span>
        </div>
      ))}
      <div className="season-row season-total">
        <span className="season-year strong">{totalCaption}</span>
        <span className="season-team" />
        <span className="season-league" />
        <span className="season-cells">
          {totals.map((c) => (
            <span key={c.label}>
              <b className="num strong">{c.value}</b>
              <i>{c.label}</i>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function StatsTab({ player }: { player: Player }) {
  const [scope, setScope] = useState<string>("all");
  const [perGame, setPerGame] = useState<"total" | "game">("total");
  const league = leagueById.get(player.leagueId);
  const isGoal = player.position === "G";
  const isBox = league?.type === "box";

  // a player who appears in both field and box cannot use either column set
  const types = new Set(player.seasons.map((s) => leagueById.get(s.leagueId)?.type ?? "field"));
  if (types.size > 1) return <MixedStats player={player} />;

  const leagues = [...new Set(player.seasons.map((s) => s.leagueId))];
  const rows = player.seasons
    .filter((s) => (scope === "all" ? true : s.leagueId === scope))
    .slice()
    .sort((a, b) => b.season.localeCompare(a.season));
  const totals = seasonTotals(rows);
  // per-game view: counting stats divided by games played, two decimals
  const val = (n: number, gp: number) => (perGame === "game" ? (n / Math.max(1, gp)).toFixed(2) : String(n));

  return (
    <Card padded={false}>
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">Season by season</h3>
          <p className="muted small">Regular season · {rows.length} seasons</p>
        </div>
        <div className="head-controls">
          <Segmented
            size="sm"
            ariaLabel="Total or per game"
            value={perGame}
            onChange={setPerGame}
            options={[
              { value: "total", label: "Totals" },
              { value: "game", label: "Per game" },
            ]}
          />
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Filter league">
            <option value="all">All competitions</option>
            {leagues.map((l) => (
              <option key={l} value={l}>{leagueById.get(l)?.name ?? l}</option>
            ))}
          </select>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              // mirror exactly what the table shows for this league's stat set
              const box = league?.type === "box";
              const headers = box
                ? ["Season", "Team", "League", "GP", "G", "A", "PTS", "PIM"]
                : ["Season", "Team", "League", "GP", "GS", "G", "A", "PTS", "SH", "SH%", "GB", "TO", "CT", "FO%", "PIM"];
              downloadCsv(
                `${player.slug}-${player.seasons[0]?.season ?? ""}-${player.seasons[player.seasons.length - 1]?.season ?? ""}.csv`,
                headers,
                rows.map((s) => [
                  s.season,
                  teamById.get(s.teamId)?.name ?? s.teamId,
                  leagueById.get(s.leagueId)?.short ?? s.leagueId,
                  s.gp,
                  ...(box
                    ? [s.g, s.a, s.pts ?? 0, s.pen]
                    : [
                        s.gs, s.g, s.a, s.pts ?? 0, s.sh,
                        s.sh ? ((s.g / s.sh) * 100).toFixed(1) : "",
                        s.gb, s.to, s.ct,
                        s.foA ? (s.foW / s.foA).toFixed(3) : "",
                        s.pen,
                      ]),
                ])
              );
            }}
          >
            CSV
          </button>
        </div>
      </div>
      <SeasonBoard
        lines={rows.map((s, i) => {
          const l = leagueById.get(s.leagueId);
          const rowBox = l?.type === "box";
          const t = teamById.get(s.teamId);
          const cells: SeasonCellData[] = isGoal
            ? rowBox
              ? [
                  { label: "GP", value: s.gp },
                  { label: "GS", value: s.gs },
                  { label: "W", value: s.w },
                  { label: "L", value: s.l },
                  { label: "GAA", value: s.gaa ? s.gaa.toFixed(2) : "\u2014" },
                  { label: "SV%", value: s.svp ? s.svp.toFixed(3).replace(/^0/, "") : "\u2014" },
                ]
              : [
                  { label: "GP", value: s.gp },
                  { label: "GS", value: s.gs },
                  { label: "MIN", value: s.min },
                  { label: "GA", value: s.ga },
                  { label: "GAA", value: s.min ? ((s.ga * 60) / s.min).toFixed(2) : "\u2014" },
                  { label: "SV", value: s.sv },
                  { label: "SV%", value: s.sv + s.ga ? (s.sv / (s.sv + s.ga)).toFixed(3).replace(/^0/, "") : "\u2014" },
                  { label: "W\u2013L", value: `${s.w}\u2013${s.l}` },
                ]
            : rowBox
              ? [
                  { label: "GP", value: s.gp },
                  { label: "GS", value: s.gs },
                  { label: "G", value: val(s.g, s.gp) },
                  { label: "AST", value: val(s.a, s.gp) },
                  { label: "PTS", value: val(s.pts ?? 0, s.gp), strong: true },
                  { label: "PIM", value: val(s.pen, s.gp) },
                ]
              : [
                  { label: "GP", value: s.gp },
                  { label: "GS", value: s.gs },
                  { label: "G", value: val(s.g, s.gp) },
                  { label: "AST", value: val(s.a, s.gp) },
                  { label: "PTS", value: val(s.pts ?? 0, s.gp), strong: true },
                  { label: "SH", value: val(s.sh, s.gp) },
                  { label: "SH%", value: s.sh ? ((s.g / s.sh) * 100).toFixed(1) : "\u2014" },
                  { label: "GB", value: val(s.gb, s.gp) },
                  { label: "TO", value: val(s.to, s.gp) },
                  { label: "CT", value: val(s.ct, s.gp) },
                  { label: "FO%", value: s.foA ? (s.foW / s.foA).toFixed(3).replace(/^0/, "") : "\u2014" },
                  { label: "PIM", value: val(s.pen, s.gp) },
                ];
          return {
            key: `${s.season}-${s.teamId}-${i}`,
            season: s.season,
            league: l?.short ?? "",
            team: t ? (
              <Link to={`/team/${t.slug}`} className="team-link">
                <span className="team-dot" style={{ background: t.colors[0] }} />
                <span className="team-name">{t.shortName}</span>
              </Link>
            ) : (
              s.teamId
            ),
            cells,
          };
        })}
        totals={
          isGoal
            ? isBox
              ? [
                  { label: "GP", value: totals.gp },
                  { label: "GS", value: rows.reduce((n, s) => n + s.gs, 0) },
                  { label: "W", value: totals.w },
                  { label: "L", value: totals.l },
                  { label: "GAA", value: totals.gaa ? totals.gaa.toFixed(2) : "\u2014" },
                  { label: "SV%", value: totals.svp ? totals.svp.toFixed(3).replace(/^0/, "") : "\u2014" },
                ]
              : [
                  { label: "GP", value: totals.gp },
                  { label: "GS", value: rows.reduce((n, s) => n + s.gs, 0) },
                  { label: "MIN", value: totals.min },
                  { label: "GA", value: totals.ga },
                  { label: "GAA", value: totals.gaa.toFixed(2) },
                  { label: "SV", value: totals.sv },
                  { label: "SV%", value: totals.svp.toFixed(3).replace(/^0/, "") },
                  { label: "W\u2013L", value: `${totals.w}\u2013${totals.l}` },
                ]
            : isBox
              ? [
                  { label: "GP", value: totals.gp },
                  { label: "GS", value: rows.reduce((n, s) => n + s.gs, 0) },
                  { label: "G", value: val(totals.g, totals.gp) },
                  { label: "AST", value: val(totals.a, totals.gp) },
                  { label: "PTS", value: val(totals.pts, totals.gp) },
                  { label: "PIM", value: val(totals.pen, totals.gp) },
                ]
              : [
                  { label: "GP", value: totals.gp },
                  { label: "GS", value: rows.reduce((n, s) => n + s.gs, 0) },
                  { label: "G", value: val(totals.g, totals.gp) },
                  { label: "AST", value: val(totals.a, totals.gp) },
                  { label: "PTS", value: val(totals.pts, totals.gp) },
                  { label: "SH", value: val(totals.sh, totals.gp) },
                  { label: "SH%", value: totals.sh ? ((totals.g / totals.sh) * 100).toFixed(1) : "\u2014" },
                  { label: "GB", value: val(totals.gb, totals.gp) },
                  { label: "TO", value: val(totals.to, totals.gp) },
                  { label: "CT", value: val(totals.ct, totals.gp) },
                  { label: "FO%", value: totals.fop ? totals.fop.toFixed(3).replace(/^0/, "") : "\u2014" },
                  { label: "PIM", value: val(totals.pen, totals.gp) },
                ]
        }
        totalCaption="Career totals"
      />
      {player.careerLine && player.careerLine.gp > 0 ? (
        <div className="table-note">
          <strong>League career</strong> ({player.careerLine.seasons}{" "}
          {player.careerLine.seasons === 1 ? "season" : "seasons"} on record)
          {isGoal
            ? ` · ${player.careerLine.gp} GP · ${player.careerLine.w ?? 0}–${player.careerLine.l ?? 0}`
            : ` · ${player.careerLine.gp} GP · ${player.careerLine.g}G · ${player.careerLine.a}A · ${player.careerLine.pts} PTS · ${player.careerLine.pen} PIM`}
          . Season detail above covers the current campaign only — the source publishes career
          totals without a season-by-season breakdown.
        </div>
      ) : (
        <div className="table-note">
          Field lacrosse counts ground balls and turnovers; box lacrosse counts loose balls and penalty minutes.
        </div>
      )}
    </Card>
  );
}


function MixedStats({ player }: { player: Player }) {
  const [scope, setScope] = useState("all");
  const leagues = [...new Set(player.seasons.map((s) => s.leagueId))];
  const rows = player.seasons
    .filter((s) => (scope === "all" ? true : s.leagueId === scope))
    .slice()
    .sort((a, b) => b.season.localeCompare(a.season));
  const totals = seasonTotals(rows);

  return (
    <Card padded={false}>
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">Season by season</h3>
          <p className="muted small">
            {rows.length} seasons across {leagues.length} competitions · field and box
          </p>
        </div>
        <div className="head-controls">
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Filter league">
            <option value="all">All competitions</option>
            {leagues.map((l) => (
              <option key={l} value={l}>
                {leagueById.get(l)?.name ?? l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <SeasonBoard
        lines={rows.map((s, i) => {
          const l = leagueById.get(s.leagueId);
          const t = teamById.get(s.teamId);
          return {
            key: `${s.season}-${s.teamId}-${i}`,
            season: s.season,
            league: l?.short ?? "",
            team: t ? (
              <Link to={`/team/${t.slug}`} className="team-link">
                <span className="team-dot" style={{ background: t.colors[0] }} />
                <span className="team-name">{t.shortName}</span>
              </Link>
            ) : (
              s.teamId
            ),
            cells: [
              { label: "GP", value: s.gp },
              { label: "G", value: s.g },
              { label: "AST", value: s.a },
              { label: "PTS", value: s.pts ?? s.g + s.a, strong: true },
              { label: "PIM", value: s.pen ?? "\u2014" },
            ] as SeasonCellData[],
          };
        })}
        totals={[
          { label: "GP", value: totals.gp },
          { label: "G", value: totals.g },
          { label: "AST", value: totals.a },
          { label: "PTS", value: totals.pts },
          { label: "PIM", value: totals.pen },
        ]}
        totalCaption="Career totals"
      />
      <div className="table-note">
        Career spans both codebases, so the table keeps only the columns both publish. Ground
        balls, shots and faceoffs appear on the league-specific season detail further down.
      </div>
    </Card>
  );
}

function Highs({ player }: { player: Player }) {
  const games = usePlayerGames(player.id);
  const rows = React.useMemo(() => {
    if (!games || games.length < 2) return [];
    const best = (f: (g: GameRow) => number) =>
      games.reduce<GameRow | null>((b, g) => (!b || f(g) > f(b) ? g : b), null);
    const cats: { label: string; f: (g: GameRow) => number }[] = [
      { label: "Points", f: (g) => (g.g || 0) + (g.a || 0) },
      { label: "Goals", f: (g) => g.g || 0 },
      { label: "Assists", f: (g) => g.a || 0 },
      { label: "Ground balls", f: (g) => g.gb || 0 },
      { label: "Caused turnovers", f: (g) => g.ct || 0 },
      { label: "Faceoff wins", f: (g) => g.foW || 0 },
    ];
    if (player.position === "G") cats.push({ label: "Saves", f: (g) => g.sv || 0 });
    return cats
      .map((c) => ({ label: c.label, game: best(c.f), value: best(c.f) ? c.f(best(c.f)!) : 0 }))
      .filter((r) => r.game && r.value > 0);
  }, [games, player.position]);

  if (!rows.length) return null;

  return (
    <Card padded={false} className="standings-card">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">Single-game highs</h3>
          <p className="muted small">Best game in each category, with the date it happened</p>
        </div>
      </div>
      <ul className="highs-list">
        {rows.map((r) => (
          <li key={r.label}>
            <span className="muted small">{r.label}</span>
            <span className="num strong">{r.value}</span>
            <span className="muted small">
              {r.game!.date} · {r.game!.opponent ?? "—"} {r.game!.result ?? ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Splits({ player }: { player: Player }) {
  const games = usePlayerGames(player.id);
  const groups = React.useMemo(() => (games ? splits(games, player) : []), [games, player.id]);
  const adj = React.useMemo(() => (games ? adjustedRate(games, player) : null), [games, player.id]);
  if (!groups.length) return null;

  return (
    <Card padded={false} className="standings-card">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">Splits</h3>
          <p className="muted small">
            From this player&apos;s game log — home/away is not published in the box scores, so it is
            not shown
          </p>
        </div>
      </div>
      {adj ? (
        <p className="adjusted-line">
          <span className="muted small">Opponent-adjusted points / game</span>{" "}
          <span className="num strong">{adj.adjusted.toFixed(2)}</span>{" "}
          <span className="muted small">
            vs {adj.raw.toFixed(2)} raw · opponents averaged {Math.round(adj.avgOppElo)} Elo across{" "}
            {adj.games} games
          </span>
        </p>
      ) : null}
      <div className="splits-grid">
        {groups.map((g) => (
          <div key={g.label} className="splits-group">
            <div className="eyebrow">{g.label}</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th />
                  <th className="r">GP</th>
                  <th className="r">G</th>
                  <th className="r">A</th>
                  <th className="r">PTS</th>
                  <th className="r">PTS/G</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.key}</td>
                    <td className="r num">{r.gp}</td>
                    <td className="r num">{r.g}</td>
                    <td className="r num">{r.a}</td>
                    <td className="r num strong">{r.pts}</td>
                    <td className="r num">{(r.pts / Math.max(1, r.gp)).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {g.note ? <p className="muted small split-note">{g.note}</p> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function GameLog({ player }: { player: Player }) {
  const isGoal = player.position === "G";
  const loaded = usePlayerGames(player.id);

  if (loaded === null) {
    return (
      <Card>
        <div className="eyebrow">Game log</div>
        <p className="muted">Loading box scores…</p>
      </Card>
    );
  }
  if (!loaded.length) {
    return (
      <Card>
        <div className="eyebrow">Game log</div>
        <p className="muted">
          No box scores on record for this player. Game logs come from each game&apos;s official box
          score, which this program&apos;s site does not publish.
        </p>
      </Card>
    );
  }

  const games = [...loaded].sort((a, b) => b.date.localeCompare(a.date));
  const summary = gameSummary([...loaded]);
  const pts = (g: { g: number; a: number }) => g.g + g.a;
  const score = (g: { g: number; a: number; sv: number | null; ga: number | null }) =>
    isGoal ? (g.sv ?? 0) - (g.ga ?? 0) : pts(g);
  const best = games.reduce<(typeof games)[number] | null>(
    (b, g) => (!b || score(g) > score(b) ? g : b),
    null
  );
  const wins = games.filter((g) => g.result === "W").length;
  const losses = games.filter((g) => g.result === "L").length;
  const totalPts = games.reduce((n, g) => n + pts(g), 0);

  return (
    <Card padded={false}>
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">Game log</h3>
          <p className="muted small">
            {games.length} games · {wins}–{losses}
            {!isGoal && totalPts ? ` · ${totalPts} points` : ""}
            {best ? ` · best: ${isGoal ? `${best.sv ?? 0} saves` : `${pts(best)} pts`} vs ${best.opponent}` : ""}
          </p>
        </div>
        <div className="head-controls">
          <span className="tag">{player.positionName}</span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() =>
              downloadCsv(
                `${player.slug}-game-log.csv`,
                isGoal
                  ? ["Date", "Opponent", "Result", "SV", "GA", "SV%"]
                  : ["Date", "Opponent", "Result", "G", "A", "PTS", "GB", "CT", "FO"],
                games.map((g) =>
                  isGoal
                    ? [g.date, g.opponent, g.result, g.sv ?? 0, g.ga ?? 0,
                       g.sv || g.ga ? ((g.sv ?? 0) / ((g.sv ?? 0) + (g.ga ?? 0))).toFixed(3) : ""]
                    : [g.date, g.opponent, g.result, g.g, g.a, pts(g), g.gb, g.ct,
                       g.foA ? `${g.foW}-${g.foA}` : ""]
                )
              )
            }
          >
            CSV
          </button>
        </div>
      </div>
      <div className="game-form">
        <div className="stat-group-grid">
          {isGoal ? (
            <>
              <Stat
                label="Last 5 save %"
                value={
                  summary.last5.shots
                    ? (summary.last5.sv / summary.last5.shots).toFixed(3).replace(/^0/, "")
                    : "—"
                }
                sub={`${summary.last5.gp} games`}
                tone="accent"
              />
              <Stat
                label="Single-game high"
                value={`${summary.highs.sv} saves`}
                sub={`${summary.last5.ga.toFixed(1)} GA/game`}
              />
            </>
          ) : (
            <>
              <Stat
                label="Last 5 PTS/G"
                value={summary.last5.pts.toFixed(2)}
                sub={`${summary.last5.g.toFixed(1)}G · ${summary.last5.a.toFixed(1)}A`}
                tone="accent"
              />
              <Stat
                label="Best game"
                value={`${summary.best?.pts ?? 0} pts`}
                sub={
                  summary.best
                    ? `${summary.best.g}G · ${summary.best.a}A vs ${summary.best.opponent}`
                    : "no games"
                }
              />
            </>
          )}
          <Stat label="Streak" value={`${summary.streak} ${summary.streak === 1 ? "game" : "games"}`} sub="point streak" />
          <Stat label="Ground balls" value={`${summary.highs.gb} GB`} sub={`${summary.highs.ct} CT best`} />
        </div>
        <div className="form-strip" aria-label="Recent results">
          {summary.form.map((r, i) => (
            <span key={i} className={`form-dot ${r === "W" ? "is-w" : r === "L" ? "is-l" : "is-t"}`} title={r}>
              {r}
            </span>
          ))}
          <span className="muted small form-label">last {summary.form.length}</span>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opponent</th>
              <th className="c">Result</th>
              {isGoal ? (
                <>
                  <th className="r">SV</th>
                  <th className="r">GA</th>
                  <th className="r">SV%</th>
                </>
              ) : (
                <>
                  <th className="r">G</th>
                  <th className="r">AST</th>
                  <th className="r">PTS</th>
                  <th className="r">GB</th>
                  <th className="r">CT</th>
                  {player.position === "FO" ? <th className="r">FO</th> : null}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {games.map((g, i) => (
              <tr key={i} className={best && g === best ? "is-best" : undefined}>
                <td className="num">{fmtDate(g.date)}</td>
                <td>
                  {(() => {
                    const opp = g.opponent ? teamByName(g.opponent) : undefined;
                    return opp ? (
                      <Link to={`/team/${opp.slug}`} className="cell-link">
                        {opp.shortName}
                      </Link>
                    ) : (
                      g.opponent
                    );
                  })()}
                </td>
                <td className="c">
                  <span className={`result ${g.result === "W" ? "win" : g.result === "L" ? "loss" : ""}`}>
                    {g.result}
                  </span>
                </td>
                {isGoal ? (
                  <>
                    <td className="r num">{g.sv ?? 0}</td>
                    <td className="r num">{g.ga ?? 0}</td>
                    <td className="r num">
                      {(g.sv ?? 0) + (g.ga ?? 0)
                        ? (((g.sv ?? 0) / ((g.sv ?? 0) + (g.ga ?? 0)))).toFixed(3).replace(/^0/, "")
                        : "—"}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="r num">{g.g}</td>
                    <td className="r num">{g.a}</td>
                    <td className="r num strong">{pts(g)}</td>
                    <td className="r num">{g.gb}</td>
                    <td className="r num">{g.ct}</td>
                    {player.position === "FO" ? <td className="r num">{g.foW}–{g.foA}</td> : null}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-note">
        Parsed from each game&apos;s official box score. The highlighted row is the best game in this span.
      </div>
    </Card>
  );
}

function AwardsTab({ player }: { player: Player }) {
  const awards = [...player.awards].sort((a, b) => b.year - a.year);
  const allAmerica = allAmericansFor(player).sort((a, b) => b.year - a.year);
  return (
    <>
      <Card>
        <h3 className="card-title">Honors &amp; awards</h3>
        {allAmerica.length ? (
          <div className="timeline">
            {allAmerica.map((a) => (
              <div className="tl-row" key={`${a.year}-${a.tier}`}>
                <div className="tl-year num">{a.year}</div>
                <div className="tl-dot" />
                <div className="tl-body">
                  <div className="tl-title">USILA {a.tier} All-American</div>
                  <div className="muted small">{a.division} · from the published selection sheet</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {awards.length === 0 && !allAmerica.length ? (
          <p className="muted">No individual honors recorded yet.</p>
        ) : null}
        {awards.length === 0 ? null : (
          <div className="timeline">
            {awards.map((a, i) => (
              <div className="tl-row" key={`${a.title}-${a.year}-${i}`}>
                <div className="tl-year num">{a.year}</div>
                <div className="tl-dot" />
                <div className="tl-body">
                  <div className="tl-title">{a.title}</div>
                  <div className="muted small">{a.team}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <h3 className="card-title">Draft &amp; rankings</h3>
        <div className="two-col">
          <div>
            <div className="eyebrow">Draft</div>
            {player.draft ? (
              <p className="prose">
                Selected in the {player.draft.year} {player.draft.league} Draft, round {player.draft.round}, pick{" "}
                {player.draft.pick} by {player.draft.team}.
              </p>
            ) : (
              <p className="muted">Not drafted.</p>
            )}
          </div>
          <div>
            <div className="eyebrow">Rankings</div>
            {player.rankings.length ? (
              player.rankings.map((r) => (
                <div key={r.label} className="rank-inline">
                  <span className="num strong">#{r.rank}</span> {r.label}
                </div>
              ))
            ) : (
              <p className="muted">Unranked.</p>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}

function Scouting({ player }: { player: Player }) {
  const pool = data.players.filter((p) => p.position === player.position);
  const grades = Object.entries(player.scouting.grades);
  return (
    <>
      <Card>
        <div className="card-head">
          <div>
            <div className="eyebrow">Scouting report</div>
            <h3 className="card-title">{player.scouting.author}</h3>
          </div>
          <span className="muted small">{fmtDate(player.scouting.date)}</span>
        </div>
        <p className="prose lead">{player.scouting.report}</p>
        <div className="strength-row">
          {player.strengths.map((s) => (
            <span key={s} className="tag">{s}</span>
          ))}
        </div>
      </Card>
      <Card>
        <div className="card-head">
          <h3 className="card-title">Tool grades</h3>
          <span className="muted small">Percentile vs. {player.positionName.toLowerCase()}s</span>
        </div>
        <div className="grades">
          {grades.map(([label, value]) => {
            const others = pool.map((p) => p.scouting.grades[label] ?? 0);
            const rank = Math.round((others.filter((v) => v < value).length / Math.max(1, others.length)) * 100);
            return <GradeBar key={label} label={label} value={value} rank={rank} />;
          })}
        </div>
      </Card>
    </>
  );
}
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}
