# Improvement scan — 2026-11-14

Every finding was measured on the live build, on `public/data.json`, or by reading the code. Numbers
are from this tree: 21,943 players, 473 teams, 19 competitions, 34,943 player-seasons.
`npx tsc --noEmit` is clean.

**Status:** items 1–6 shipped and are live. What is still open is in the second pass, including the
one finding that outranks everything left — the site is invisible to crawlers and chat previews.

---

## Shipped in this pass

### 1. Search broke on punctuation and ranked by substring ✅

`searchPlayers()` compared raw lowercased strings, and the palette added a team/`highSchool`
`includes()` branch at score 20. Measured in the real palette (⌘K), 1440×900:

| Query | Before | After |
| --- | --- | --- |
| `oneill` | **0 results** — the apostrophe was required | Brennan, Conor, Jack, Kevin, Mac O'Neill |
| `o'neill` | 6 O'Neills | 6 (unchanged) |
| `c j kirst` | 0 | CJ Kirst |
| `mount st marys` | 0 (the club is "Mount St. Mary's") | the Mount St. Mary's roster |
| `teat` | 3 Teats **+ 3 strangers** — the `highSchool` branch matched "**S**tate" in "Penn State" | 2 Teats, no noise |

Fix in `src/lib/data.ts`: `searchKey()` strips punctuation before comparing (an apostrophe disappears
rather than splitting the word), the query tokenises and every token must prefix a word of the name,
and a name hit is never padded out with club or school matches. `playerMatchesQuery()` reads the same
index, so the table's name box and the palette cannot disagree. Club and school still answer when no
name matches (`mount st marys`). Cost over 21,943 players: ~230 ms on the first keystroke (index
build), 40–60 ms after.

### 2. Three "suggested players" lists were dataset order ✅

All three ranked on `awards` / `rankings`, empty for every player, so they fell through to array order:

| Surface | Before | After |
| --- | --- | --- |
| Home feature strip | Dyson Williams 33 PTS, Ben Trumble 7, **Dante Bowen 0 PTS**, Bowie Horsman 4 | Louis Perfetto 93 PTS ’24, Nate Kabiri 87 ’26, Jeff Teat 64 ’24, Michael Sowers 51 ’26 |
| Compare, "start from one of these" | Luke Robinson, Adam Thistlethwaite, Connor Kelly, Carter Page | the same four as above |
| ⌘K empty state | the same five arbitrary names | Perfetto, Kabiri, Teat, Sowers, Dhane Smith |

One picker (`notablePlayers()` in `data.ts`) now serves the hero carousel, the home strip, Compare and
the palette: peak season, a real sample, headshot preferred, and ranked **inside the competition** —
before that scope fix the hero was showing a Junior B summer peak (129 PTS) as a D1 scorer, because it
sorted on career peak across every league. The strip now labels the season it quotes.
`careerScore()` in `Home.tsx` (defined, never called) is gone.

### 3. Honours were half-wired ✅ — and the first version of this section was wrong

Correction: the All-America join already existed. `allAmericansFor()` was implemented, the Awards tab
rendered it, and team pages carried an "All-Americans" card. What was actually broken:

- **Tewaaraton winners were on `#/history` and nowhere else.** 25 winners, 14 match a profile; they now
  appear on the Awards timeline and as a hero tag.
- **All-America matching compared only the player's *current* club**, so anyone who transferred lost
  the honour. Matching over the whole career takes coverage from **118 players to 201** (281 selections).
- **Nothing said "All-American" until you opened the tab.** The hero now carries `Tewaaraton ’25` and
  `All-American · 1st Team, ’26` tags that jump to the Awards tab.
- **The home page promised "draft and recruiting rankings, and graded scouting notes"** — `draft`,
  `rankings`, `scouting`, `bio`, `strengths` and `experience` are 0% populated. The copy now promises
  what exists.

### 4. The record book printed 40% of itself ✅

`History.tsx` sliced every board to 12 rows (block list and table both) with no control and no note:
**156 of 388 rows** were unreachable. Each board now has "Show all N rows", resetting on scope/metric
change, and the titles-by-program table still shows the top 12 of 23 by design.

### 5. Roster-only profiles looked like a failed import ✅

**411 players** (1.9%) have `gp: 0` on every season — roster entries whose league publishes no stat
line (OSL 93, WCJLL 70, MCLA 68, RMJRB T2 49, TOJLL 41). `/player/dylan-price` drew an empty
"Points by season" chart beside a summary of zeros. The chart is hidden now and the hero says
"Roster entry — no stat line was published for Dylan in 2026."

### 6. Palette accessibility ✅

The ⌘K input is now a real combobox (`role`, `aria-expanded`, `aria-controls`,
`aria-activedescendant`), the results are `listbox`/`option` with `aria-selected`, so a screen reader
follows the arrow keys instead of announcing nothing.

