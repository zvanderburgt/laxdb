/**
 * The dead-page probe: what the built site shows when the database misbehaves.
 *
 * The site reads Postgres through `/data/page`, `/data/player` and `/data/players`. Every route paints
 * a skeleton from the baked seed or IndexedDB and then asks the database for the live copy — so the
 * question this probe answers is: *when that ask fails, what does the visitor see?* It serves `dist`
 * from a fake origin whose `/data/*` is scripted, drives headless Chrome over CDP, and asserts the
 * outcome per failure mode.
 *
 *   node scripts/db-failure-probe.mjs                 # every case, against dist/
 *   node scripts/db-failure-probe.mjs --case hang     # one case
 *   node scripts/db-failure-probe.mjs --shots         # also write a screenshot per case
 *
 * Cases and what each must produce:
 *
 *   ok       /leagues renders real cards, no error panel
 *   slow     /leagues shows a skeleton at 1s, then the cards (not a blank page, not a dead page)
 *   500      the error panel with a working retry — never a bare "Couldn't load" with no way back
 *   502      same (a Netlify timeout / dead upstream answers this, not our JSON)
 *   garbage  a 200 whose body is not the slice — same recoverable panel
 *   hang     a request that never answers — the panel appears within the boot timeout, not never
 *   players  /players shows a table skeleton while its list request is in flight
 *
 * Exit code 1 on any failed case, so it can gate a deploy.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DIST = join(ROOT, "dist");
const FIXTURES = join(ROOT, ".scratch", "db-failure", "fixtures");
const CHROME =
  process.env.CHROME_PATH ??
  "/opt/hermes/tools/chromium-1248/chrome-linux64/chrome";

const argv = process.argv.slice(2);
const only = argv.includes("--case") ? argv[argv.indexOf("--case") + 1] : null;
const shots = argv.includes("--shots");
const SHOT_DIR = join(ROOT, ".scratch", "db-failure", "shots");

/* ------------------------------- the fake origin ------------------------------- */

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".ico": "image/x-icon",
};

function fixture(name) {
  const file = join(FIXTURES, `${name}.json`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** The captured payloads, taken from the live site once and reused. Not committed: they are megabytes. */
const LIVE = process.env.LAXDB_LIVE ?? "https://laxdb.netlify.app";
const WANTED = [
  ["home", "/data/page?path=/home"],
  ["leagues", "/data/page?path=/leagues"],
  ["teams", "/data/page?path=/teams"],
  ["leaders", "/data/page?path=/leaders&league=ncaa-d1&scope=season"],
  ["player", "/data/player?slug=cj-kirst"],
  ["players", "/data/players?sort=pts&dir=desc"],
  // a detail route and a two-club route: their plans are `/team`, `/league` and `/team-set`
  ["team", "/data/page?path=/team&slug=air-force-falcons"],
  ["league", "/data/page?path=/league&id=nf-msl"],
  ["team-set", "/data/page?path=/team-set&slugs=air-force-falcons,ojcll-akwesasne-lightning"],
  ["coaches", "/data/page?path=/coaches"],
  ["scores", "/data/page?path=/scores"],
  ["history", "/data/page?path=/history"],
  ["origins", "/data/page?path=/origins"],
];

async function ensureFixtures() {
  mkdirSync(FIXTURES, { recursive: true });
  for (const [name, path] of WANTED) {
    if (fixture(name)) continue;
    const res = await fetch(LIVE + path);
    if (!res.ok) throw new Error(`capturing ${name} from ${LIVE}${path} answered ${res.status}`);
    writeFileSync(join(FIXTURES, `${name}.json`), await res.text());
    console.log(`captured fixture ${name}`);
  }
}

/** Serve dist plus a scripted database. `data` answers whatever the route asks for. */
function origin(state) {
  const delayMs = () => state.delayMs ?? 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/data/")) {
      const data = state.data;
      if (data === "hang") {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"route":"'); // accepted, never answered: a pooler that stopped draining
        return;
      }
      if (data === "500" || data === "502") {
        res.writeHead(Number(data), { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `supabase ${data} on seasons?select=ord` }));
        return;
      }
      if (data === "garbage") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"error":"no slice for this path"}');
        return;
      }
      if (delayMs()) await new Promise((r) => setTimeout(r, delayMs()));
      const body =
        url.pathname === "/data/player"
          ? fixture("player")
          : url.pathname === "/data/players"
            ? fixture("players")
            : fixture(String(url.searchParams.get("path") ?? "/home").replace(/^\//, ""));
      if (!body) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end('{"error":"no fixture"}');
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body);
      return;
    }
    let rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
    let file = join(DIST, rel);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/* --------------------------------- CDP driver --------------------------------- */

