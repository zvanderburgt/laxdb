/**
 * /data/player?slug=<player-slug> — one player route's data, answered from Postgres.
 *
 * Step 2 of docs/supabase-migration.md: the page asks for its own slice instead of downloading the
 * 13 MB dataset. The work the client used to do by scanning all 26k players — peer ranks, similarity,
 * teammates — is done here, once, and the browser receives about 150 KB instead of 13.19 MB.
 *
 * The three pools are computed by the *same* functions the browser uses (`peerRanks`, `similarTo`,
 * `teammatesOf` semantics), imported from src/lib, so the two modes cannot drift. The browser runs
 * them over `data.players`; this runs them over pools built from Postgres.
 *
 * Reads go through the Data API with the secret key: no Postgres driver in the bundle, no connection
 * pool to keep warm, and the same key the loader already uses.
 */
import type { League, Player, SeasonRow, Team } from "../../src/lib/types";
import { peerRanks } from "../../src/lib/peers";
import { similarTo, type Similar } from "../../src/lib/similar";
import { readFileSync } from "node:fs";

// not /api/*: the admin API registers that wildcard and answers everything else "no such route"
export const config = { path: "/data/player" };

const CACHE_TTL = 5 * 60 * 1000;

/* ---------------------------------- config --------------------------------- */

function env(): { url: string; key: string } {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    // local runs read the gitignored file; a deployed function only ever gets the env vars
    try {
      const raw = readFileSync(process.env.SUPABASE_ENV_FILE ?? "data/supabase-env.txt", "utf8");
      for (const line of raw.split("\n")) {
        const i = line.indexOf("=");
        if (i <= 0) continue;
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k === "SUPABASE_URL") url ??= v;
        if (k === "SUPABASE_SECRET_KEY") key ??= v;
      }
    } catch {
      /* nothing to fall back to */
    }
  }
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY missing");
  return { url: url.replace(/\/$/, ""), key };
}

const { url: API, key: KEY } = env();

/* --------------------------------- fetching -------------------------------- */

const cache = new Map<string, { at: number; rows: any[] }>();

/**
 * PostgREST caps a response at 1000 rows (db-max-rows), and a silent truncation here would change
 * every rank and similarity score on the page. So page until a short response: the pool sizes are
 * known only after the query, and a wrong pool is worse than a slow one.
 */
const PAGE = 1000;