---

## Second pass — what is still missing

### A. Nothing here is crawlable or shareable (biggest gap left)

A database of 21,943 players is invisible to the one system that would send it traffic.

| Probe | Result |
| --- | --- |
| `GET /robots.txt` | **404** |
| `GET /sitemap.xml` | **404** |
| `GET /player/cj-kirst` | **404** — every page is a hash route on `/` |
| `<meta property="og:*">` / `twitter:*` | **0 tags** |
| `<title>` in the served HTML | `LAXDB — Lacrosse player database`, for all 22,435 entities |

`document.title` is set per route by the client: right for a human, useless to Google, Slack, iMessage
or X, none of which run the app. Pasting a player link produces a bare URL with no name, no photo and
no stat line — even though `src/lib/export.ts` already renders a player card PNG.

Path to fixing it, cheapest first:

1. **Static shell** — `robots.txt`, an OG/Twitter card in `index.html` with a site-level image (**S**).
   Makes the site shareable as "LAXDB", not as a player.
2. **Path routing + SPA fallback** — `/player/<slug>` served from `index.html` via a Netlify redirect,
   so a deep link is a real URL (**M**; touches `lib/app.tsx` and every `Link`).
3. **Prerendered entity pages** — one HTML file per player/team/league at build time with its own
   `<title>`, description, `og:image` (the share-card renderer) and a JSON-LD `Person`/`SportsTeam`
   block, plus a 22,435-URL sitemap (**M–L**, but it is the whole SEO surface of the product).

### B. Game pages are orphaned

`#/game/<date>/<home>/<away>` is linked **only** from `#/scores`. A team page links to `/vs/` once and
to zero game pages, though its season-series table already prints the opponent and the date of the last
meeting — every row can become that link. **S**, and it turns a dead-end page into navigation.

### C. Team pages have no schedule

Only a per-opponent series with a last-meeting score, and "Recent seasons" as season totals. A dated
game list is a normal expectation and the data exists: `scores.json` carries D1 and PLL fixtures with
dates, scores and venues. It cannot cover NLL, MCLA or the box leagues (no score feed), so the card
appears only where the data does. **M**.

### D. First paint still carries 18 MB

Cold load, live: `data.json` **1.53 MB brotli / 18.19 MB decoded**, 444 ms on the wire, DCL 911 ms, and
the parse happens before any route paints. Home needs a fraction of it. A `players-index.json` (slug,
name, club, league, position, photo, totals) would let home, players, teams, leaders and search paint
first, with `data.json` following in the background for detail routes. **M** — worth doing before the
dataset grows again rather than after.

### E. Thin by design, not by bug

- **Coach directory** — staff exist for 244 of 473 teams (52%). Half a directory is worse than none
  until the box-league staff pass lands.
- **Conference pages** — 12 D1 conferences of 1–9 teams each (Big South has one club). The league page's
  "By conference" table already shows what a page would.
- **Bios, birth dates, handedness** — 0% bio, 6% dob, 3% hand. That is the `docs/data-gaps.md` work, not
  a UI job.
- **MCLA** is the largest competition by player count (8,301, ahead of D1's 7,142) and publishes no bios
  at any level; the "statistics only" label is the honest answer.

### F. Small things noticed in passing

- `public/history-results.json` (98 KB) is a build input for `scripts/attach-history.py` **and** a
  deployed asset no client fetches.
- The season-series table printed raw ISO dates (`2026-05-23`) beside formatted dates elsewhere — now
  uses `fmtDate`.
- `#/players` caps the table at 150 rows with a note and no pagination, so the only way deeper is to
  narrow the filters.

---

## Verified healthy — no action

- **No horizontal overflow on any route at 390px**: `/`, `/players`, `/teams`, `/leagues`, `/scores`,
  `/leaders`, `/history`, `/origins`, `/compare`, `/my-roster` all report
  `scrollWidth === clientWidth === 390`, and the profile tag row (now with honour tags) fits at 274px.
- **No orphan data**: 0 players with an unresolved `teamId`, 0 teams with no players, 0 duplicate
  `(season, club)` season rows (Garrett Janzen's three 2026 rows are three different clubs).
- **Every route renders without a console error** after the changes, including `/vs/` and `/game/`.
- **Typecheck clean** (`npx tsc --noEmit`) and the build hash matches what Netlify serves.

## Suggested order from here

1. **A1** (robots + OG card) and **B** (link the games) — both small, both visible.
2. **A2/A3** (path routing, prerender) — the only item that changes how much traffic the site can get.
3. **D** (index split) — before the dataset grows again.
4. **C** (team schedule) — next time the D1/PLL score feed is refreshed.