let nextId = 1;
const pending = new Map();

function send(ws, method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: no } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? no(new Error(msg.error.message)) : ok(msg.result);
      }
    };
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error(`cdp socket failed: ${e.message ?? e.type}`));
  });
}

async function launchChrome() {
  if (!existsSync(CHROME)) throw new Error(`no chrome at ${CHROME} (set CHROME_PATH)`);
  const profile = join(tmpdir(), `laxdb-probe-${process.pid}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const proc = spawn(
    CHROME,
    [
      "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
      "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox",
      "--disable-dev-shm-usage", "--hide-scrollbars", "--window-size=1440,1000",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("chrome did not announce a debug port")), 15000);
    proc.stderr.on("data", (chunk) => {
      buf += String(chunk);
      const hit = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (hit) {
        clearTimeout(timer);
        resolve(hit[1]);
      }
    });
    proc.on("exit", (code) => reject(new Error(`chrome exited early (${code})`)));
  });
  const ws = await connect(wsUrl);
  const { targetId } = await send(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send(ws, "Target.attachToTarget", { targetId, flatten: true });
  await send(ws, "Page.enable", {}, sessionId);
  await send(ws, "Runtime.enable", {}, sessionId);
  return { proc, ws, sessionId, profile };
}

async function evaluate(browser, expression) {
  const out = await send(
    browser.ws,
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    browser.sessionId,
  );
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.text ?? "evaluate failed");
  return out.result?.value;
}

/** What the visitor can actually see, as the probe judges it. */
const SNAPSHOT = `(() => {
  const text = document.body.innerText || "";
  const panel = document.querySelector("[data-laxdb-boot-error]");
  const retry = [...document.querySelectorAll("button, a")].map((n) => (n.textContent || "").trim())
    .find((t) => /try again|retry|reload/i.test(t)) || null;
  return {
    text: text.slice(0, 400),
    skel: document.querySelectorAll(".skel").length,
    busy: document.querySelectorAll('[aria-busy="true"]').length,
    panel: !!panel,
    retry,
    nav: !!document.querySelector("header, nav, .nav"),
    cards: document.querySelectorAll(".card").length,
    links: document.querySelectorAll("a[href]").length,
    bodyLength: text.trim().length,
  };
})()`;

async function navigate(browser, url) {
  await send(browser.ws, "Page.navigate", { url }, browser.sessionId);
  await new Promise((r) => setTimeout(r, 120));
}

/**
 * A cold visitor: the site keeps each route's slice in IndexedDB, and a warmed copy paints without a
 * skeleton — which is correct for a revisit and useless for testing the *first* load. Cleared between
 * routes so every sweep case looks at what a new visitor sees.
 */
async function clearStorage(browser, origin) {
  try {
    await send(browser.ws, "Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  } catch {
    /* older chrome needs a browser-level session; the sweep still reports what it saw */
  }
}

async function settle(browser, untilMs, stepMs = 250) {
  const deadline = Date.now() + untilMs;
  let snap = null;
  let best = null;
  while (Date.now() < deadline) {
    snap = await evaluate(browser, SNAPSHOT);
    if (snap.skel === 0 && snap.text.trim().length > 40) return snap; // painted and settled
    best = snap;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return snap ?? best;
}

async function waitFor(browser, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let snap = await evaluate(browser, SNAPSHOT);
  while (Date.now() < deadline) {
    if (predicate(snap)) return snap;
    await new Promise((r) => setTimeout(r, 200));
    snap = await evaluate(browser, SNAPSHOT);
  }
  return snap;
}

async function screenshot(browser, name) {
  if (!shots) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  const { data } = await send(browser.ws, "Page.captureScreenshot", { format: "png" }, browser.sessionId);
  writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(data, "base64"));
}

/* ----------------------------------- cases ----------------------------------- */

const CASES = [
  {
    name: "ok",
    mode: { data: "fixture" },
    path: "/leagues",
    check: (s) => [
      [s.text.includes("competitions"), "real league cards rendered"],
      [!s.panel, "no error panel"],
      [s.skel === 0, "skeleton cleared"],
    ],
  },
  {
    name: "slow",
    mode: { data: "fixture", delayMs: 3000 },
    path: "/leagues",
    // sampled at 1s: the skeleton must be up, because that is the whole indication of loading
    early: async (browser) => {
      await new Promise((r) => setTimeout(r, 1000));
      return evaluate(browser, SNAPSHOT);
    },
    check: (s, early) => [
      [early.skel > 5, `skeleton at 1s while the query is in flight (${early.skel})`],
      [s.text.includes("competitions") && !s.panel, "cards arrived after the wait"],
    ],
    settle: 20000,
  },
  {
    name: "500",
    mode: { data: "500" },
    path: "/leagues",
    check: (s) => [
      [s.panel, "recoverable error panel present"],
      [!!s.retry, `retry control offered (${s.retry})`],
      [s.links >= 2, `a way back is on screen (${s.links} links)`],
      [!s.text.includes("answered 500"), "no raw status text shown to the visitor"],
    ],
    settle: 20000,
  },
  {
    name: "502",
    mode: { data: "502" },
    path: "/teams",
    check: (s) => [
      [s.panel, "recoverable error panel present"],
      [!!s.retry, "retry control offered"],
    ],
    settle: 20000,
  },
  {
    name: "garbage",
    mode: { data: "garbage" },
    path: "/leaders",
    check: (s) => [
      [s.panel, "recoverable error panel present"],
      [!!s.retry, "retry control offered"],
      [!s.text.includes("no data source"), "no internal message shown"],
    ],
    settle: 20000,
  },
  {
    name: "hang",
    mode: { data: "hang" },
    path: "/teams",
    check: (s) => [
      [s.panel, "timeout ends in the error panel, not an eternal skeleton"],
      [!!s.retry, "retry control offered"],
    ],
    settle: 20000,
  },
  {
    name: "retry",
    mode: { data: "500" },
    path: "/leagues",
    check: (s) => [[s.panel && !!s.retry, "the failure offers a retry"]],
    settle: 20000,
    // the database comes back, the visitor presses the button: the page must recover in place,
    // without a manual reload and without leaving the route
    after: async (browser, set, snap) => {
      if (!snap.panel) return [[false, "panel appeared before the retry"]];
      set({ data: "fixture" });
      const clicked = await evaluate(
        browser,
        `(() => {
          const b = [...document.querySelectorAll("button")].find((n) => /try again/i.test(n.textContent || ""));
          if (b) b.click();
          return !!b;
        })()`,
      );
      const after = await waitFor(browser, (s) => s.text.includes("competitions") || s.panel, 15000);
      return [
        [clicked, "Retry clicked"],
        [after.text.includes("competitions") && !after.panel, "the page recovered in place once the database answered"],
      ];
    },
  },
  {
    name: "stale",
    mode: { data: "fixture" },
    path: "/leagues",
    check: (s) => [[s.text.includes("competitions"), "first load rendered and cached"]],
    settle: 20000,
    // The revisit while the database is down: a stored copy is already in IndexedDB, and the failed
    // revalidation must cost freshness, not the page. This is the case a returning visitor hits most.
    after: async (browser, set) => {
      const here = await evaluate(browser, "window.location.href");
      set({ data: "500" });
      await navigate(browser, here);
      const after = await waitFor(browser, (s) => s.text.includes("competitions") || s.panel, 15000);
      return [
        [!after.panel, "a failed revalidation does not replace the stored copy"],
        [after.text.includes("competitions"), "the cached page is still on screen"],
      ];
    },
  },
  {
    name: "skeleton",
    mode: { data: "fixture", delayMs: 2500 },
    // every route that reads the database: each must show its own loading state while the query is
    // in flight, then real content — never a blank page, never the empty state, never the panel
    routes: [
      "/", "/players", "/teams", "/leagues", "/coaches", "/scores", "/leaders",
      "/history", "/origins", "/player/cj-kirst", "/team/air-force-falcons",
      "/league/nf-msl", "/vs/air-force-falcons/ojcll-akwesasne-lightning",
    ],
    early: async (browser) => {
      await new Promise((r) => setTimeout(r, 900));
      return evaluate(browser, SNAPSHOT);
    },
    check: (s, early) => [
      [
        early.skel > 0 || early.busy > 0 || early.bodyLength > 800,
        `something on screen at 900ms (skel ${early.skel ?? 0}, busy ${early.busy ?? 0}, text ${early.bodyLength ?? 0})`,
      ],
      [!s.panel, "no error panel"],
      [s.bodyLength > 300, `content rendered (${s.bodyLength} chars)`],
    ],
    settle: 20000,
  },
  {
    name: "players",
    mode: { data: "fixture", delayMs: 2500 },
    path: "/players",
    early: async (browser) => {
      await new Promise((r) => setTimeout(r, 1200));
      return evaluate(browser, SNAPSHOT);
    },
    check: (s, early) => [
      [early.skel > 3 || early.busy > 0, `loading indication while the list is in flight (skel ${early.skel})`],
      [!early.text.includes("No players match"), "not the empty state while loading"],
      [s.bodyLength > 200 && !s.panel, "rows arrived"],
    ],
    settle: 20000,
  },
];

/* ----------------------------------- runner ---------------------------------- */

function lineup(result, name) {
  const pass = result.every(([ok]) => ok);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  for (const [ok, label] of result) console.log(`        ${ok ? "·" : "✗"} ${label}`);
  return pass;
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("dist/ is missing — run `npm run build` first");
    process.exit(2);
  }
  await ensureFixtures();

  const browser = await launchChrome();
  let failed = 0;
  try {
    for (const c of CASES) {
      if (only && c.name !== only) continue;
      const state = { ...c.mode };
      const { server, port } = await origin(state);
      try {
        for (const path of c.routes ?? [c.path]) {
          const base = `http://127.0.0.1:${port}`;
          await clearStorage(browser, base);
          await navigate(browser, base + path);
          const early = c.early ? await c.early(browser) : null;
          const snap = await (c.early
            ? waitFor(browser, (s) => ((s.skel === 0 && s.bodyLength > 40) || s.panel), c.settle ?? 15000)
            : waitFor(browser, (s) => ((s.skel === 0 && s.bodyLength > 40) || s.panel), c.settle ?? 15000));
          let results = c.check(snap, early);
          if (c.after) results = [...results, ...(await c.after(browser, (patch) => Object.assign(state, patch), snap))];
          await screenshot(browser, c.routes ? `${c.name}${path.replace(/\//g, "-") || "-home"}` : c.name);
          const label = `${c.name} ${path} (${c.mode.data}${c.mode.delayMs ? ` +${c.mode.delayMs}ms` : ""})`;
          if (!lineup(results, label)) failed += 1;
          if (process.env.PROBE_VERBOSE) console.log("        seen:", JSON.stringify(snap).slice(0, 400));
        }
      } finally {
        server.close();
      }
    }
  } finally {
    try { await send(browser.ws, "Browser.close"); } catch { /* already gone */ }
    browser.proc.kill("SIGKILL");
    rmSync(browser.profile, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} case(s) failed` : "\nall cases passed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
