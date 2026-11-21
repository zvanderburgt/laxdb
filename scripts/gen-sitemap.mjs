#!/usr/bin/env node
/**
 * Write dist/sitemap.xml: every entity URL we want indexed, and nothing else.
 *
 * The sitemap is deliberately **not** listed in robots.txt — it is submitted through Google
 * Search Console, so the complete URL list is not handed to every crawler that reads the
 * robots file. It is also the only reason a crawler has to find 22k pages: robots.txt allows
 * the search engines and refuses everyone else.
 *
 * `/x/` (the canary) and the dataset files are never included.
 *
 * Usage: node scripts/gen-sitemap.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const SITE = (process.env.SITE_URL || "https://laxdb.netlify.app").replace(/\/$/, "");

const data = JSON.parse(await readFile(join(ROOT, "public/data.json"), "utf8"));
const lastmod = String(data.meta?.generated ?? "").slice(0, 10) || undefined;

const pages = ["/", "/players", "/teams", "/leagues", "/coaches", "/scores", "/leaders", "/history", "/origins"];
const urls = [
  ...pages.map((p) => ({ loc: `${SITE}${p}`, priority: p === "/" ? "1.0" : "0.7" })),
  ...data.players.map((p) => ({ loc: `${SITE}/player/${p.slug}`, priority: "0.8" })),
  ...data.teams.map((t) => ({ loc: `${SITE}/team/${t.slug}`, priority: "0.6" })),
  ...data.leagues.map((l) => ({ loc: `${SITE}/league/${l.id}`, priority: "0.6" })),
];

const body = urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}` +
      `<priority>${u.priority}</priority></url>`,
  )
  .join("\n");

const xml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

await writeFile(join(ROOT, "dist/sitemap.xml"), xml);
console.log(
  `sitemap: ${urls.length} URLs (${data.players.length} players, ${data.teams.length} teams, ` +
    `${data.leagues.length} leagues) → dist/sitemap.xml`,
);
