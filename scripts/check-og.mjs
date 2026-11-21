#!/usr/bin/env node
/**
 * Prove every share-card shape renders before a deploy.
 *
 * `/og/player/<slug>.png` is generated per request, so a slug that throws would only be discovered by
 * the visitor who shared the link — and a broken card is silent, the unfurler simply falls back to no
 * image. This renders the built bundle in-process (same code the function runs, no browser, no
 * netlify dev) over a sample chosen to cover every branch: all leagues, every team, and for each
 * competition the first player, the longest name, a roster entry with no stat line, a goalie with a
 * save-percentage series, and a one-season career.
 *
 *   node scripts/check-og.mjs          # ~500 cards, a minute
 *   node scripts/check-og.mjs --all    # every player slug (slow, thousands of renders)
 *   node scripts/check-og.mjs --limit 20
 *
 * Exits non-zero on the first failure it reports (all failures are listed, not just the first).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const index = JSON.parse(await readFile(join(ROOT, "netlify/functions/entity-index.json"), "utf8"));
const { default: og } = await import(join(ROOT, "netlify/functions-build/og.mjs"));

const all = process.argv.includes("--all");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;

const players = index.players;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** one player per shape, per competition */
const pickPlayers = () => {
  const chosen = new Set();
  const byLeague = new Map();
  for (const [slug, row] of Object.entries(players)) {
    const league = row[2];
    const seasons = row[7]?.[1] ?? 0;
    const isGoalie = /goalie/i.test(row[3] ?? "");
    const bucket = byLeague.get(league) ?? { any: null, long: null, none: null, goalie: null, one: null };
    if (!bucket.any) bucket.any = slug;
    if (!bucket.long || (row[0]?.length ?? 0) > (players[bucket.long][0]?.length ?? 0)) bucket.long = slug;
    if (!bucket.none && seasons === 0) bucket.none = slug;
    if (!bucket.goalie && isGoalie && row[10]) bucket.goalie = slug;
    if (!bucket.one && seasons === 1) bucket.one = slug;
    byLeague.set(league, bucket);
  }
  for (const bucket of byLeague.values()) for (const slug of Object.values(bucket)) if (slug) chosen.add(slug);
  return [...chosen];
};

const targets = [
  ...Object.keys(index.leagues).map((id) => `/og/league/${id}.png`),
  ...Object.keys(index.teams).map((slug) => `/og/team/${slug}.png`),
  ...(all ? Object.keys(players) : pickPlayers()).map((slug) => `/og/player/${slug}.png`),
].slice(0, limit || undefined);

const failures = [];
let bytes = 0;
let slowest = { path: "", ms: 0 };
const started = Date.now();

for (const [i, path] of targets.entries()) {
  const t = Date.now();
  let status = 0;
  let size = 0;
  let ok = false;
  try {
    const res = await og(new Request(`https://laxdb.netlify.app${path}`));
    status = res.status;
    const body = Buffer.from(await res.arrayBuffer());
    size = body.length;
    ok = status === 200 && body.subarray(0, 4).equals(PNG) && size > 15_000;
    bytes += size;
  } catch (err) {
    failures.push(`${path} — threw ${String(err)}`);
    continue;
  }
  const ms = Date.now() - t;
  if (ms > slowest.ms) slowest = { path, ms };
  if (!ok) failures.push(`${path} — ${status}, ${size} bytes`);
  if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${targets.length}…`);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `cards: ${targets.length - failures.length}/${targets.length} rendered · ` +
    `avg ${Math.round(bytes / Math.max(1, targets.length - failures.length) / 1024)} KB · ` +
    `${secs}s · slowest ${slowest.ms}ms (${slowest.path.split("/").pop()})`,
);
if (failures.length) {
  for (const f of failures.slice(0, 20)) console.log("  FAIL " + f);
  console.log(`\n${failures.length} card(s) failed`);
  process.exitCode = 1;
}
