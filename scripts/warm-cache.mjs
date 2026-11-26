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
 */
const args = process.argv.slice(2);
const flag = (name) => {
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
const ROUTES = ["/home", "/leagues", "/teams", "/coaches", "/leaders", "/history", "/origins"];

const kb = (n) => `${Math.round(n / 1024)} KB`;
let misses = 0;
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
    if (state !== "hit") misses += 1;
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

const summary = `warm: ${ROUTES.length} routes, ${ROUTES.length - misses} hit, ${misses} cold, ${failures} failed`;
console.log(quiet || failures ? summary : `\n${summary}`);
process.exit(failures === ROUTES.length ? 1 : 0);
