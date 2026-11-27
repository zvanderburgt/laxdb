# LAXDB Front-End Audit Plan

<!--
Drafted by Qwen (qwen4-max, via opencode-go) on 2026-11-27 from a factual brief of this repo.
Harness details in P0 corrected to the repo's real toolchain: scripts/db-failure-probe.mjs drives
Chrome over raw CDP (no puppeteer/playwright dependency), and the live origin is the measurement
target because there is no local Supabase env.
-->

## 1. Scope and non-goals

**This audit owns** what the browser does after bytes arrive: render cost and DOM shape of the `/data/*` payloads, accessibility of the 16 routes plus CompareTray and the CMS overlay, theme/token integrity in `src/styles.css`, responsive behaviour across the 13 declared breakpoints, and implementation integrity of `src/lib/app.tsx` (hand-rolled router), `src/pages/*.tsx` (14 files), `src/components/{Chrome.tsx,ui.tsx,cms/*}`.

**Non-goals:**
- SQL, PostgREST query shape, indexes, N+1, round-trip counts → `docs/perf-route-audit.md`. We record cold/warm TTFB and call counts as *context* for browser findings, never as new query findings.
- Visual/taste critique vs Elite Prospects or LaxGrid → future design pass. `docs/design-notes.md` says shape and depth are borrowed, visuals deliberately are not; pixel comparison is out of scope.
- Fixes. No `src/` edits in this pass. Harness scripts and docs only.
- Re-litigating palette accessibility (already fixed once) — we verify, we don't redesign.
- Adding Playwright, axe CI, or a new test framework. puppeteer/CDP via the `db:probe` harness is the toolchain.

## 2. Dimensions (0–4 each)

Anchors: **0** broken for a whole user class · **1** systemic defects · **2** works, recurring gaps · **3** solid, isolated gaps · **4** measured, no open findings.

| Dim | Concrete checks for this repo |
|---|---|
| Accessibility | Keyboard-only traversal of all 16 routes; focus order and trap/Escape/focus-return in the <1160px menu sheet and the CMS overlay; CompareTray reachability from outside `<main>`; global `:focus-visible` ring (`styles.css:123`) visible against every surface and not clipped by `overflow:hidden` ancestors; correctness (not count) of the 119 `aria-*` attributes — `aria-expanded` on the menu trigger, `aria-current` in nav, table semantics on `/leaders` and `/scores`, live-region announcement of skeleton→content and failure cards; accessible names for headshots painted as CSS background crops (only 2 `<img>` exist); `prefers-reduced-motion` coverage of the 4 blocks vs every animated property. |
| Performance (browser) | Per route: DOM node count, JS heap after settle, long tasks >50 ms, CLS, layout count, image/background-crop decode bytes; `/players` (26,234 players), `/teams` (475), `/leaders`, `/history` — is anything paginated/virtualised or fully materialised? Re-render behaviour on CompareTray add/remove and theme toggle; whether the 66 `useMemo`/`useCallback` sites sit on measured hot paths; duplicate fetches on client-side navigation and under StrictMode; lazy-load cost of the CMS editor when *not* opened. |
| Theming / tokens | 33 custom properties vs 57 literal hex outside the token block: map each literal to a token or flag as orphan; both `data-theme` values resolve every token (no light-only fallbacks); hard-coded colours inside `src/pages/*.tsx` / `ui.tsx` inline styles; contrast sweep in both themes; token naming/semantic layering (surface vs border vs text) and whether one change propagates. |
| Responsive | Sweep at 360, 640, 900, 1159, 1160, 1440 plus ±1px at each declared breakpoint (560/640/700/760/820/860/899/900/980/1000/1040/1160/1200); verify the ten nav links need 1,150px and that collapse at 1160 leaves no 10px overflow window; the 23 separate `@media (max-width: 640px)` blocks — cascade collisions and dead overrides; wide tables on `/leaders`, `/scores`, `/compare`, `/vs/<slugA>/<slugB>` at 360px; horizontal overflow, tap-target size, iOS safe-area, 200% zoom / 320px reflow. |
| Implementation integrity + design-system drift | Router: `document.title` per route, back/forward, scroll restoration, focus reset on navigation, unknown-path block vs HTTP status, `/vs/<slugA>/<slugB>` parsing of hyphenated slugs, `/game/<date>/<home>/<away>` invalid id; sitemap parity with the 16 routes; error boundaries; count of divergent button/card/table/badge implementations in `ui.tsx` vs page-local one-offs; off-scale spacing/radius/shadow values; dead CSS selectors and unused exports. |

## 3. Phases

URL fixtures harvested once from the built `sitemap.xml` plus a crawl of `/scores` and `/leaders` — no invented slugs or ids.

