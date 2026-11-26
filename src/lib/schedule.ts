import type { Team } from "./types";
import { teamByName } from "./data";

/**
 * One fixture as a specific team experienced it.
 *
 * `scores.json` records the official scorecard ("Wagner Seahawks" at home, "Manhattan
 * Jaspers" away) and publishes no venue for the NCAA rows, so everything a team page wants —
 * which side we were, whether we won, who to link — has to be derived from the two names.
 */
export type Fixture = {
  date: string;
  season: string;
  opponent: string;
  /** the opponent's page, when the feed name resolves to a club we hold */
  opponentSlug?: string;
  home: boolean;
  us: number;
  them: number;
  won: boolean;
  venue?: string;
};

export type ScoreRow = { date: string; home: string; away: string; hs: number; as: number; venue?: string };

export type ScorePayload = { d1?: ScoreRow[]; pll?: ScoreRow[] };

/**
 * The scorecard lives in the database now. Six pages read it, so the fetch is shared and memoised;
 * the file remains the fallback for a build that has not migrated yet, and for `?slice=0`.
 */
let scoresPromise: Promise<ScorePayload> | null = null;
export function loadScores(): Promise<ScorePayload> {
  if (!scoresPromise) {
    const base = import.meta.env.BASE_URL;
    scoresPromise = fetch(`${base}data/page?path=/snapshot&key=scores`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        if (d && (Array.isArray(d.d1) || Array.isArray(d.pll))) return d as ScorePayload;
        return fetch(`${base}scores.json`)
          .then((r) => (r.ok ? r.json() : { d1: [], pll: [] }))
          .catch(() => ({ d1: [], pll: [] }));
      });
  }
  return scoresPromise;
}

export const normName = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");

const sameTeam = (feedName: string, team: Team) => {
  const a = normName(feedName);
  if (!a) return false;
  return [team.name, team.shortName, team.slug.replace(/-/g, " ")]
    .map(normName)
    .some((b) => b && (a.startsWith(b) || b.startsWith(a)));
};

/** Every fixture in the payload that involves this team, newest first. */
export function fixturesFor(team: Team, payload: ScorePayload | null): Fixture[] {
  if (!payload) return [];
  const rows = [...(payload.d1 ?? []), ...(payload.pll ?? [])];
  const out: Fixture[] = [];
  for (const g of rows) {
    const isHome = sameTeam(g.home, team);
    const isAway = sameTeam(g.away, team);
    if (!isHome && !isAway) continue;
    const opponent = isHome ? g.away : g.home;
    const oppTeam = teamByName(opponent);
    const us = isHome ? g.hs : g.as;
    const them = isHome ? g.as : g.hs;
    out.push({
      date: g.date,
      season: g.date.slice(0, 4),
      opponent,
      opponentSlug: oppTeam?.slug,
      home: isHome,
      us,
      them,
      won: us > them,
      venue: g.venue,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** `/game/<date>/<home>/<away>` — only when the opponent has a page of its own. */
export function gameHref(f: Fixture, team: Team): string | null {
  if (!f.opponentSlug) return null;
  return f.home
    ? `/game/${f.date}/${team.slug}/${f.opponentSlug}`
    : `/game/${f.date}/${f.opponentSlug}/${team.slug}`;
}

export function seasonRecord(fixtures: Fixture[]) {
  const w = fixtures.filter((f) => f.us > f.them).length;
  const l = fixtures.filter((f) => f.us < f.them).length;
  return { w, l, games: fixtures.length };
}