async function rows<T = any>(path: string): Promise<T[]> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.rows as T[];

  const sep = path.includes("?") ? "&" : "?";

  // one cheap call for the count, then the pages in parallel: a 17k-row pool is 17 requests that
  // would cost ~6 s in series and ~1.5 s in parallel
  const head = await fetch(`${API}/rest/v1/${path}${sep}limit=1`, {
    headers: { apikey: KEY, accept: "application/json", prefer: "count=exact" },
  });
  if (!head.ok) {
    throw new Error(`supabase ${head.status} on ${path}: ${(await head.text()).slice(0, 200)}`);
  }
  const total = Number((head.headers.get("content-range") ?? "0-0/0").split("/")[1] ?? 0);
  if (total <= 1) {
    const only = (await head.json()) as T[];
    cache.set(path, { at: Date.now(), rows: only as any[] });
    return only;
  }

  const offsets: number[] = [];
  for (let o = 0; o < total; o += PAGE) offsets.push(o);

  const out: T[] = [];
  const WAVE = 8;
  for (let i = 0; i < offsets.length; i += WAVE) {
    const wave = offsets.slice(i, i + WAVE);
    const pages = await Promise.all(
      wave.map(async (offset) => {
        const res = await fetch(`${API}/rest/v1/${path}${sep}limit=${PAGE}&offset=${offset}`, {
          headers: { apikey: KEY, accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(`supabase ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
        }
        return (await res.json()) as T[];
      }),
    );
    for (const page of pages) out.push(...page);
  }

  cache.set(path, { at: Date.now(), rows: out as any[] });
  return out;
}

/* ------------------------------ player shaping ----------------------------- */
/* A pool member only needs enough to be drawn and to be scored: identity, and one row carrying his
 * career sums, because `careerTotals()` sums `seasons`. */

function careerRow(r: any): SeasonRow {
  return {
    season: "career",
    teamId: r.teamId,
    leagueId: r.leagueId,
    type: "career",
    gp: r.gp, g: r.g, a: r.a, pts: (r.g || 0) + (r.a || 0),
    sh: r.sh, gb: r.gb, to: r.to, ct: r.ct, pen: r.pen,
    sv: r.sv, ga: r.ga, min: r.min, foW: r.foW, foA: r.foA, w: r.w, l: r.l,
  } as unknown as SeasonRow;
}

function mini(r: any): Player {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    firstName: (r.name || "").split(" ")[0] ?? "",
    lastName: (r.name || "").split(" ").slice(1).join(" "),
    position: r.position,
    positionName: r.positionName,
    heightIn: r.heightIn,
    teamId: r.teamId,
    leagueId: r.leagueId,
    photo: r.photo,
    seasons: [careerRow(r)],
  } as unknown as Player;
}

/* ----------------------------------- data ---------------------------------- */

async function slice(slug: string) {
  const [row] = await rows<any>(`players?slug=eq.${encodeURIComponent(slug)}&select=*`);
  if (!row) return null;

  const seasonRows = await rows<any>(
    `seasons?playerSlug=eq.${encodeURIComponent(slug)}&select=*`,
  );
  const player = { ...row, seasons: seasonRows } as unknown as Player;

  const latest = [...seasonRows].map((s) => s.season).sort((a, b) => b - a)[0];

  const [teams, leagues, history, selfCareer] = await Promise.all([
    rows<Team>("teams?select=*"),
    rows<League>("leagues?select=*"),
    rows<{ body: unknown }>("snapshots?key=eq.history&select=body"),
    rows<any>(`player_career?slug=eq.${encodeURIComponent(slug)}&select=*`),
  ]);

  /* peers — one league, one position group, the season being shown. The season rows are what
   * `peerRanks` scores, so they come from `seasons`; identity comes from the career view. */
  const leagueCareer = await rows<any>(
    `player_career?leagueId=eq.${encodeURIComponent(player.leagueId)}&select=*&order=slug`,
  );
  const peerSlugs = leagueCareer.map((c) => c.slug);
  const leagueSeasonRows = peerSlugs.length
    ? await rows<any>(
        `seasons?season=eq.${latest}&playerSlug=in.(${peerSlugs.map(encodeURIComponent).join(",")})` +
          `&select=playerSlug,season,teamId,leagueId,type,gp,g,sv,ga,pts&order=playerSlug,ord`,
      )
    : [];
  // first row per player wins: that is what the client's `.find()` does for a split season
  const seasonBySlug = new Map<string, any>();
  for (const s of leagueSeasonRows) if (!seasonBySlug.has(s.playerSlug)) seasonBySlug.set(s.playerSlug, s);
  const peerPool: Player[] = [];
  for (const c of leagueCareer) {
    const s = seasonBySlug.get(c.slug);
    if (!s) continue;
    peerPool.push({ ...mini(c), seasons: [s as unknown as SeasonRow] } as Player);
  }

  /* similarity — every player in his position group, career sums only (one row each). */
  const groupPositions = similarGroupPositions(player.position);
  const groupCareer = await rows<any>(
    `player_career?position=in.(${groupPositions.join(",")})&select=*&order=slug`,
  );
  const groupPool = groupCareer.map(mini);
  // the player himself must be scored against the same career sums the pool uses
  const self = selfCareer[0] ? mini(selfCareer[0]) : player;

  /* teammates — every roster he shared a club-season with, newest clubs first. */
  const pairs = seasonRows.map((s) => ({ teamId: s.teamId, season: s.season }));
  const mateSlugs = new Set<string>();
  for (const p of pairs) {
    const roster = await rows<any>(
      `seasons?teamId=eq.${encodeURIComponent(p.teamId)}&season=eq.${p.season}` +
        `&select=playerSlug`,
    );
    for (const r of roster) if (r.playerSlug !== slug) mateSlugs.add(r.playerSlug);
  }
  const mateCareer = mateSlugs.size
    ? await rows<any>(`player_career?slug=in.(${[...mateSlugs].map(encodeURIComponent).join(",")})&select=*`)
    : [];
  const mates = mateCareer
    .map(mini)
    .sort((a, b) => (b.seasons[0]?.pts ?? 0) - (a.seasons[0]?.pts ?? 0))
    .slice(0, 60);

  const similar: Similar[] = similarTo(self, 6, groupPool);
  const peers = peerRanks(player, peerPool);

  return {
    generated: new Date().toISOString(),
    player,
    peers,
    similar,
    mates,
    teams,
    leagues,
    history: history[0]?.body ?? null,
    counts: {
      peerPool: peerPool.length,
      groupPool: groupPool.length,
      mates: mates.length,
    },
  };
}

/** The similarity groups are the client's: G, D(D/LSM), M(M/SSDM/F/T/R), A(A/F), FO. */
function similarGroupPositions(position: string): string[] {
  const g = GROUP_OF[position] ?? "M";
  return Object.entries(GROUP_OF)
    .filter(([, v]) => v === g)
    .map(([k]) => k);
}

const GROUP_OF: Record<string, string> = {
  G: "G", D: "D", LSM: "D", M: "M", SSDM: "M", FO: "FO", A: "A", F: "A", T: "M", R: "M",
};

/* --------------------------------- handler -------------------------------- */

export default async function handler(req: Request): Promise<Response> {
  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return new Response(JSON.stringify({ error: "slug required" }), { status: 400 });

  try {
    const body = await slice(slug);
    if (!body) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify(body), {
      headers: {
        "content-type": "application/json",
        // one query per slug per cache window, the pattern meta.ts already uses for the shell
        "netlify-cdn-cache-control": "public, max-age=300, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
