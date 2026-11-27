# Front-end audit — LAXDB

Measured 2026-11-27 against the live deploy (`https://laxdb.netlify.app`, bundle
`assets/index-CAbTbIoK.js`, 410 KB / 121 KB gzip; CSS 83 KB), driving the same headless Chrome the
`db:probe` harness uses (`/opt/hermes/tools/chromium-1248/chrome-linux64/chrome`) over raw CDP. No
`src/` change was made in this pass; the harness and its raw output live in `.scratch/fe-audit/`
(gitignored) and every finding names the script that reproduces it.

The plan this executes is `docs/frontend-audit-plan.md`.

> **Fix pass, same day.** The findings below are the audit as measured. A follow-up pass fixed the
> two P0s and most of the P1/P2 list; the scorecard moved **10/20 → 17/20**. What changed, what is
> still open, and the two defects that only appeared while fixing are in
> [Status after the fix pass](#status-after-the-fix-pass) at the end. The findings themselves are
> left as written, with the measurements that justified them.

## Scorecard

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2/4 | Navigation is unreachable between 1061 and 1160px; menu and CMS overlays never take focus |
| 2 | Performance | 2/4 | Warm loads are 0.15–1.5 s and 14–107 KB, but a slow slice becomes a dead page at 8 s; `/players` paints 9,085 nodes, CLS 0.13 |
| 3 | Theming | 3/4 | 33 tokens, both themes applied before paint, a deliberate position palette with dark inks — but the dark accent token fails text contrast |
| 4 | Responsive | 2/4 | Zero horizontal overflow in 64 passes, but a 100px-wide band of viewports has no navigation at all |
| 5 | Implementation integrity | 1/4 | One non-null assertion over `find()` crashes the game route for every cold visitor |
| **Total** | | **10/20** | **Acceptable — significant work needed** |

## Implementation integrity verdict

**Fail.** The implementation is coherent and product-specific — a hand-rolled router with correct
per-route titles, a token system with an explicit dark palette, three distinct skeleton/failure
states, and a stylesheet that is clearly authored by one hand. But two systemic shortcuts break it
for whole classes of visitors:

1. **A record is assumed to exist.** `Game.tsx` spreads the result of `data.players.find(...)` with a
   non-null assertion into `PlayerAvatar`; when the box-score row's player is not in the loaded
   player set, the spread of `undefined` produces `{}` and `Avatar` calls `.replace()` on an undefined
   name. The route is dead on every cold load (6/6 fresh profiles).
2. **Breakpoints disagree about who owns the navigation.** The nav links hide at ≤1160px and the menu
   trigger appears at ≤1160px, but the sheet the trigger opens is hidden from 1061px up. A 100px band
   of viewports has a nav button that opens nothing.

Neither is a styling opinion; both are contract bugs between a component and its data, and between
one media query and another.

## Executive summary

- Score **10/20** (Acceptable). Findings: **P0 2 · P1 5 · P2 5 · P3 4**.
- Top issues:
  1. **Every game page is dead on a cold visit** — `This page failed to render`, root-caused to
     `Game.tsx:186` + `ui.tsx:25`.
  2. **No navigation between 1061 and 1160px** — `.nav-links` hidden, `.menubtn` shown, sheet
     `display:none` (`styles.css:2657`).
  3. **A slow slice is a dead page** — the client aborts at 8 s with no retry
     (`src/lib/data.ts:474`); four primary routes showed the retry card 16/16 while the page
     functions were cold, and `/history` answered **502 after 30.2 s** twice.
  4. **Dark-mode primary buttons sit at 3.65:1** — white on `--accent` `#0a84ff`.
  5. **The team page's "Season series" card never stops loading** when the box-score rebuild has not
     run (24 skeleton rows, `aria-busy` forever).
- Next steps: fix FE-01 and FE-02 as their own passes with a test each, then FE-03 (deadline/retry)
  and FE-04 (one darker accent step for dark theme). `/impeccable polish` last.

## Findings

### P0 — blocking

#### FE-01 Game pages crash to the error boundary on every cold load
- **Location:** `src/pages/Game.tsx:186` → `src/components/ui.tsx:25-31`
- **Category:** Implementation integrity (also Accessibility: the route is unusable)
- **Evidence:** `.scratch/fe-audit/game-trace.mjs`, `.scratch/fe-audit/game-cold.mjs`,
  `shots/evidence-game-crash-1440.png`
- **Measured:** 6/6 fresh browser profiles render `This page failed to render` (204 chars, 120 DOM
  nodes) at `https://laxdb.netlify.app/game/2026-05-23/princeton-tigers/duke-blue-devils`. Console:
  `TypeError: Cannot read properties of undefined (reading 'replace')` at `Avatar`
  (`ui.tsx:31`), rendered from `PlayerAvatar` inside `Game.tsx`.
- **Cause:** `<PlayerAvatar player={{ ...data.players.find((p) => p.id === l.id)! }} />` — when the
  `/data/page?path=/box` row's `id` is not in the loaded player set, `find` returns `undefined`; the
  spread yields `{}`, `player.name` is `undefined`, and `Avatar` calls `name.replace(...)`.
- **Impact:** every visitor arriving from a shared game link, a search result or a bookmark gets a
  dead page. The error boundary catches it, so the shell survives — the route does not.
- **Recommendation:** build the avatar from the row, not from a lookup that may miss:
  `const p = data.players.find((x) => x.id === l.id); <PlayerAvatar player={{ name: l.name, photo: l.photo, teamId: p?.teamId ?? "" }} />`,
  and make `Avatar` tolerate a missing name (`(name ?? "").replace(...)`) so one bad row cannot take
  a page down.
- **Suggested command:** `/impeccable harden`

#### FE-02 No navigation between 1061px and 1160px
- **Location:** `src/styles.css:2334` (`.nav-links{display:none}` at ≤1160), `:2642`
  (`.menubtn{display:inline-grid}` at ≤1160), `:2657`
  (`@media (min-width:1061px){.mobile-menu,.menu-scrim{display:none}}`)
- **Category:** Responsive / Implementation integrity
- **Evidence:** `.scratch/fe-audit/ladder.mjs` (`ladder.json`), `shots/evidence-nav-1159-menu-open.png`,
  `shots/evidence-nav-1061-menu-open.png`
- **Measured:** at 1060px `nav-links:none`, `menubtn:grid`, sheet `display:block`, link height 46px.
  At **1061px and 1160px** exactly: `nav-links:none`, `menubtn:grid`, click sets `aria-expanded="true"`,
  sheet `display:none`, link height **0**. At 1161px `nav-links:flex`, `menubtn:none`.
- **Impact:** a 100px band — iPad portrait, a half-screen window, a 13" laptop at 125% zoom — has no
  navigation whatsoever. The trigger is present and announces itself as expanded while nothing appears.
- **Recommendation:** make the guard agree with the trigger: `@media (min-width: 1161px)` (or drop
  the rule and let the sheet be hidden by the same query that hides the button).
- **Suggested command:** `/impeccable adapt`

### P1 — major

#### FE-03 An 8-second deadline turns a slow slice into a dead page
- **Location:** `src/lib/data.ts:474` (`SLICE_TIMEOUT_MS = 8000`), `:481-500` (timeouts are not retried)
- **Category:** Performance
- **Evidence:** `.scratch/fe-audit/results.jsonl` (sweep window), `fail-probe.mjs`, curl series below
- **Measured:** during the sweep, `/history`, `/origins`, `/leaders` and `/scores` rendered
  `This page couldn't load its data` in **16/16** route × viewport × theme passes. Cold page slices,
  `accept-encoding: identity`: `/home` **19.1 s**, `/origins` **17.6 s**, `/history` 6.6 s — and
  `/history` answered **HTTP 502** (`The operation was aborted due to timeout`) after **30.2 s** on
  two consecutive requests. The same routes then loaded in 0.5–2.4 s (see “Not audited”).
- **Impact:** the client gives up before the function answers, so the visitor sees a dead page with a
  Retry button instead of content. Retry works (verified), but nothing retries automatically and the
  skeleton never resolves.
- **Recommendation:** this is the query layer's cost showing through (`docs/perf-route-audit.md`
  already ranks these routes), so fix it there; on the front-end, retry a timeout once with a longer
  deadline before showing the failure card, and show elapsed time in the card so a 30 s wait is
  distinguishable from a 1 s one.
