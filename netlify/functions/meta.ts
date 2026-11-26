/**
 * Per-entity HTML meta for the routes a search engine or a chat unfurler asks for directly.
 *
 * The app is a client-rendered SPA: without this, `GET /player/cj-kirst` returns the same
 * `<title>` as every other URL, which is why a shared link shows nothing and Google has
 * nothing to rank. This function answers `/player/*`, `/team/*` and `/league/*` with the
 * shell plus that entity's title, description, canonical URL, Open Graph card and JSON-LD.
 *
 * Deliberately **meta only**: the body returned is the ordinary app shell, so what a scraper
 * can lift from an indexed page is a name, a club and one stat line — never the season tables.
 * Those arrive only when the app boots and fetches the dataset, which robots.txt refuses and
 * `_headers` marks noindex.
 *
 * `/x/*` is a canary: robots.txt disallows it and nothing links to it, so a hit is a crawler
 * ignoring robots. Hits are logged (Netlify → Functions → meta → logs) and 404'd.
 *
 * Bundle: scripts/build-functions.mjs inlines the generated entity-index.json, so the
 * function answers without reading the dataset or calling anything.
 */
import index from "./entity-index.json";

type Row = string[];

const SITE = (process.env.URL || "https://laxdb.netlify.app").replace(/\/$/, "");
// every entity gets its own card, drawn by netlify/functions/og.ts; /og.png stays the home card
const OG_IMAGE = `${SITE}/og.png`;

export const config = {
  path: ["/player/*", "/team/*", "/league/*", "/x/*"],
};

const esc = (s: string) =>
  (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * The built shell, fetched on every request.
 *
 * It used to be cached for the life of a warm function, which was wrong in a way that only shows
 * up after a deploy: the cached copy carries the previous build's `assets/index-<hash>.js`, and
 * publishing deletes that file. Every entity page (/player, /team, /league) then answered with a
 * shell whose only script 404s — a blank page — until the instance recycled. `index.html` is 2 KB
 * and edge-served from this site, so per-request is the honest cost.
 */
async function shell(): Promise<string> {
  const res = await fetch(`${SITE}/index.html`, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`shell fetch failed: ${res.status}`);
  // the built shell carries the home page's baked slice; an entity page has no use for 63 KB of it
  return (await res.text()).replace(/<!--seed:start-->[\s\S]*?<!--seed:end-->/, "");
}

type Meta = {
  title: string;
  description: string;
  canonical: string;
  ogType: string;
  /** the entity's own 1200×630 card, when one exists */
  image?: string;
  ld: Record<string, unknown>;
};

function metaFor(pathname: string): Meta | null {
  const [, kind, key] = pathname.split("/");
  const players = (index as { players: Record<string, Row> }).players;
  const teams = (index as { teams: Record<string, Row> }).teams;
  const leagues = (index as { leagues: Record<string, Row> }).leagues;

  if (kind === "player") {
    const row = players[key];
    if (!row) return null;
    const [name, club, league, position, line] = row;
    const description = [position, club && `${club}${league ? ` (${league})` : ""}`, line]
      .filter(Boolean)
      .join(" · ");
    return {
      title: `${name} · ${club || "Player"} · LAXDB`,
      description: `${name} — ${description}. Season-by-season stats, game log and career history on LAXDB.`,
      canonical: `${SITE}/player/${key}`,
      ogType: "profile",
      image: `${SITE}/og/player/${key}.png`,
      ld: {
        "@context": "https://schema.org",
        "@type": "Person",
        name,
        jobTitle: "Lacrosse player",
        url: `${SITE}/player/${key}`,
        ...(club ? { memberOf: { "@type": "SportsTeam", name: club } } : {}),
      },
    };
  }

  if (kind === "team") {
    const row = teams[key];
    if (!row) return null;
    const [name, league, city, record] = row;
    return {
      title: `${name} · LAXDB`,
      description:
        `${name}${league ? ` — ${league}` : ""}${city ? `, ${city}` : ""}. ` +
        `${record ? `Record ${record}. ` : ""}Roster, leaders, staff and season history on LAXDB.`,
      canonical: `${SITE}/team/${key}`,
      ogType: "website",
      image: `${SITE}/og/team/${key}.png`,
      ld: {
        "@context": "https://schema.org",
        "@type": "SportsTeam",
        name,
        sport: "Lacrosse",
        url: `${SITE}/team/${key}`,
        ...(league ? { memberOf: { "@type": "SportsOrganization", name: league } } : {}),
      },
    };
  }

  if (kind === "league") {
    const row = leagues[key];
    if (!row) return null;
    const [name, level, teamCount, playerCount] = row;
    return {
      title: `${name} · LAXDB`,
      description: `${name} — ${level}. ${teamCount} teams, ${playerCount} players. Standings, stat leaders, polls and player profiles on LAXDB.`,
      canonical: `${SITE}/league/${key}`,
      ogType: "website",
      image: `${SITE}/og/league/${key}.png`,
      ld: {
        "@context": "https://schema.org",
        "@type": "SportsOrganization",
        name,
        sport: "Lacrosse",
        url: `${SITE}/league/${key}`,
      },
    };
  }

  return null;
}

function head(m: Meta): string {
  return [
    `<link rel="canonical" href="${esc(m.canonical)}">`,
    `<meta name="robots" content="index,follow,max-image-preview:large">`,
    `<meta property="og:type" content="${m.ogType}">`,
    `<meta property="og:site_name" content="LAXDB">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`,
    `<meta property="og:url" content="${esc(m.canonical)}">`,
    `<meta property="og:image" content="${m.image ?? OG_IMAGE}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(m.title)}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(m.title)}">`,
    `<meta name="twitter:description" content="${esc(m.description)}">`,
    `<meta name="twitter:image" content="${m.image ?? OG_IMAGE}">`,
    `<meta name="twitter:image:alt" content="${esc(m.title)}">`,
    `<script type="application/ld+json">${JSON.stringify(m.ld)}</script>`,
  ].join("\n    ");
}

function render(html: string, m: Meta): string {
  // the shell carries a site-level card; every tag of it has to go, or the unfurler reads
  // the generic title first and the entity's own tags are ignored
  const cleaned = html
    .replace(/<meta (?:property|name)="(?:og:|twitter:)[^"]*"[^>]*>\s*/gi, "")
    .replace(/<meta name="robots"[^>]*>\s*/gi, "")
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(m.title)}</title>`)
    .replace(
      /<meta name="description"[^>]*>/i,
      `<meta name="description" content="${esc(m.description)}">`,
    );
  return cleaned.replace(/<\/head>/i, `    ${head(m)}\n  </head>`);
}

const notFound = (what: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex"><title>Not found · LAXDB</title>` +
      `<link rel="icon" href="data:,"></head><body style="font-family:-apple-system,system-ui;padding:48px;max-width:640px">` +
      `<h1 style="font-size:22px;font-weight:650">${esc(what)}</h1>` +
      `<p style="color:#6e6e73">This page is not in the database.</p>` +
      `<p><a href="/" style="color:#0b6bcb">Back to LAXDB</a></p></body></html>`,
    {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60",
        "x-robots-tag": "noindex, nofollow",
      },
    },
  );

