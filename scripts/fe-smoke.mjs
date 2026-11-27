#!/usr/bin/env node
/**
 * Front-end smoke: the invariants the 2026-11-27 audit found broken, asserted against a running site.
 *
 * Unlike `db:probe`, which scripts the database's failures, this drives the real page and checks the
 * things that broke quietly:
 *
 *   1. a game page renders its box score (it used to crash to the error boundary on every cold load)
 *   2. a click from /players opens the profile (it used to land on "Player not found")
 *   3. the menu sheet opens between 1061 and 1160px (it used to be `display:none` there)
 *   4. white text on a primary button clears 4.5:1 in dark theme
 *   5. the team page settles — no skeleton survives the load
 *   6. /players mounts ≤60 rows and offers its pager
 *   7. a stale /vs/ link renders the picker, not a boot error
 *   8. reduced motion stops animations and keeps transitions
 *
 * Usage: node scripts/fe-smoke.mjs [--base https://laxdb.netlify.app] [--only 1,2]
 * Exit code is non-zero when any check fails. No build needed; it reads the served site.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME_PATH ?? "/opt/hermes/tools/chromium-1248/chrome-linux64/chrome";
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf("--" + k);
  return i >= 0 ? argv[i + 1] : d;
};
const BASE = (arg("base", process.env.FE_BASE ?? "https://laxdb.netlify.app")).replace(/\/$/, "");
const ONLY = arg("only", "")
  .split(",")
  .filter(Boolean)
  .map(Number);

let nextId = 1;
const pending = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(ws, method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`cdp timeout: ${method}`));
      }
    }, 45000);
  });
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
    ws.onerror = () => reject(new Error("cdp socket failed"));
  });
}

async function launch({ width = 1440, height = 900 } = {}) {
  if (!existsSync(CHROME)) throw new Error(`no chrome at ${CHROME} (set CHROME_PATH)`);
  const profile = mkdtempSync(join(tmpdir(), "laxdb-fe-smoke-"));
  const proc = spawn(
    CHROME,
    [
      "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
      "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox",
      "--disable-dev-shm-usage", "--hide-scrollbars", "--window-size=1440,900", "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("chrome did not announce a debug port")), 20000);
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
  for (const d of ["Page", "Runtime"]) await send(ws, `${d}.enable`, {}, sessionId);
  const b = { proc, ws, sessionId, profile };
  await send(ws, "Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  return b;
}

async function evaluate(b, expression) {
  const out = await send(b.ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, b.sessionId);
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.text ?? "evaluate failed");
  return out.result?.value;
}

/** Navigate, then wait for the app to settle (no aria-busy skeletons) or the timeout. */
async function goto(b, url, waitMs = 20000) {
  await send(b.ws, "Page.navigate", { url }, b.sessionId);
  const started = Date.now();
  while (Date.now() - started < waitMs) {
    await sleep(1000);
    const state = await evaluate(b, `({ ready: document.readyState,
      busy: document.querySelectorAll('[aria-busy="true"]').length, skel: document.querySelectorAll('.skel').length,
      text: (document.body.innerText||'').trim().length })`).catch(() => null);
    if (state && state.ready === "complete" && state.busy === 0 && state.skel === 0 && state.text > 200) return true;
  }
  return false;
}