- **Suggested command:** `/impeccable harden`

#### FE-04 Dark-theme primary buttons fail contrast at 3.65:1
- **Location:** `src/styles.css:60` (`[data-theme="dark"] --accent: #0a84ff`), `.btn-primary`
- **Category:** Accessibility (WCAG 1.4.3)
- **Evidence:** `.scratch/fe-audit/results.jsonl` → `contrast` rows
- **Measured:** 10 instances across `/`, `/player/<slug>`, `/my-roster`, `/game/...` at 1440 and 360:
  white on `rgb(10,132,255)` = **3.65:1** against a 4.5 requirement at 13–14px/600. Light theme is
  4.53:1 (passes) — the regression is only in dark.
- **Impact:** every primary action — Search, Compare, Try again, Browse players — is below AA in dark
  mode, which is the reading mode most likely to be used at night.
- **Recommendation:** give dark theme its own accent for filled buttons (`#0071e3` clears 4.53 with
  white and is already the light value), keeping `#0a84ff` for links/rings on black.
- **Suggested command:** `/impeccable colorize`

#### FE-05 Team page's "Season series" card never leaves its skeleton
- **Location:** team page, `.standings-card` with `aria-busy="true"` (see `src/pages/Teams.tsx`)
- **Category:** Performance / Implementation integrity
- **Evidence:** `.scratch/fe-audit/game-probe.mjs`, `shots/1440-light-team_mcla-air-force-academy.png`
- **Measured:** `/team/mcla-air-force-academy` never satisfies "no `aria-busy`, no `.skel`" — still
  **24 skeleton rows** and `busy:1` after 20 s, at both viewports and both themes (4/4 passes), while
  the rest of the page is fully painted (1,957 nodes, returning production, franchise history).