export default async (req: Request, context: { ip?: string; geo?: unknown }) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // canary: disallowed in robots.txt, linked from nowhere. A hit is a bot ignoring rules.
  if (pathname.startsWith("/x/")) {
    console.log(
      JSON.stringify({
        canary: pathname,
        ua: req.headers.get("user-agent") ?? "",
        ip: context?.ip ?? req.headers.get("x-nf-client-connection-ip") ?? "",
        referer: req.headers.get("referer") ?? "",
        at: new Date().toISOString(),
      }),
    );
    return notFound("Not found");
  }

  const meta = metaFor(pathname);
  if (!meta) {
    const [, kind, key] = pathname.split("/");
    return notFound(
      kind === "player"
        ? `No player “${key ?? ""}”`
        : kind === "team"
          ? `No team “${key ?? ""}”`
          : `No competition “${key ?? ""}”`,
    );
  }

  try {
    const html = render(await shell(), meta);
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60, must-revalidate",
        // An edge copy of this HTML names a bundle hash, and the next deploy deletes that bundle —
        // so the CDN must not hold it for long. 60s covers a burst, not a release cycle.
        "netlify-cdn-cache-control": "public, max-age=60, stale-while-revalidate=30",
      },
    });
  } catch (err) {
    console.log(JSON.stringify({ metaError: String(err), pathname }));
    // never answer a page request with a stack trace: the shell alone still renders the app
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><title>LAXDB</title>` +
        `<meta http-equiv="refresh" content="0;url=/"></head><body></body></html>`,
      { status: 302, headers: { location: "/" } },
    );
  }
};