async function viewport(b, width, height = 900) {
  await send(b.ws, "Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 480 }, b.sessionId);
}

function close(b) {
  try { b.ws.close(); } catch {}
  try { b.proc.kill("SIGKILL"); } catch {}
  try { rmSync(b.profile, { recursive: true, force: true }); } catch {}
}

const CONTRAST = `(() => {
  const parse = (c) => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const p = m[1].split(/[,\\/ ]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const b = [...document.querySelectorAll('.btn-primary')].map((el) => {
    const cs = getComputedStyle(el); const fg = parse(cs.color); const bg = parse(cs.backgroundColor);
    return fg && bg && bg.a > 0.9 ? Math.round(ratio(fg, bg) * 100) / 100 : null;
  }).filter(Boolean);
  return { min: b.length ? Math.min(...b) : null, n: b.length };
})()`;

const checks = [
  {
    id: 1,
    name: "game page renders its box score",
    async run(b) {
      await viewport(b, 1440, 900);
      await goto(b, `${BASE}/game/2026-05-23/princeton-tigers/duke-blue-devils`, 30000);
      // the fixture's box score is a second request and does not set aria-busy: wait for the table
      const read = () => evaluate(b, `({ fail: /failed to render|couldn't load/i.test(document.body.innerText||''),
        rows: document.querySelectorAll('tbody tr').length, avatars: document.querySelectorAll('.avatar').length,
        empty: /No box score for this side/i.test(document.body.innerText||''),
        boxError: /box score didn't load/i.test(document.body.innerText||'') })`);
      let s = null;
      for (let i = 0; i < 10; i++) {
        s = await read();
        if (s.fail || s.boxError || s.rows > 0 || s.empty) break;
        await sleep(1000);
      }
      // a cold edge can lose the first /box request: one reload is a fair second chance
      if (!s.fail && !s.boxError && s.rows === 0) {
        await goto(b, `${BASE}/game/2026-05-23/princeton-tigers/duke-blue-devils`, 30000);
        for (let i = 0; i < 10; i++) {
          s = await read();
          if (s.fail || s.boxError || s.rows > 0 || s.empty) break;
          await sleep(1000);
        }
      }
      return [
        [!s.fail, "no error boundary or boot error"],
        [!s.boxError, "the box score request answered"],
        [s.rows > 0, `box rows rendered (${s.rows})`],
        [s.avatars >= s.rows, `every row has an avatar (${s.avatars} vs ${s.rows})`],
      ];
    },
  },
  {
    id: 2,
    name: "a player click opens the profile",
    async run(b) {
      await viewport(b, 1440, 900);
      await goto(b, `${BASE}/players`, 30000);
      const s = await evaluate(b, `(async () => {
        const a = document.querySelector('a[href^="/player/"]');
        if (!a) return { ok: false };
        const href = a.getAttribute('href');
        a.click();
        await new Promise(r => setTimeout(r, 3500));
        return { ok: true, href, notFound: /Player not found/i.test(document.body.innerText||''),
          title: document.title, text: (document.body.innerText||'').trim().length };
      })()`);
      return [
        [s.ok, "a row link exists"],
        [s.ok && !s.notFound, "the profile renders, not \"Player not found\""],
        [s.ok && s.text > 600, `profile has content (${s.text} chars)`],
        [s.ok && /· LAXDB$/.test(s.title) && s.title !== "Player · LAXDB", `title names the player ("${s.title}")`],
      ];
    },
  },
  {
    id: 3,
    name: "the menu sheet opens in the 1061–1160 band",
    async run(b) {
      const results = [];
      for (const width of [1061, 1160]) {
        await viewport(b, width, 900);
        await goto(b, `${BASE}/`, 25000);
        const s = await evaluate(b, `(() => {
          const btn = document.querySelector('.menubtn');
          btn?.click();
          const sheet = document.querySelector('.mobile-menu');
          const link = document.querySelector('.mobile-menu a');
          return { btn: !!btn, display: sheet ? getComputedStyle(sheet).display : null,
            linkH: link ? Math.round(link.getBoundingClientRect().height) : 0,
            expanded: btn?.getAttribute('aria-expanded') };
        })()`);
        await sleep(400);
        const after = await evaluate(b, `(() => { const link = document.querySelector('.mobile-menu a');
          return { linkH: link ? Math.round(link.getBoundingClientRect().height) : 0,
            focusIn: document.querySelector('.mobile-menu')?.contains(document.activeElement) ?? false }; })()`);
        results.push([s.btn && after.linkH > 20, `${width}px: sheet opens, links ${after.linkH}px`]);
        results.push([after.focusIn, `${width}px: focus moved into the sheet`]);
      }
      return results;
    },
  },
  {
    id: 4,
    name: "dark primary buttons clear 4.5:1",
    async run(b) {
      await viewport(b, 1440, 900);
      await goto(b, `${BASE}/`, 25000);
      await evaluate(b, `localStorage.setItem('laxdb-theme','dark')`);
      await goto(b, `${BASE}/`, 25000);
      const c = await evaluate(b, CONTRAST);
      return [
        [c.n > 0, `primary buttons measured (${c.n})`],
        [c.min !== null && c.min >= 4.5, `lowest ratio ${c.min}:1`],
      ];
    },
  },
  {
    id: 5,
    name: "the team page settles",
    async run(b) {
      await viewport(b, 1440, 900);
      await goto(b, `${BASE}/team/mcla-air-force-academy`, 30000);
      const s = await evaluate(b, `({ busy: document.querySelectorAll('[aria-busy="true"]').length,
        skel: document.querySelectorAll('.skel').length, h1: document.querySelector('h1')?.textContent?.trim().slice(0,40) })`);
      return [
        [s.busy === 0, `no aria-busy region left (${s.busy})`],
        [s.skel === 0, `no skeleton left (${s.skel})`],
        [!!s.h1, `heading rendered ("${s.h1}")`],
      ];
    },
  },
  {
    id: 6,
    name: "the players list is paged",
    async run(b) {
      await viewport(b, 1440, 900);
      await goto(b, `${BASE}/players`, 30000);
      const s = await evaluate(b, `({ rows: document.querySelectorAll('tbody tr').length, nodes: document.querySelectorAll('*').length,
        pager: !!document.querySelector('.pager'), text: document.querySelector('.pager span')?.textContent?.trim() })`);
      return [
        [s.rows > 0 && s.rows <= 60, `rows mounted ${s.rows} (≤60)`],
        [s.nodes < 5000, `DOM nodes ${s.nodes} (<5000; was 9,085)`],
        [s.pager, `pager present (${s.text ?? "no label"})`],
      ];
    },
  },
  {
    id: 7,
    name: "a stale /vs/ link renders the picker",
    async run(b) {
      await viewport(b, 1440, 900);
      await goto(b, `${BASE}/vs/duke-blue-devils`, 20000);
      const s = await evaluate(b, `({ fail: /couldn't load|failed to render/i.test(document.body.innerText||''),
        picker: /Pick two programs/i.test(document.body.innerText||''), title: document.title })`);
      return [
        [!s.fail, "no boot error"],
        [s.picker, "the picker is on screen"],
        [s.title === "Head to head · LAXDB", `title "${s.title}"`],
      ];
    },
  },
  {
    id: 8,
    name: "reduced motion keeps feedback",
    async run(b) {
      await send(b.ws, "Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }, b.sessionId);
      await viewport(b, 1440, 900);
      await goto(b, `${BASE}/`, 25000);
      const s = await evaluate(b, `(() => {
        const main = document.querySelector('main');
        const btn = document.querySelector('.btn-primary');
        return { matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
          anim: main ? getComputedStyle(main).animationDuration : null,
          trans: btn ? getComputedStyle(btn).transitionDuration : null };
      })()`);
      await send(b.ws, "Emulation.setEmulatedMedia", { features: [] }, b.sessionId);
      return [
        [s.matches, "the reduce query matches"],
        [s.anim === "0s", `entry animation stopped (${s.anim})`],
        [s.trans && s.trans !== "0s", `transition still runs (${s.trans})`],
      ];
    },
  },
];

let browser = null;
const failures = [];
try {
  browser = await launch({ width: 1440, height: 900 });
  for (const c of checks) {
    if (ONLY.length && !ONLY.includes(c.id)) continue;
    console.log(`\n${c.id}. ${c.name}`);
    let results;
    try {
      results = await c.run(browser);
    } catch (err) {
      results = [[false, `threw: ${String(err).slice(0, 160)}`]];
    }
    for (const [ok, label] of results) {
      console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}`);
      if (!ok) failures.push(`${c.id}: ${label}`);
    }
  }
} finally {
  if (browser) close(browser);
}

console.log(`\n${failures.length ? `${failures.length} failure(s):\n - ${failures.join("\n - ")}` : "all checks passed"}`);
process.exit(failures.length ? 1 : 0);