- **Impact:** a card that says “Rebuilding from the box scores” and then loads forever reads as a
  broken page — the same failure mode `docs/improvement-scan.md` records for roster-only profiles.
- **Recommendation:** render an explicit empty state after the box-score request settles, with the
  reason (“box scores for this competition are not in yet”) instead of leaving the skeleton mounted.
- **Suggested command:** `/impeccable harden`

#### FE-06 The menu sheet never takes focus, and does not give it back
- **Location:** `src/components/Chrome.tsx:127-160`, `styles.css:2606`
- **Category:** Accessibility (WCAG 2.4.3)
- **Evidence:** `.scratch/fe-audit/keyboard.mjs` → `menuSheet`, `menu-probe.mjs`
- **Measured:** at 1159px, clicking the trigger sets `aria-expanded="true"` and mounts the sheet, but
  `document.activeElement` is `BODY`; `Tab` then walks the page behind the sheet. `Escape` closes it
  (`aria-expanded` back to `false`) and focus is still `BODY` — not the trigger.
- **Impact:** a keyboard user opens the only navigation available and cannot reach it without tabbing
  through the page they just covered.
- **Recommendation:** on open, focus the first sheet link (or the sheet container with
  `tabindex="-1"`), trap Tab inside while it is open, and on close/Escape return focus to the trigger.
- **Suggested command:** `/impeccable harden`

#### FE-07 The CMS overlay is not a dialog
- **Location:** `src/components/cms/` (`.cms-signin`), opened by `⌘⇧E` (`App.tsx:25-38`) or `?edit=1`
- **Category:** Accessibility
- **Evidence:** `.scratch/fe-audit/keyboard.mjs` → `cms`
- **Measured:** with `⌘⇧E`, the overlay mounts (`.cms-signin`) with **no** `role="dialog"`,
  `aria-modal`, label or `aria-labelledby`, and `document.activeElement` stays `BODY`.
