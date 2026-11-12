import React, { useMemo, useState } from "react";
import { Link, useCompare, useRoute } from "../lib/app";
import {
  ageOf,
  careerTotals,
  currentSeason,
  data,
  fmtDate,
  fmtHeight,
  leagueById,
  playerBySlug,
  seasonTotals,
  similarPlayers,
  teamById,
  gameSummary,
  teamOf,
  teammatesOf,
  usePlayerGames,
} from "../lib/data";
import type { Player, SeasonRow } from "../lib/types";
import { downloadCsv, downloadPlayerCard } from "../lib/export";
import { toggleSaved, useRoster } from "../lib/storage";
import { Avatar, Card, Empty, FilterSelect, GradeBar, PlayerAvatar, PositionBadge, SeasonBars, Segmented, Sparkline, Stat, TeamLogo } from "../components/ui";
import { Button } from "../components/shadcn/button";
import { toast } from "sonner";

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
            </div>
            <div className="profile-actions flex flex-wrap gap-2">
              <Button
                variant={has(player.id) ? "secondary" : "default"}
                onClick={() => toggle(player.id)}
                className="rounded-full"
              >
                {has(player.id) ? "In comparison ✓" : "Compare"}
              </Button>
              <Button variant="outline" onClick={copy} className="rounded-full">
                {copied ? "Link copied" : "Share"}
              </Button>
              <Button
                variant={saved ? "secondary" : "outline"}
                aria-pressed={saved}
                onClick={() => {
                  toggleSaved(player.id);
                  toast(saved ? `${player.name} removed from my roster` : `${player.name} saved to my roster`);
                }}
                title={saved ? "Remove from my roster" : "Save to my roster"}
                className="rounded-full"
              >
                {saved ? "★ Saved" : "☆ Save"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  downloadPlayerCard(player, team, league);
                  toast("Share card downloaded");
                }}
                title="Download a shareable card"
                className="rounded-full"
              >
                Card
              </Button>
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

      <div className="profile-body">
        <div className="profile-main">
          <div className="tabs">
            <Segmented
              ariaLabel="Profile sections"
              value={tab}
              onChange={setTab}
              options={[
                { value: "overview", label: "Overview" },
                { value: "stats", label: "Stats" },
                ...(player.leagueId === "ncaa-d1" ? [{ value: "gamelog" as Tab, label: "Game log" }] : []),
                ...(player.awards.length || player.draft || player.rankings.length
                  ? [{ value: "awards" as Tab, label: "Awards" }]
                  : []),
                ...(player.scouting.report || Object.keys(player.scouting.grades).length
                  ? [{ value: "scouting" as Tab, label: "Scouting" }]
                  : []),
              ]}
            />
          </div>

          {tab === "overview" && <Overview player={player} onStats={() => setTab("stats")} />}
          {tab === "stats" && <StatsTab player={player} />}
          {tab === "gamelog" && <GameLog player={player} />}
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
                <div><dt>Hometown</dt><dd>{player.birthplace.city}, {player.birthplace.state}</dd></div>
              ) : null}
              {player.highSchool ? <div><dt>High school</dt><dd>{player.highSchool}</dd></div> : null}
              {player.classYear ? <div><dt>Class</dt><dd>{player.classYear}</dd></div> : null}
              <div><dt>Position</dt><dd>{player.positionName}</dd></div>
              <div><dt>Status</dt><dd>{player.status}</dd></div>
              {player.jersey > 0 ? <div><dt>Jersey</dt><dd>#{player.jersey}</dd></div> : null}
            </dl>
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

          <Card>
            <div className="eyebrow">Similar players</div>
            <div className="similar">
              {similarPlayers(player, 4).map((s) => (
                <Link key={s.id} to={`/player/${s.slug}`} className="similar-row">
                  <PlayerAvatar player={s} size={32} />
                  <span className="similar-id">
                    <span>{s.name}</span>
                    <span className="muted small">{teamById.get(s.teamId)?.shortName} · {s.position}</span>
                  </span>
                  <span className="similar-pts">
                    <span className="num small">{careerTotals(s).pts}</span>
                    <span className="similar-lbl">PTS</span>
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Overview({ player, onStats }: { player: Player; onStats: () => void }) {
  const cur = currentSeason(player);
  const team = teamOf(player);
  const league = leagueById.get(player.leagueId);
  const isGoal = player.position === "G";
  const seasons = [...player.seasons].reverse();
  // one bar per team per season: a merged career changes clubs, and the chart should show it
  const chartGroups = (() => {
    const order: string[] = [];
    const bySeason = new Map<string, { value: number; color: string; label: string }[]>();
    for (const s of seasons) {
      const team = teamById.get(s.teamId);
      const value = isGoal
        ? s.sv + s.ga > 0
          ? Math.round((s.sv / (s.sv + s.ga)) * 1000) / 10
          : 0
        : s.pts ?? 0;
      if (!bySeason.has(s.season)) {
        bySeason.set(s.season, []);
        order.push(s.season);
      }
      bySeason.get(s.season)!.push({
        value,
        color: team?.colors?.[0] ?? "var(--accent)",
        label: team?.shortName ?? s.teamId,
      });
    }
    return order.map((season) => ({ season, bars: bySeason.get(season)! }));
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
        {chartGroups.length > 1 && new Set(player.seasons.map((s) => s.teamId)).size > 1 ? (
          <SeasonBars groups={chartGroups} valueSuffix={isGoal ? "%" : ""} />
        ) : (
          <Sparkline
            values={chartGroups.map((g) => g.bars.reduce((n, b) => n + b.value, 0))}
            labels={chartGroups.map((g) => g.season)}
            valueSuffix={isGoal ? "%" : ""}
          />
        )}
      </Card>

      <Card>
        <div className="card-head">
          <h3 className="card-title">Season summary</h3>
          <button className="link-arrow small link-btn" onClick={onStats}>View full stats</button>
        </div>
        <div className="table-scroll">
        <table className="mini-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Team</th>
              <th>League</th>
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
                  <th className="r">G</th>
                  <th className="r">AST</th>
                  <th className="r">PTS</th>
                  <th className="r">PTS/G</th>
                  <th className="r">GB</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {seasons.slice(0, 4).map((s, i) => (
              <tr key={`${s.season}-${s.teamId}-${i}`}>
                <td className="num">{s.season}</td>
                <td>{teamById.get(s.teamId)?.shortName}</td>
                <td className="muted small">{leagueById.get(s.leagueId)?.short}</td>
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
                    <td className="r num">{s.g}</td>
                    <td className="r num">{s.a}</td>
                    <td className="r num strong">{s.pts ?? 0}</td>
                    <td className="r num">{(s.gp ? (s.pts ?? 0) / s.gp : 0).toFixed(2)}</td>
                    <td className="r num">{s.gb}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="table-note">
          {team?.name} · {league?.name} · {player.positionName}
        </div>
      </Card>
    </>
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
          <FilterSelect
            value={scope}
            onChange={setScope}
            ariaLabel="Filter league"
            options={[
              { value: "all", label: "All competitions" },
              ...leagues.map((l) => ({ value: l, label: leagueById.get(l)?.name ?? l })),
            ]}
          />
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
      <div className="table-scroll">
        <table className="data-table stats-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Team</th>
              <th>League</th>
              <th className="r">GP</th>
              <th className="r">GS</th>
              {isGoal ? (
                isBox ? (
                  <>
                    <th className="r">W</th>
                    <th className="r">L</th>
                    <th className="r">GAA</th>
                    <th className="r">SV%</th>
                  </>
                ) : (
                  <>
                    <th className="r">MIN</th>
                    <th className="r">GA</th>
                    <th className="r">GAA</th>
                    <th className="r">SV</th>
                    <th className="r">SV%</th>
                    <th className="r">W–L</th>
                  </>
                )
              ) : isBox ? (
                <>
                  <th className="r">G</th>
                  <th className="r">AST</th>
                  <th className="r">PTS</th>
                  <th className="r">PIM</th>
                </>
              ) : (
                <>
                  <th className="r">G</th>
                  <th className="r">AST</th>
                  <th className="r">PTS</th>
                  <th className="r">SH</th>
                  <th className="r">SH%</th>
                  <th className="r">GB</th>
                  <th className="r">TO</th>
                  <th className="r">CT</th>
                  <th className="r">FO%</th>
                  <th className="r">PIM</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const l = leagueById.get(s.leagueId);
              const isBoxRow = l?.type === "box";
              return (
                <tr key={`${s.season}-${s.teamId}-${i}`}>
                  <td className="num strong">{s.season}</td>
                  <td>
                    <Link to={`/team/${teamById.get(s.teamId)?.slug}`} className="team-link">
                      <span className="team-dot" style={{ background: teamById.get(s.teamId)?.colors[0] }} />
                      {teamById.get(s.teamId)?.shortName}
                    </Link>
                  </td>
                  <td className="muted small">{l?.short}</td>
                  <td className="r num">{s.gp}</td>
                  <td className="r num">{s.gs}</td>
                  {isGoal ? (
                    isBoxRow ? (
                      <>
                        <td className="r num">{s.w}</td>
                        <td className="r num">{s.l}</td>
                        <td className="r num">{s.gaa ? s.gaa.toFixed(2) : "—"}</td>
                        <td className="r num">{s.svp ? s.svp.toFixed(3).replace(/^0/, "") : "—"}</td>
                      </>
                    ) : (
                      <>
                        <td className="r num">{s.min}</td>
                        <td className="r num">{s.ga}</td>
                        <td className="r num">{s.min ? ((s.ga * 60) / s.min).toFixed(2) : "—"}</td>
                        <td className="r num">{s.sv}</td>
                        <td className="r num">{s.sv + s.ga ? (s.sv / (s.sv + s.ga)).toFixed(3).replace(/^0/, "") : "—"}</td>
                        <td className="r num">{s.w}–{s.l}</td>
                      </>
                    )
                  ) : isBoxRow ? (
                    <>
                      <td className="r num">{val(s.g, s.gp)}</td>
                      <td className="r num">{val(s.a, s.gp)}</td>
                      <td className="r num strong">{val(s.pts ?? 0, s.gp)}</td>
                      <td className="r num">{val(s.pen, s.gp)}</td>
                    </>
                  ) : (
                    <>
                      <td className="r num">{val(s.g, s.gp)}</td>
                      <td className="r num">{val(s.a, s.gp)}</td>
                      <td className="r num strong">{val(s.pts ?? 0, s.gp)}</td>
                      <td className="r num">{val(s.sh, s.gp)}</td>
                      <td className="r num">{s.sh ? ((s.g / s.sh) * 100).toFixed(1) : "—"}</td>
                      <td className="r num">{val(s.gb, s.gp)}</td>
                      <td className="r num">{val(s.to, s.gp)}</td>
                      <td className="r num">{val(s.ct, s.gp)}</td>
                      <td className="r num">{s.foA ? (s.foW / s.foA).toFixed(3).replace(/^0/, "") : "—"}</td>
                      <td className="r num">{val(s.pen, s.gp)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="strong">Career totals</td>
              <td className="r num strong">{totals.gp}</td>
              <td className="r num strong">{rows.reduce((n, s) => n + s.gs, 0)}</td>
              {isGoal ? (
                isBox ? (
                  <>
                    <td className="r num strong">{totals.w}</td>
                    <td className="r num strong">{totals.l}</td>
                    <td className="r num strong">{totals.gaa ? totals.gaa.toFixed(2) : "—"}</td>
                    <td className="r num strong">{totals.svp ? totals.svp.toFixed(3).replace(/^0/, "") : "—"}</td>
                  </>
                ) : (
                  <>
                    <td className="r num strong">{totals.min}</td>
                    <td className="r num strong">{totals.ga}</td>
                    <td className="r num strong">{totals.gaa.toFixed(2)}</td>
                    <td className="r num strong">{totals.sv}</td>
                    <td className="r num strong">{totals.svp.toFixed(3).replace(/^0/, "")}</td>
                    <td className="r num strong">{totals.w}–{totals.l}</td>
                  </>
                )
              ) : isBox ? (
                <>
                  <td className="r num strong">{val(totals.g, totals.gp)}</td>
                  <td className="r num strong">{val(totals.a, totals.gp)}</td>
                  <td className="r num strong">{val(totals.pts, totals.gp)}</td>
                  <td className="r num strong">{val(totals.pen, totals.gp)}</td>
                </>
              ) : (
                <>
                  <td className="r num strong">{val(totals.g, totals.gp)}</td>
                  <td className="r num strong">{val(totals.a, totals.gp)}</td>
                  <td className="r num strong">{val(totals.pts, totals.gp)}</td>
                  <td className="r num strong">{val(totals.sh, totals.gp)}</td>
                  <td className="r num strong">{totals.sh ? ((totals.g / totals.sh) * 100).toFixed(1) : "—"}</td>
                  <td className="r num strong">{val(totals.gb, totals.gp)}</td>
                  <td className="r num strong">{val(totals.to, totals.gp)}</td>
                  <td className="r num strong">{val(totals.ct, totals.gp)}</td>
                  <td className="r num strong">{totals.fop ? totals.fop.toFixed(3).replace(/^0/, "") : "—"}</td>
                  <td className="r num strong">{val(totals.pen, totals.gp)}</td>
                </>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
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
          <FilterSelect
            value={scope}
            onChange={setScope}
            ariaLabel="Filter league"
            options={[
              { value: "all", label: "All competitions" },
              ...leagues.map((l) => ({ value: l, label: leagueById.get(l)?.name ?? l })),
            ]}
          />
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table stats-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Team</th>
              <th>League</th>
              <th className="r">GP</th>
              <th className="r">G</th>
              <th className="r">AST</th>
              <th className="r">PTS</th>
              <th className="r">PIM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const l = leagueById.get(s.leagueId);
              const team = teamById.get(s.teamId);
              return (
                <tr key={`${s.season}-${s.teamId}-${i}`}>
                  <td className="num">{s.season}</td>
                  <td>
                    {team ? (
                      <Link to={`/team/${team.slug}`} className="team-link">
                        {team.shortName}
                      </Link>
                    ) : (
                      s.teamId
                    )}
                  </td>
                  <td className="muted small">{l?.short ?? s.leagueId}</td>
                  <td className="r num">{s.gp}</td>
                  <td className="r num">{s.g}</td>
                  <td className="r num">{s.a}</td>
                  <td className="r num strong">{s.pts ?? s.g + s.a}</td>
                  <td className="r num">{s.pen ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="strong">Career totals</td>
              <td className="r num strong">{totals.gp}</td>
              <td className="r num strong">{totals.g}</td>
              <td className="r num strong">{totals.a}</td>
              <td className="r num strong">{totals.pts}</td>
              <td className="r num strong">{totals.pen}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="table-note">
        Career spans both codebases, so the table keeps only the columns both publish. Ground
        balls, shots and faceoffs appear on the league-specific season detail further down.
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
                <td>{g.opponent}</td>
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
  return (
    <>
      <Card>
        <h3 className="card-title">Honors &amp; awards</h3>
        {awards.length === 0 ? (
          <p className="muted">No individual honors recorded yet.</p>
        ) : (
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