**P0 — Baseline and harness (1.5 h)**
Goal: reproducible runtime rig, no product changes.
`npm ci && npx tsc --noEmit && npm run build && npm run db:probe` (must be green before anything is measured). Build `.scratch/fe-harness.mjs` exporting the probe's hand-rolled CDP driver (`scripts/db-failure-probe.mjs`: `send`/`connect`/`launchChrome` over a raw WebSocket, `--remote-debugging-port=0`) plus navigation/settle helpers — there is no puppeteer or playwright dependency and none gets added. Chrome is `/opt/hermes/tools/chromium-1248/chrome-linux64/chrome`, overridable with `CHROME_PATH`. Also write `.scratch/urls.json` (16 routes, real slugs). Primary origin for every runtime measurement is the live site `https://laxdb.netlify.app` — real data, real brotli, real headers; `netlify dev` only if `netlify env:list` shows the Supabase variables (there is no local `.env`), and any number taken from it is labelled by origin. The probe's fake origin is used only for failure-state re-verification.
Artifacts: `.scratch/urls.json`, `.scratch/fe-harness.mjs`, `.scratch/p0-baseline.txt`.

**P1 — Static inventory (2 h)**
Goal: counts and locations, no runtime claims.
`rg -n '#[0-9a-fA-F]{3,8}' src/ > .scratch/p1-hex.txt`; `rg -n '@media' src/styles.css`; `rg -n 'aria-' src/`; `rg -n 'use(Memo|Callback)' src/`; `rg -n 'style=\{\{' src/`; token block extraction and hex→token mapping table; `npx vite build --mode production` bundle report from the existing build output.
Artifacts: `.scratch/p1-{hex,media,aria,memo,inline,tokens}.txt`, `.scratch/p1-bundle.json`.

**P2 — Route × viewport × theme screenshot sweep (2.5 h)**
Goal: visual state grid.
Build `.scratch/fe-sweep.mjs`: 16 routes × 6 viewports (360, 640, 900, 1159, 1160, 1440) × 2 themes = 192 full-page PNGs, plus `document.documentElement.scrollWidth > innerWidth` and per-route DOM node count logged to CSV. Wait for skeleton→content, not `networkidle0`.
Artifacts: `.scratch/shots/<route>-<w>-<theme>.png`, `.scratch/p2-sweep.csv`.

**P3 — Keyboard-only walk (2.5 h)**
Goal: operability without a mouse.
Build `.scratch/fe-keyboard.mjs`: Tab/Shift-Tab until cycle, log `activeElement` selector + computed outline + bounding box + clipped-by-ancestor test at each stop; scripted Escape/Enter/Space on menu sheet (1159px), CMS overlay toggle, CompareTray add/remove, Retry on a forced failure. Manual pass for screen-reader announcements on `/players` and `/player/<slug>`.
Routes: all 16 at 1440 and 360; overlay/tray on `/players`, `/team/<slug>`, `/compare`.
Artifacts: `.scratch/p3-taborder.json`, `.scratch/p3-keyboard.md`, focus-ring PNGs.

**P4 — Theming and contrast sweep (2 h)**
Goal: both themes provably legible, tokens coherent.
Build `.scratch/fe-contrast.mjs`: walk text nodes, resolve effective foreground/background via CDP `CSS.getMatchedStylesForNode` + ancestor walk, compute ratios at 4.5 / 3.0 (large) / 3.0 (non-text UI), both `data-theme` values, at 360 and 1440. Anything over a background-crop headshot or gradient goes to a pixel-sampling list, not an auto-fail.
Artifacts: `.scratch/p4-contrast.csv`, `.scratch/p4-manual-pixels.md`, `.scratch/p4-token-map.md`.

**P5 — Browser performance (3 h)**
Goal: what the client does with the payload.
Build `.scratch/fe-perf.mjs`: per route, 1 cold + 3 warm loads; record cold TTFB, warm TTFB, compressed transfer per `/data/*` slice, PostgREST call count (context only), DOM nodes, heap, long tasks, CLS via `PerformanceObserver`, decode bytes. Then interaction traces: CompareTray add ×5, theme toggle, client-nav `/players`→`/player/<slug>`→back.
Routes: `/`, `/players`, `/player/<slug>`, `/teams`, `/leagues`, `/leaders`, `/scores`, `/history`, `/compare`, `/game/<date>/<home>/<away>`, `/vs/<slugA>/<slugB>`.
Artifacts: `.scratch/p5-perf.csv`, `.scratch/traces/*.json`.

**P6 — Responsive edge and breakpoint ladder (2 h)**
Goal: no dead zones between 13 breakpoints.
Build `.scratch/fe-breakpoints.mjs`: at each declared breakpoint −1/+1px on `/`, `/players`, `/player/<slug>`, `/leaders`, `/compare`, log nav layout mode, overflow, table scroll container, and any element whose width jumps >20%. Add 320px reflow and 200% zoom shots.
Artifacts: `.scratch/p6-ladder.csv`, `.scratch/shots/edge-*.png`.

**P7 — Implementation integrity and drift (2 h)**
Goal: router and component consistency.
`.scratch/fe-router.mjs`: navigate all 16 routes plus 3 unknown paths, assert title changes, scroll position after back, `activeElement` after nav, fetch count per navigation; malformed `/vs/` and `/game/` inputs. Manual read of `ui.tsx` vs page-local primitives; dead-selector check by matching `styles.css` class names against rendered DOM union from P2.
Artifacts: `.scratch/p7-router.csv`, `.scratch/p7-drift.md`.