- **Impact:** assistive tech never announces that a modal opened, and keyboard focus stays on the page
  underneath it. (The editor's internals were out of scope — this is the entry surface.)
- **Recommendation:** give the overlay `role="dialog" aria-modal="true" aria-labelledby`, focus its
  first control on open, and close on Escape with focus returned.
- **Suggested command:** `/impeccable harden`

### P2 — minor

#### FE-08 `/players` materialises the whole list
- **Location:** `src/pages/Players.tsx`
- **Evidence:** `results.jsonl` (`nodes`), `perf.json`
- **Measured:** **9,085 DOM nodes** at 1440 and at 360 (the 300-row page plus every cell); CLS
  **0.075–0.13** on load; one 96–117 ms long task. `/coaches` 7,741 and `/league/<id>` 7,367 nodes.
- **Impact:** visible layout shift on first paint and a main-thread stall on the route most likely to
  be the entry point from search.
- **Recommendation:** paginate or virtualise the rows (the slice already supports a limit), and
  reserve the table's height so the load does not shift the page.
- **Suggested command:** `/impeccable optimize`

#### FE-09 Malformed game/head-to-head URLs render the data-failure page
- **Location:** `src/App.tsx:64-104` (routing), boot failure path in `src/main.tsx`
- **Evidence:** `router.json` → `unknown`
- **Measured:** `/vs/duke-blue-devils` (one slug), `/vs/a/b/c` (three), `/game/2026-01-01/a/b` (bogus
  teams) all render **“This page couldn't load its data”** with `document.title` left at the home
  title, instead of a not-found page. Unknown `/player`, `/team` and `/league` slugs do render proper
  named not-found pages.
- **Impact:** a stale share link reads as a site outage, and the tab title claims the visitor is home.
- **Recommendation:** validate segment count and slug existence before fetching; render the same
  `Empty` pattern the player route uses.
- **Suggested command:** `/impeccable harden`

#### FE-10 Client-side navigation announces nothing
- **Location:** `src/lib/app.tsx` (router), `src/App.tsx:70-72` (title effect)
- **Evidence:** `router.json` → `history`
- **Measured:** clicking a player from `/players` leaves `document.activeElement` on `BODY` and
  `scrollY` 0; the title became **`Player · LAXDB`** instead of the player's name (the `playerBySlug`
  lookup missed), while a direct load of the same URL titles correctly.
- **Impact:** screen-reader and keyboard users get no signal that the page changed, and the tab/history
  entry loses the identity the direct load provides.
- **Recommendation:** move focus to `<main>` (or an `h1` with `tabindex="-1"`) on path change and drop
  the `playerBySlug` dependency from the title fallback.
- **Suggested command:** `/impeccable harden`

#### FE-11 League pills sit 0.01 under AA
- **Location:** `styles.css` `.league-pill` / `.t2` palette
- **Evidence:** `results.jsonl` → contrast rows
- **Measured:** 32 instances (`/`, `/leagues`, light theme, both viewports): `rgb(106,76,240)` on
  `rgb(236,232,254)` = **4.49:1** at 11px/600 against a 4.5 requirement.
- **Impact:** borderline rather than broken — but it is a systematic pair, so the same failure will
  recur for every new league that lands in that tint.
- **Recommendation:** darken that one palette ink by one step (`#6446e6` clears 4.7) or raise the pill's
  size/weight tier.
- **Suggested command:** `/impeccable colorize`

#### FE-12 Reduced motion is a global kill switch
- **Location:** `styles.css:1830-1833` (`* { animation-duration: 0.001ms; transition-duration: 0.001ms }`)
- **Evidence:** static read; `styles.css:2413`, `:2980`, `:3056` add targeted rules
- **Impact:** every state change loses its feedback for these visitors, including ones where motion
  *is* the message (the skeleton shimmer is separately disabled at `:2980`, which is the right call).
- **Recommendation:** keep the targeted blocks, drop the universal one, and give each entry animation a
  `reduce` variant that changes state without travel.
- **Suggested command:** `/impeccable animate`

### P3 — polish

- **FE-13 Breakpoint sprawl.** 53 `@media` blocks over 13 widths; 23 of them are
  `(max-width: 640px)`; four selectors are defined twice in *separate* 640 blocks
  (`.card-toolbar`, `.record-metrics`, `.record-table th, .record-table td`, `.profile-hero-inner`),
  so their outcome depends on block order. Evidence: `p1-static.py` → `selectors_repeated_in_640`.
- **FE-14 Dead CSS candidates.** 41 class names in `styles.css` never appear in a `className` string in
  `src/**/*.tsx` (static heuristic — a dynamic `\`card ${x}\`` can hide a live one). Verify against
  the rendered DOM before deleting. Evidence: `p1-static.py` → `dead_css_candidates`.
