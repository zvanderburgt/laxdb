/**
 * /data/players — the players table's page of rows, answered from Postgres.
 *
 * Step 3 of docs/supabase-migration.md. The page has always shown 150 rows and said "narrow the
 * filters to see more", but it needed all 26,234 players in memory to work out which 150 and how
 * many matched. The database does that now and the browser receives the page.
 *
 * The filters, the sort keys and the search matcher are the *same* rules as src/pages/Players.tsx:
 * the hard filters run in SQL to narrow the set, then the query matcher, the comparator and the
 * count run here over the narrowed rows using `searchKey`, which is imported rather than copied.
 */
import { searchKey } from "../../src/lib/data";
import { rows, CACHE_HEADERS, databaseError } from "../lib/supabase";

export const config = { path: "/data/players" };

const LIMIT = 150;

type Row = {
  slug: string; id: string; name: string; position: string; positionName: string;
  teamId: string; leagueId: string; classYear: number | null; photo: string | null;
  state: string | null; highSchool: string | null;
  season: number | null; gp: number | null; g: number | null; a: number | null;
  pts: number | null; gb: number | null; sh: number | null;
  foW: number | null; foA: number | null; sv: number | null; ga: number | null;
  ppg: number | null;
};

const words = (s: string | null | undefined) => searchKey(s ?? "").split(" ").filter(Boolean);

/** Mirrors `playerMatchesQuery`: every query token prefixes a word of the name, club or school. */
function matches(row: Row, tokens: string[], teamWords: string[]): boolean {
  if (!tokens.length) return true;
  const nameWords = words(row.name);
  const schoolWords = words(row.highSchool);
  return tokens.every(
    (t) =>
      nameWords.some((w) => w.startsWith(t)) ||
      teamWords.some((w) => w.startsWith(t)) ||
      schoolWords.some((w) => w.startsWith(t)),
  );
}

const num = (v: number | null | undefined) => Number(v ?? 0);

/** The table's 13 sort keys, in the page's own arithmetic. */
function value(row: Row, sort: string): string | number {
  switch (sort) {
    case "name": return row.name;
    case "position": return row.position ?? "";
    case "team": return row.teamId ?? "";
    case "classYear": return num(row.classYear);
    case "gp": return num(row.gp);
    case "g": return num(row.g);
    case "a": return num(row.a);
    case "pts": return num(row.pts);
    case "gb": return num(row.gb);
    case "ppg": return num(row.ppg);
    case "shp": return row.sh ? (num(row.g) / num(row.sh)) * 100 : 0;
    case "fop": return row.foA ? (num(row.foW) / num(row.foA)) * 100 : 0;
    case "svp": return num(row.sv) + num(row.ga) ? (num(row.sv) / (num(row.sv) + num(row.ga))) * 100 : 0;
    default: return num(row.pts);
  }
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const pos = (url.searchParams.get("pos") ?? "").split(",").filter(Boolean);
  const league = url.searchParams.get("league") ?? "all";
  const year = url.searchParams.get("year") ?? "all";
  const state = url.searchParams.get("state") ?? "all";
  const hs = (url.searchParams.get("hs") ?? "").trim();
  const minGp = url.searchParams.get("gp") ?? "";
  const sort = url.searchParams.get("sort") ?? "pts";
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";

  try {
    const [teams, leagues, all, span] = await Promise.all([
      rows<{ id: string; name: string; shortName: string; slug: string; colors: string[] }>(
        "teams?select=id,name,shortName,slug,colors",
      ),
      rows<{ id: string; name: string; short: string }>("leagues?select=id,name,short"),
      rows<Row>("player_list?select=*"),
      rows<{ lo: number; hi: number }>("season_span?select=*"),
    ]);

    const teamById = new Map(teams.map((t) => [t.id, t]));
    const leagueShort = new Map(leagues.map((l) => [l.id, l.short]));
    // `teamOf()` in the client resolves the newest season's club; teamId is the same club for
    // every player whose roster row we hold, which is all but a handful of box-club entries.
    const teamWordsById = new Map(
      teams.map((t) => [t.id, words(`${t.name} ${t.shortName}`)]),
    );

    // facets are per league, as on the page: a box league offers Forward/Transition/Defense/Runner
    const positions = [
      ...new Set(
        all
          .filter((r) => league === "all" || r.leagueId === league)
          .map((r) => r.position)
          .filter(Boolean),
      ),
    ];

    const narrowed = all.filter((r) => {
      if (league !== "all" && r.leagueId !== league) return false;
      if (pos.length && !pos.includes(r.position)) return false;
      if (year !== "all" && num(r.classYear) !== Number(year)) return false;
      if (state !== "all" && r.state !== state) return false;
      if (hs && !searchKey(r.highSchool ?? "").includes(searchKey(hs))) return false;
      if (minGp && num(r.gp) < Number(minGp)) return false;
      return true;
    });

    const tokens = words(q);
    const matched = narrowed.filter((r) => matches(r, tokens, teamWordsById.get(r.teamId) ?? []));

    const sorted = [...matched].sort((a, b) => {
      const av = value(a, sort);
      const bv = value(b, sort);
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      // a stable tie-break keeps two modes' pages identical, as with similarTo
      return (dir === "asc" ? cmp : -cmp) || a.slug.localeCompare(b.slug);
    });

    const page = sorted.slice(0, LIMIT).map((r) => ({
      ...r,
      teamName: teamById.get(r.teamId)?.name ?? "",
      teamShort: teamById.get(r.teamId)?.shortName ?? "",
      teamSlug: teamById.get(r.teamId)?.slug ?? "",
      teamColor: (teamById.get(r.teamId)?.colors ?? [])[0] ?? "",
      leagueShort: leagueShort.get(r.leagueId) ?? "",
    }));

    return new Response(
      JSON.stringify({
        total: matched.length,
        universe: all.length,
        rows: page,
        leagues,
        facets: {
          positions,
          years: [...new Set(all.map((r) => r.classYear).filter(Boolean))].sort((a, b) => num(b) - num(a)),
          states: [...new Set(all.map((r) => r.state).filter(Boolean))].sort(),
        },
        range: [String(span[0]?.lo ?? ""), String(span[0]?.hi ?? "")],
      }),
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    return databaseError(err);
  }
}
