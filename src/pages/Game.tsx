import React, { useEffect, useMemo, useState } from "react";
import { loadScores } from "../lib/schedule";
import { Link, useRoute } from "../lib/app";
import { data, fmtDate, teamBySlug, teamSetActive } from "../lib/data";
import { Card, Empty, LoadError, PlayerAvatar, Skeleton, SkeletonRows, Term, TeamLogo } from "../components/ui";
import type { GameRow } from "../lib/types";

/**
 * One game, assembled from the data we already hold.
 *
 * The score comes from scores.json; the lines come from every player's own game log on
 * that date. Only players we track appear, so this is a partial box score and says so.
 */

type Score = { date: string; home: string; away: string; hs: number; as: number; venue?: string };

const norm = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
const similar = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y) && (x.startsWith(y) || y.startsWith(x));
};

type Line = { id: string; slug: string; name: string; position: string; photo?: string; row: GameRow };

export default function Game() {
  const route = useRoute();
  const [, , date = "", homeSlug = "", awaySlug = ""] = route.path.split("/");
  const home = teamBySlug.get(homeSlug);
  const away = teamBySlug.get(awaySlug);

  const [scores, setScores] = useState<Score[] | null>(null);
  const [logs, setLogs] = useState<Record<string, GameRow[]> | null>(null);

  useEffect(() => {
    let alive = true;
    loadScores()
      // both scorecards we hold: NCAA D1 and the PLL. A PLL game page was showing
      // "no score on file" because only d1 was read.
      .then((p: { d1?: Score[]; pll?: Score[] }) => alive && setScores([...(p.d1 ?? []), ...(p.pll ?? [])]))
      .catch(() => alive && setScores([]));
    if (teamSetActive()) {
      // the box score comes from /data/page?path=/box; the 3.5 MB log stays on the server
      setLogs({});
    }
    return () => {
      alive = false;
    };
  }, []);

  const game = useMemo(
    () =>
      (scores ?? []).find(
        (g) =>
          g.date === date &&
          ((similar(g.home, home?.name ?? "") && similar(g.away, away?.name ?? "")) ||
            (similar(g.home, away?.name ?? "") && similar(g.away, home?.name ?? ""))),
      ),
    [scores, date, home, away],
  );

  // a database-backed load asks for the box score of this fixture instead of scanning every log
  const [box, setBox] = useState<any[] | null>(null);
  // the boot can paint this route without its team set (a stale link, a failed /team-set): the
  // skeleton must not run forever, because a page stuck loading reads exactly like a broken one
  const [stalled, setStalled] = useState(false);
  // a box score that fails to arrive is not the same as a fixture we hold no lines for, and the
  // empty state said "No box score for this side" for both — a transient 502 read as a data gap
  const [boxError, setBoxError] = useState(false);
  const [boxAttempt, setBoxAttempt] = useState(0);
  useEffect(() => {
    if (!home || !away || !teamSetActive()) return;
    const ctl = new AbortController();
    const qs = new URLSearchParams({ path: "/box", date, teams: `${home.id},${away.id}` });
    setBoxError(false);
    fetch(`${import.meta.env.BASE_URL}data/page?${qs}`, { signal: ctl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`box score answered ${r.status}`);
        return r.json();
      })
      .then((d) => setBox(d.lines ?? []))
      .catch((err) => {
        if (!ctl.signal.aborted) setBoxError(true);
        void err;
      });
    return () => ctl.abort();
  }, [date, home?.id, away?.id, boxAttempt]);

  useEffect(() => {
    if (logs || box || boxError) {
      setStalled(false);
      return;
    }
    const t = setTimeout(() => setStalled(true), 10000);
    return () => clearTimeout(t);
  }, [logs, box, boxError]);

  const lines = useMemo(() => {
    if (box) {
      const side = (teamId: string) =>
        box
          .filter((l) => l.teamId === teamId)
          .map((l) => ({ id: l.id, slug: l.slug, name: l.name, position: l.position, photo: l.photo, row: l.row }))
          .sort((a, b) => (b.row.g || 0) + (b.row.a || 0) - ((a.row.g || 0) + (a.row.a || 0)));
      return { home: home ? side(home.id) : [], away: away ? side(away.id) : [] };
    }
    if (!logs || !home || !away) return { home: [], away: [] };
    const season = date.slice(0, 4);
    const forSide = (side: "home" | "away") => {
      const team = side === "home" ? home : away;
      const opponent = side === "home" ? away : home;
      const out: Line[] = [];
      for (const p of data.players) {
        if (p.teamId !== team.id) continue;
        const row = (logs[p.id] ?? []).find((g) => g.date === date && similar(g.opponent ?? "", opponent.name));
        if (!row) continue;
        out.push({ id: p.id, slug: p.slug, name: p.name, position: p.position, photo: p.photo, row });
      }
      return out.sort(
        (a, b) => (b.row.g || 0) + (b.row.a || 0) - ((a.row.g || 0) + (a.row.a || 0)),
      );
    };
    void season;
    return { home: forSide("home"), away: forSide("away") };
  }, [logs, date, home, away, box]);

  if (!home || !away) {
    return (
      <div className="page">
        <Empty title="Game not found" body="Both programs have to be in the database for a game page." />
      </div>
    );
  }

  const homeWon = game ? game.hs > game.as : false;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{game?.venue || "Game"}</div>
          <h1 className="vs-title">
            <Link to={`/team/${away.slug}`} className="vs-team">
              <TeamLogo team={away} size={30} />
              {away.shortName}
            </Link>
            <span className="vs-record num">{game ? `${game.as}–${game.hs}` : "—"}</span>
            <Link to={`/team/${home.slug}`} className="vs-team">
              <TeamLogo team={home} size={30} />
              {home.shortName}
            </Link>
          </h1>
          <p className="muted">
            {fmtDate(date)} ·{" "}
            {game ? (homeWon ? `${home.shortName} won` : `${away.shortName} won`) : "no score on file"}
          </p>
        </div>
      </div>

      {!logs && stalled ? (
        <LoadError
          title="This game didn't load"
          body="The box score and the scorecard were both asked for and neither arrived. Reloading asks again."
          onRetry={() => window.location.reload()}
        />
      ) : !logs ? (
        <div className="game-grid" aria-busy="true">
          {[0, 1].map((i) => (
            <Card key={i} padded={false} className="standings-card">
              <div className="card-toolbar">
                <div>
                  <h3 className="card-title"><Skeleton w={140} h={15} /></h3>
                  <p className="muted small"><Skeleton w={110} h={10} /></p>
                </div>
              </div>
              <SkeletonRows rows={6} cols={6} />
            </Card>
          ))}
        </div>
      ) : (
        <div className="game-grid panel-in">
          {(["away", "home"] as const).map((side) => {
            const team = side === "home" ? home : away;
            const rows = lines[side];
            return (
              <Card key={side} padded={false} className="standings-card">
                <div className="card-toolbar">
                  <div>
                    <h3 className="card-title">
                      <Link to={`/team/${team.slug}`}>{team.shortName}</Link>
                    </h3>
                    <p className="muted small">{rows.length} players with a line</p>
                  </div>
                </div>
                {rows.length ? (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Player</th>
                          <th className="r"><Term k="g" /></th>
                          <th className="r"><Term k="a" /></th>
                          <th className="r"><Term k="pts" /></th>
                          <th className="r"><Term k="gb" /></th>
                          <th className="r"><Term k="ct" /></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((l) => (
                          <tr key={l.id}>
                            <td>
                              <Link to={`/player/${l.slug}`} className="leader-name">
                                {/* the box score and the loaded player set are different slices: a player
                                    with a line can be outside the set, so the row's own fields carry the
                                    avatar instead of a spread of `find(...)!` (which made `{}` and took
                                    the whole route down through `name.replace`) */}
                                {
                                  (() => {
                                    const hit = data.players.find((p) => p.id === l.id);
                                    return (
                                      <PlayerAvatar
                                        player={{ name: l.name, photo: l.photo, teamId: hit?.teamId ?? "" }}
                                        size={22}
                                      />
                                    );
                                  })()
                                }
                                <span>{l.name}</span>
                              </Link>
                            </td>
                            <td className="r num">{l.row.g ?? 0}</td>
                            <td className="r num">{l.row.a ?? 0}</td>
                            <td className="r num strong">{(l.row.g ?? 0) + (l.row.a ?? 0)}</td>
                            <td className="r num">{l.row.gb ?? 0}</td>
                            <td className="r num">{l.row.ct ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted small" style={{ padding: "4px 18px 16px" }}>
                    {boxError ? (
                      <>
                        The box score didn't load.{" "}
                        <button className="link-btn" onClick={() => setBoxAttempt((n) => n + 1)}>
                          Try again
                        </button>
                      </>
                    ) : (
                      "No box score for this side."
                    )}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <div className="table-note">
        Assembled from each player&apos;s own game log, so only players in this database appear —
        this is not the official full box score.
      </div>
    </div>
  );
}