- **FE-15 Sitemap omits game pages.** 26,737 URLs across 12 root paths; `/game/*` — the only
  per-fixture URLs — are absent, as are `/compare`, `/my-roster` and `/vs/*` (the last three are
  defensible). Evidence: `router.json` → `sitemap`.
- **FE-16 Partial scroll restoration.** Back from `/player/<slug>` to `/players` restored
  **338px** of a **900px** scroll position. Evidence: `router.json` → `history.back`.

## Systemic patterns

- **Lookups assumed to succeed (3 findings).** FE-01 (`find(...)!` spread), FE-09 (segments assumed
  valid), FE-10 (slug-to-player assumed present for the title). Every one is a place where the app
  trusts an index that is a *slice* of 26,234 players, not the whole set.
- **A card that fails to finish (2).** FE-05 (permanent skeleton), FE-03 (deadline with no retry).
  Both leave a loading state mounted forever; neither shows elapsed time or a reason.
- **Overlay surfaces skip focus (2).** FE-06, FE-07 — both mount correctly and manage state, neither
  moves or returns focus.
- **Breakpoints drift from ownership (1).** FE-02 — 1160 for the trigger, 1061 for the panel.

## Positives (verified, keep these)

- **Failure states are real.** `npm run db:probe` passes every case: skeleton in flight, retryable
  card on 500/502/junk/hang, and Retry recovers. FE-01 and FE-03 are survivable because of it.
- **Titles are right on direct load:** 16/16 routes, including `NCAA Division I · LAXDB` and
  `Lucas Littlejohn · LAXDB`.
- **Named not-found pages** for unknown player, team and league slugs — with the slug quoted back.
- **No horizontal overflow** in 64 route × viewport × theme passes (`scrollWidth === clientWidth`);
  the layout holds at 360 with no clipped controls.
- **Theme before first paint** (`main.tsx:38-44`), 33 tokens, an explicit dark palette including
  per-position inks (`.pos-a` … `.pos-lsm`) with dark overrides — a real system, not an accident.
- **Keyboard reachability holds:** no traps in 8 routes × 2 widths (up to 120 stops walked), the
  global `:focus-visible` ring is present, and search fields show their ring on the wrapper
  (`:focus-within`) rather than the input — which reads correctly, not as a missing indicator.

## Context — payload and time (query layer's cost, not re-audited)

| Slice | Cold TTFB (identity) | Warm TTFB (brotli) | Wire bytes (brotli) |
|---|---|---|---|
| `/home` | 19.1 s | 0.30 s | 61 KB |
| `/origins` | 17.6 s | 0.43 s | 59 KB |
| `/history` | 6.6 s (and 30.2 s → 502, twice) | 1.48 s | 32 KB |
| `/leaders` | 1.4 s | 1.34 s | 107 KB |
| `/coaches` | 0.29 s | 0.34 s | 23 KB |
| `/teams` | 0.19 s | 0.15 s | 18 KB |
| `/scores` | 0.28 s | 0.26 s | 14 KB |

Owned by `docs/perf-route-audit.md`; recorded here only because the 8 s client deadline (FE-03) turns
these numbers into user-visible failure.

## Not audited / limitations

- **No physical device.** Touch was emulated (`Emulation.setTouchEmulationEnabled`), so gestures were
  not exercised on real hardware; sizes and layout were.
- **No screen reader.** Announcements are inferred from roles, labels and focus behaviour, not heard.
- **Cold-cache client timing is per-route approximate.** The app's own IndexedDB cache fills on first
  visit, so DOM/CLS were taken from a fresh browser profile per route while TTFB/payload came from
  curl. The sweep's failures (FE-03) ran with three concurrent headless browsers — worst-case
  concurrency; the same routes loaded in 0.5–2.4 s afterwards, which is why FE-03 is written as a
  deadline problem rather than “these routes are broken”.
- **CMS editor internals** (form, rows, publishing) were not audited — only its entry surface (FE-07).
- **Design/taste critique** against Elite Prospects or LaxGrid was out of scope by plan.

## Reproduction

