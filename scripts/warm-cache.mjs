#!/usr/bin/env node
/**
 * Warm the edge cache for every page route.
 *
 * The slice endpoints cache at the edge for five minutes and serve stale for ten, but nothing was
 * re-requesting them between deploys — so the entry expired, and the next visitor met a cold
 * function instance (21 s on /home, measured). This asks for each route once: the first request
 * after a deploy stores the entry, every request inside the window is a hit.
 *
 * Run after a deploy (scripts/deploy-netlify.py does it) and on a ten-minute cron. Ten minutes is
 * chosen, not guessed: inside the 300 s + 600 s stale-while-revalidate window a request is always
 * answered without a cold instance, and the revalidation keeps the instance itself warm.
 *
 *   node scripts/warm-cache.mjs                warm the live site
 *   node scripts/warm-cache.mjs --base https://deploy-preview-1--laxdb.netlify.app
 *   node scripts/warm-cache.mjs --quiet        one summary line (for cron)
 *   node scripts/warm-cache.mjs --refresh      ask the edge to re-store, not to serve what it has
 *   node scripts/warm-cache.mjs --home         only the landing page
 *   node scripts/warm-cache.mjs --routes=/home,/history,/leaders   the five-minute cron
 *
 * `--home` exists because the instance, not the entry, is the thing that expires: measured at 04:12,
 * six minutes after a full warm, `/home` still took 17.9 s — the function had been recycled. One
 * request every five minutes holds the instance the whole site shares, at ~8.6k invocations a month
 * instead of the ~30k a full sweep every ten minutes would cost.
 */
const args = process.argv.slice(2);
const flag = (name) => {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
};
const BASE = (flag("--base") ?? process.env.LAXDB_SITE ?? "https://laxdb.netlify.app").replace(/\/$/, "");
const quiet = args.includes("--quiet");
/** After a deploy the edge may still hold the previous build for one TTL; --refresh stores this one. */
const refresh = args.includes("--refresh");
const headers = refresh
  ? { "cache-control": "no-cache", "accept-encoding": "br, gzip" }
  : { "accept-encoding": "br, gzip" };

/** The routes the client maps to /data/page. `/players` is query-driven and is not warmed. */
const ALL = ["/home", "/leagues", "/teams", "/coaches", "/leaders", "/history", "/origins"];
const picked = (flag("--routes") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
const ROUTES = args.includes("--home") ? ["/home"] : picked.length ? picked : ALL;

const kb = (n) => `${Math.round(n / 1024)} KB`;
const tally = { hit: 0, stale: 0, miss: 0 };
let failures = 0;

for (const route of ROUTES) {
  const url = `${BASE}/data/page?path=${encodeURIComponent(route)}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { headers });
    const body = await res.text();
    const ms = Date.now() - started;
    const state = (res.headers.get("cache-status") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.includes("Edge"))
      .map((s) => (s.includes("hit") ? "hit" : s.includes("stale") ? "stale" : "miss"))[0] ?? "?";
    tally[state] = (tally[state] ?? 0) + 1;
    if (!res.ok) failures += 1;
    if (!quiet) {
      console.log(
        `${res.ok ? "ok  " : "FAIL"} ${route.padEnd(9)} ${String(ms).padStart(5)} ms  ` +
          `${kb(body.length).padStart(7)}  ${state}`,
      );
    }
  } catch (err) {
    failures += 1;
    if (!quiet) console.log(`FAIL ${route.padEnd(9)} ${String(err?.message ?? err).split("\n")[0]}`);
  }
}

/* A "stale" is the healthy steady state: the edge answers instantly while it revalidates, so the
 * visitor never waits on a cold instance. Only a miss means this run paid for a store. */
const summary =
  `warm: ${ROUTES.length} routes — ${tally.hit} hit, ${tally.stale} stale, ${tally.miss} miss` +
  (failures ? `, ${failures} failed` : "");
console.log(quiet || failures ? summary : `\n${summary}`);
process.exit(failures === ROUTES.length ? 1 : 0);
