# Improvement scan — 2026-11-14

Every finding below was measured on the live build (`laxdb.netlify.app`), on `public/data.json`, or by
reading the code — not inferred from a screenshot. Numbers are from this tree (21,943 players, 473
teams, 19 competitions, 34,943 player-seasons). `npx tsc --noEmit` is clean.

Order is by "a visitor sees this today" first, then "cheap feature with data already in the repo".

---

## 1. Search breaks on punctuation and ranks by substring

`searchPlayers()` in `src/lib/data.ts` compares raw `toLowerCase()` strings, and the palette adds a
team/`highSchool` `includes()` branch at score 20.

Measured in the real palette (⌘K), 1440×900:

| Query | Result |
| --- | --- |
| `oneill` | **0 results** — the apostrophe is required (`o'neill` → 6 O'Neills) |
| `oneil` | 0 results |
| `c j kirst` | 0 results |
| `mount st marys` | 0 results (the club is "Mount St. Mary's") |
| `teat` | 3 Teats, then Alex Pyrah / Alexander Bakalov / Austin Loar — the `highSchool` branch matches **"S"tate** inside "Penn State" |

Nobody types the apostrophe, and a name query should never return three strangers. Fix is local and
needs no data: normalise both sides (strip everything but `[a-z0-9 ]`, collapse whitespace) for a
first pass, tokenise the query and require every token to prefix-match a token of the name, rank
name-exact > name-prefix > name-token > club > high school, and drop the club/HS branch when the
query matched any name at all. Same helper feeds `#/players`' name box.

Effort **S**, no new data. Highest ratio in this list.

## 2. Three "suggested players" surfaces are dataset order, not merit

All three rank on fields that are empty for **every one of the 21,943 players** (`awards`,
`rankings`, `draft` = 0% populated), so they fall through to array order:

| Surface | Code | What renders |
| --- | --- | --- |
| Home, "From the box score to the scouting report" visual | `data.players.slice(4, 8)` (`Home.tsx:459`) | Dyson Williams 33 PTS, Ben Trumble 7, **Dante Bowen 0 PTS**, Bowie Horsman 4 |
| Compare empty state, "start from one of these" | `data.players.slice(0, 4)` (`Compare.tsx:117`) | Luke Robinson, Adam Thistlethwaite, Connor Kelly, Carter Page |
| ⌘K empty state | sort by `awards.length + rankings` (`Chrome.tsx:200`) — an all-zero sort | the same five names |

The homepage prints **"0 PTS"** next to a face under a heading about production. `careerScore()`
(`Home.tsx:478`) is dead code — defined, never called.

Fix: one shared `notablePlayers(leagueId, n)` built on the rule the hero carousel already uses
(`Home.tsx:63`: peak season, ≥12 GP, photo preferred). Use it on all three, delete `careerScore`,
and label each use ("Start from", "Recently notable") so it reads as a choice rather than a claim.

Effort **S**, no new data.

## 3. The Awards tab exists and is empty for all 21,943 players

`PlayerPage` ships an `awards` tab and the home copy promises "draft and recruiting rankings, and
graded scouting notes", but `player.awards`, `player.rankings`, `player.draft`, `player.bio`,
`player.strengths` and `player.scouting.*` are **0% populated**. No tab renders, and the copy is a
claim the site cannot back.

The data is already in the repo and unjoined:

- `history.allAmericans` — 4 blocks, **409 rows / 318 distinct names**, and **208 of those names match
  a profile we hold** (D1 2026 81/100, 2025 80/115, 2024 75/98, 2023 55/96). Each row carries
  school + class + position, so the join is `playerByName()` — the same function `History.tsx:238`
  already uses in the other direction.
- `history.tewaaraton` — 25 winners, **13 match a profile** (the rest predate 2022).

So the Awards tab, an "All-American" badge in the player hero and on `#/players` rows, and an "Awards"
filter are all one precompute away from being real for ~208 players. Do it at join time in
`src/lib/data.ts` (not in the importer) so it survives a re-import — the AA blocks are already in
`data.json` and never change between feeds.

Effort **S**, no new scrape. Highest product value left on the list.

## 4. Every record-book board is cut at 12 rows

`History.tsx:67` and `:112` both render `section.rows.slice(0, 12)`, and `:322` slices the titles-by-
program table to 12. The dataset holds **388 rows across 13 boards** — 25 to 60 rows each — so
**156 of 388 rows (40%) are unreachable**, with no "show all" control and no "top 12 of N" note. The
roadmap and screenshots quote "388 rows".

Same for `programs`: 23 programs with titles, 12 shown.

Fix: a `shown` state per board with a "Show all N" button (the Scores page already has this pattern),
plus the row count in the board caption. Effort **S**.

## 5. 411 profiles are all zeros and render empty scaffolding

411 players (1.9%) have `gp: 0` on every season — roster entries whose league publishes no stat line
(OSL 93, WCJLL 70, MCLA 68, RMJRB T2 49, TOJLL 41 …). `/player/dylan-price` renders a "Points by
season" card with an empty chart and a "Season summary" of zeros, no empty state. Every number in the
hero is 0, so the page reads as a failed import rather than "roster entry only".

Fix: when total GP is 0, replace the chart + stats cards with one line —
"Roster entry — <league> published no stats for <season>", and hide the stats tab. Effort **S**.

## 6. Palette a11y

The ⌘K dialog is a `role="dialog"` but the input is a plain `<input>`: no `role="combobox"`,
`aria-expanded`, `aria-controls` or `aria-activedescendant`, and the items carry no `aria-selected`.
Arrow keys move `active` visually while a screen reader announces nothing. Effort **S**.

## 7. First paint carries 18 MB

Measured cold on the live site: `data.json` **1.53 MB brotli / 18.19 MB decoded**, 444 ms on the wire,
DOMContentLoaded 911 ms — and the parse happens before any route renders. On a mid-range phone that
parse is the single biggest cost on the site (the skeleton exists precisely because of it).

The home page only needs name/slug/team/position/photo/peak-stats for its lists; the players table
needs a few more columns; full `seasons[]` + `careerLine` are needed only on a detail route. A
`players-index.json` (slug, name, teamId, leagueId, position, photo, totals, hasBio) would be a few
hundred KB and let the home, players, teams, leaders and search routes paint before the full feed
lands, with `data.json` still fetched in the background for detail routes.

Effort **M** (writer + `normalizePlayer` split + every page's "not loaded yet" path). Worth doing
before the dataset grows again, not urgent today on desktop.

---

## Verified healthy — no action

- **No horizontal overflow on any route at 390px**: `/`, `/players`, `/teams`, `/leagues`, `/scores`,
  `/leaders`, `/history`, `/origins`, `/compare`, `/my-roster` all report
  `scrollWidth === clientWidth === 390` and no element past the right edge outside a deliberate rail.
- **No orphan data**: 0 players with an unresolved `teamId`, 0 teams with no players, 0 duplicate
  `(season, club)` season rows (Garrett Janzen's three 2026 rows are three different clubs).
- **Typecheck clean** (`npx tsc --noEmit`).
- **Cross-links in place**: All-American and record-book rows already link to profiles
  (`History.tsx:70,115,238`); team pages link to `/vs/<slug>/`.

## Worth knowing (not a bug)

- `public/history-results.json` (98 KB) is a **build input** for `scripts/attach-history.py` and is
  also deployed as a public asset no client fetches. Moving it out of `public/` saves 98 KB of deploy
  surface; it changes nothing measurable.
- MCLA is the **biggest league by player count** (8,301, ahead of D1's 7,142) and publishes no bios at
  any level. The "statistics only" label covers it honestly; it is not a parse gap.
- `hand` is 3% populated and the Players table has no hand column or filter — consistent, so nothing
  to fix, but a hand filter would be mostly empty until the GameSheet saves land.

---

## Suggested order

1. **#1 search** and **#2 suggested lists** — a few hours, visible on the first screen a visitor sees.
2. **#3 awards join** — turns a shipped-but-dead tab into real content for 208 players.
3. **#4 record book + #5 zero-GP profiles + #6 palette a11y** — one polish pass, all "S".
4. **#7 index split** — schedule deliberately, before the next data expansion.