```bash
cd /opt/data/projects/laxdb
npx tsc --noEmit && npm run build && npm run db:probe      # baseline, all green in this pass
python3 .scratch/fe-audit/p1-static.py                      # token/hex/media inventory
node .scratch/fe-audit/routes.mjs                          # fixtures -> urls.json
node .scratch/fe-audit/sweep.mjs --width 1440 --theme light --shots
node .scratch/fe-audit/keyboard.mjs                        # tab order, menu sheet, CMS entry
node .scratch/fe-audit/ladder.mjs                          # 1060/1061/1160/1161 breakpoint band
node .scratch/fe-audit/router.mjs                          # titles, bad URLs, back/forward, sitemap
node .scratch/fe-audit/game-trace.mjs                      # FE-01 stack trace
```

Each finding's evidence file is named in its entry; `results.jsonl`, `keyboard.json`, `router.json`,
`ladder.json`, `perf.json` and `shots/` are the raw output of the runs above.

## Status after the fix pass

Same day, same harness, after the deploy that serves `assets/index-DkQ9bp2F.js`. Every number below is
from the live site after that deploy, not from a local build.

### Scorecard now

| # | Dimension | Was | Now | What closed |
|---|-----------|-----|-----|-------------|
| 1 | Accessibility | 2 | **4** | Nav reachable in the 1061–1160 band, dark fills at 4.70:1, sheet takes and returns focus, CMS panels are dialogs with focus and Escape, route changes focus `<main>`, and axe finds nothing on WCAG 2.1 A/AA across all 16 routes |
| 2 | Performance | 2 | **3** | A timeout retries once, the team card settles, the list is paged (9,085 → 3,275 nodes), skeleton matches a page of rows (CLS 0.13 → 0.054 at 1440) |
| 3 | Theming | 3 | **4** | Filled surfaces use a token (`--accent-fill`), so dark mode keeps AA without a per-component colour |
| 4 | Responsive | 2 | **3** | 320px reflow and 200% zoom show zero horizontal overflow; the sheet fits at 320; real-device touch still unverified |
| 5 | Implementation integrity | 1 | **3** | The crash, the not-found contract, the page title, game URLs in the sitemap and Back's scroll position are fixed |
| **Total** | | **10/20** | **17/20** | Good — one dimension still weak, three at 4 |

### Closed

- **FE-01 game crash** — `Game.tsx` now builds the avatar from the row (`name`/`photo`) with the
  lookup as a fallback, and `Avatar` tolerates a missing name. Measured after deploy: 46 box rows,
  46 avatars, no error boundary, on a fresh profile.
- **FE-02 navigation band** — the sheet guard moved to `min-width: 1161px`. Measured: sheet opens
  with 46px links at both 1061 and 1160, and focus lands inside it.
- **FE-03 deadline** — `fetchSliceText` retries a timeout once (`8s + 8s`), 4xx still fails at once.
  `db:probe`'s hang case still ends in the retry card (all cases passed).
- **FE-04 dark contrast** — `--accent-fill` (`#0071e3`, hover `#006bd6`) for filled buttons and the
  logo mark; white on it is **4.70:1**, measured on the deployed page.
- **FE-05 team skeleton** — `SeriesCard` distinguishes "not looked yet" from "nothing there" and
  unmounts the skeleton. Measured: 0 `aria-busy`, 0 skeletons, heading rendered.
- **FE-06 menu focus** — opening focuses the first sheet link, Tab wraps inside, Escape closes and
  returns focus to the trigger (measured: `activeElement` back on `.menubtn`).
- **FE-07 CMS panels** — sign-in and field editor are `role="dialog" aria-modal="true"` with a label,
  focus moves to their first control, Escape leaves the surface.
- **FE-08 list size** — 50 rows a page with a pager ("Showing 1–50 of 150"); 3,275 DOM nodes at 1440
  (was 9,085) and 697 at 360; the skeleton now carries 50 rows, taking CLS from 0.13 to 0.054.
- **FE-09 stale links** — a client-only route with no slice paints its own page instead of the boot
  error. Measured: `/vs/duke-blue-devils` renders "Pick two programs" with the title
  `Head to head · LAXDB`; `/game/2026-01-01/a/b` renders the game page's not-found state.