**P8 — Synthesis and report (2.5 h)**
Goal: one document, every claim traceable.
Write `docs/frontend-audit.md`; add linked entries to `docs/roadmap.md` **Next**; cross-reference `docs/improvement-scan.md` and `docs/cms.md` instead of duplicating. Re-run `npx tsc --noEmit && npm run build && npm run db:probe` to prove no product change.
Total ≈ 20 h.

## 4. Evidence standard

| Phase | Counts as proof | False positive to avoid |
|---|---|---|
| P1 | `file:line` + count from a re-runnable `rg` | Hex inside comments, SVG data URIs, or the token block itself; 23 media blocks ≠ 23 conflicts |
| P2 | PNG + `scrollWidth`/`innerWidth` numbers at named width | Skeleton-state screenshots; lazy headshots still decoding; scrollbars counted as overflow |
| P3 | `activeElement` sequence + outline computed style + clipped geometry | `:focus-visible` absent under programmatic `.focus()`; intentionally `tabindex=-1` containers; decorative crops beside a text name |
| P4 | Ratio + resolved colour pair + node selector, per theme | Disabled controls; text over image/gradient (needs pixels); mid-transition opacity; already-fixed palette assumptions |
| P5 | Cold/warm TTFB, compressed bytes, node count, long-task duration from a trace on the live origin | Dev-server or fake-origin timings; brotli absent locally; StrictMode double-invoke in dev; skeleton→content counted as CLS; blaming SQL already owned by `perf-route-audit.md`; `useMemo` count as evidence |
| P6 | Width value + before/after measurement at ±1px | Sub-pixel rounding; intentional 899/900 pair; zoom artefacts from device emulation |
| P7 | Fetch log + title/scroll/focus reads across a navigation | Prefetch by design; Netlify serving 200 for unknown paths (hosting, not app) |

Every finding carries the command that reproduces it. No finding without a number, screenshot, or DOM read.

## 5. Severity and report format

- **P0** — a route or core task unusable for a class of users (keyboard trap, unreachable nav, illegible theme, blank render).
- **P1** — major degradation with a workaround (300 ms+ long task on a primary route, 3:1 body text, overflow hiding data at 360px).
- **P2** — localised defect or inconsistency with clear user cost.
- **P3** — hygiene, drift, maintainability.

`docs/frontend-audit.md` sections:
1. **Scorecard** — table: dimension | score 0–4 | one-line justification | evidence file | worst finding ID.
2. **Findings** — `FE-01…`, each: severity · location (`file:line` and/or route+viewport+theme) · category (dimension) · measured impact · WCAG SC where applicable (e.g. 2.1.1, 2.4.7, 1.4.3, 1.4.10, 2.5.8) · recommendation · reproduction command.
3. **Systemic patterns** — causes spanning findings (token bypass, breakpoint sprawl, page-local primitives, un-virtualised lists), each with instance count and affected routes.
4. **Positives** — verified strengths: the `db:probe` skeleton/failure/Retry gate, existing `:focus-visible` ring, reduced-motion blocks, prior palette fix, lazy CMS editor.
5. **Context table** — per-route cold/warm TTFB, compressed bytes, call count, marked *query-layer owned*.
6. **Not audited / deferred** with reasons.

## 6. Ordering rationale and definition of done

Static before runtime (cheap locations inform expensive traces); screenshots before keyboard (know what *should* be focusable); contrast after the token map (so failures are attributed to a token or an orphan hex); performance after visual/keyboard passes so interactions traced are the real ones; breakpoints late because the ladder needs P2's overflow baseline; synthesis last, no fixes interleaved.

**Done when:** all 16 routes captured at 6 viewports × 2 themes; every dimension scored with an evidence path; every finding reproducible from a clean clone via a listed command; `tsc --noEmit`, `npm run build`, `npm run db:probe` green with zero `src/` diff; `docs/frontend-audit.md` written and linked from `docs/roadmap.md` Next; harness scripts re-run by a second invocation producing matching CSVs. Fixes are separate passes, each ending live and verified.

## 7. Risks and likely waste

**Risks:** `netlify dev` against production Postgres adds load — read-only routes, throttled concurrency 1, no writes; CMS overlay is keyboard-gated and lazy — document the exact toggle before P3 or it silently goes unaudited; headshot crops make automated contrast unreliable — budget the manual pixel list; Netlify compression/headers differ locally, so transfer numbers must be labelled by origin.

**Three likely wastes of time:**
1. **Lighthouse chasing and re-timing queries.** Scores against the fake origin or dev server are noise, and `/players` 3.0 s, `/teams` 986 ms, N+1 on `/`, 38 round trips on `/player` are already reported. Measure client-side work only.
2. **Turning the 57 hex / 33 token inventory into a refactor, or comparing visuals to Elite Prospects/LaxGrid.** Map and count; do not design a token migration or a palette in an audit pass.
3. **Exhaustive matrices and low-traffic corners.** 16 routes × 13 breakpoints × 2 themes, pixel-diffing every shot, deep-auditing the gated CMS editor internals, or reviewing all 66 memo sites without a measured re-render. Sample the ladder at ±1px on five representative routes and stop.