- **FE-10 route change** — focus moves to `<main>` (`tabindex="-1"`, no ring) and the title names the
  player. Measured on a click from `/players`: `activeElement === MAIN`, title
  `Lucas Littlejohn · LAXDB`.
- **FE-11 pill contrast** — `.league-pill.t2` ink `#6a4cf0` → `#6446e6` (4.49 → 4.93 on its tint).
  The light-theme sweep now reports no contrast findings.
- **FE-12 reduced motion** — the global kill keeps `animation-duration: 0.001ms` but no longer zeroes
  transitions. Measured under emulated `prefers-reduced-motion: reduce`: entry animation 0s,
  transition 0.06s.
- **Accessibility, automated** — axe-core 4.10.2 (`WCAG 2.1 A/AA`) over 16 routes: **0 violations**,
  with the scanner validated against injected defects. Evidence: `.scratch/fe-audit/axe.json`.
- **FE-13 duplicates** — the repeated `.card-toolbar` and `.profile-hero-inner` rules are gone and the
  two conflicting `.record-table` rules at 640 collapsed to the one that was winning (23 → 22 blocks).
- **FE-15 sitemap** — game pages are generated from `public/scores.json` with the schedule's own name
  matching: **1,041** `/game/<date>/<home>/<away>` URLs (27,778 total, was 26,737).
- **FE-16 scroll restoration** — positions are remembered per path and restored once the document is
  tall enough. Measured: 900 → 900 on Back (was 338).

### Found while fixing, and fixed

- **FE-17 every player click was a dead end.** A click from `/players` is a push, not a document
  load, so `/player/<slug>` was never requested and `playerBySlug` did not hold the player — the
  profile rendered "Player not found" while the same URL worked when opened directly. Reproduced on
  production, then fixed: `loadPlayerBySlug()` fetches the slice on navigation, and `PlayerPage`
  shows a skeleton until it answers. Not caught by the original audit because it measured route
  loads and titles, not click-through.
- **FE-18 a failed box score looked like a data gap.** `/data/page?path=/box` failing showed "No box
  score for this side", indistinguishable from a fixture with no lines. It now says the box score
  didn't load and offers Try again.

### Still open

- **Cold page slices remain the query layer's cost** (`/home` 19.1 s, `/origins` 17.6 s, `/history`
  one 30.2 s 502). The client no longer gives up at the first 8 s, but a 17 s page is still a 17 s
  page — that fix lives in `docs/perf-route-audit.md`.
- **CLS at 720px is 0.402** (repeatable over five loads; 0 when the observer happens to attach late).
  Two causes, one fixed: the filter bar's pill row is now reserved with nine skeleton pills while the
  facets are in flight (pending bar 84 → 169px, the loaded bar is 176px), which removed the 92px gap.
  What remains is the row height: at 720px a real block row measures ~158px and a page of them is
  **7,910px**, while the generic skeleton card is **1,939px** — 5,971px of movement. The fix is to
  render the pending state as the same block list at the same row height; a first attempt at that
  collapsed to a 2px card and was reverted rather than shipped. At 1440 it is 0.054 and at 360 it is
  0.
- **Dead CSS is not safely removable from a static scan.** 41 class names never appear in a
  `className` string and 221 never appear in the DOM of the 16 default route states — but
  `cards-grid`, `clear-x` and every `cmp-*` show up only under interaction, so the heuristic's false
  positive rate is too high to delete from. Left as-is, deliberately.
- **No real assistive technology and no physical device.** axe-core 4.10.2 reports **zero** WCAG 2.1
  A/AA violations on all 16 routes (validated against injected defects: it catches `button-name`,
  `image-alt` and `link-name`), and the keyboard walk is clean, so the automated half of an
  accessibility audit is done. A human screen-reader session and one physical phone are still the
  remaining evidence — neither is obtainable from this box.
- **22 `@media (max-width: 640px)` blocks** remain, each beside the component it belongs to. Merging
  them is a refactor with visual risk and no measured benefit; the duplicates that actually
  conflicted are gone.

### The gate

`npm run fe:smoke` (`scripts/fe-smoke.mjs`) asserts the fixes against any base URL — 8 checks, 26
assertions, exit code 1 on failure. Run it after `npm run db:probe`; it was green on the deployed
site before this section was written.
