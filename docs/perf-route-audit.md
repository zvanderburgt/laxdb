# Route performance audit — the SQL behind each page

Measured 2026-11-26 against the live database (`us-east-2`) and the production handlers.

**How.** Every read function was run with `fetch` instrumented: one process per route, counting each
PostgREST call and its response bytes (a per-process cache would otherwise flatter the numbers). Query
cost comes from `EXPLAIN (ANALYZE, FORMAT JSON)` on the SQL each route actually issues.

**What the two columns mean.** *SQL* is time spent inside Postgres — it counts in full wherever the
function runs. *Calls* is round trips; the function runs beside the database in production (~3 ms each)
but this box is ~50 ms away, so local wall time overstates them badly. **Rank by SQL, then by calls.**

| route | endpoint | calls | rows read | SQL | payload |
| --- | --- | --- | --- | --- | --- |
| `/players` | `/data/players` | 33 | **10,524 KB** | **3,090 ms** | 83 KB |
| `/league/<id>` | `/data/page?path=/league` | 14 | 3,123 KB | ~985 ms (8 × 123) | 1,891 KB |
| `/history` | `/data/page?path=/history` | 24 | 2,450 KB | ~1,180 ms (8 × 48 + 9 × 88) | 205 KB |
| `/teams` | `/data/page?path=/teams` | 6 | 137 KB | **986 ms** | 117 KB |
| `/player/<slug>` | `/data/player` | 38 | 1,359 KB | ~120 ms | 523 KB |
| `/leaders` | `/data/page?path=/leaders` | 18 | 1,207 KB | ~170 ms | 910 KB |
| `/` | `/data/page?path=/home` | 51 | 568 KB | ~510 ms | 451 KB |
| `/origins` | `/data/page?path=/origins` | 13 | 521 KB | ~5 ms | 500 KB |
| `/coaches` | `/data/page?path=/coaches` | 12 | 141 KB | ~30 ms | 141 KB |
| `/scores` | `/data/page?path=/snapshot` | 1 | 128 KB | 2 ms | 115 KB |
| `/search` (inline) | `/data/page?path=/search` | 1 | 1 KB | <1 ms | 1 KB |
| `/compare`, `/my-roster`, `/vs/*` | `/data/page?path=/player-set` | 11 | 65 KB | ~10 ms | 37 KB |
| `/game/*` | `/data/page?path=/box` | 1 | — | <5 ms | small |

Routes with no measurable issue: `/leagues` (9 KB, 2 ms), `/scores`, `/search`, `/player-set`,
`/box`, and every `/team/<slug>` read (`team_seasons` + `team_roster` are indexed and small).

## Findings, ranked

### 1. `/players` reads the whole database to draw 150 rows — 3.0 s, 10.5 MB
`netlify/functions/players.ts:84` — `rows("player_list?select=*")` → 26,234 rows, 28 pages, then
filter, tokenise, sort and slice in JS.

`EXPLAIN` on `select * from player_list`: **3,003 ms**, three separate full scans of `seasons`
(53,465 rows each — the view's career sums are computed repeatedly), plus a 190 ms count.

*Measured, not estimated:* a session-local copy of the view (`create temp table … as select * from
player_list`, nothing written to production) reads in **4.4 ms** instead of 3,003 ms, and the exact
page the route wants — `order by pts desc, slug limit 150` — takes **0.2 ms** against the copy versus
**476.6 ms** against the view. A facet `group by` over the copy is 10.2 ms.

*Fix, in two steps that stand alone:*
- **a.** Materialise `player_list` as a table refreshed by the loader (the loader already rewrites
  every table and the `snapshots` pools in one transaction). Same name, same columns, same query —
  `select *` drops to a sequential read of a 26k-row table (~30 ms) with no aggregation.
- **b.** Push the sort, the page window and the count into SQL (`order=<col>.<dir>,slug&limit=150&
  offset=`) and compute the facets with one `group by` per facet. This is what makes the response
  150 rows instead of 26,234 — 10.5 MB of egress becomes ~60 KB.
  The JS comparator's tie-break is `slug` (`players.ts:127`), so the SQL order must end in `slug` to
  keep two modes' pages identical. Facet counts must be recomputed with the same filters the JS uses.

**Gain:** 3.0 s → **4.4 ms** of SQL (0.2 ms for the page itself), 33 calls → ~5, egress 10.5 MB →
~60 KB. **Risk:** (b) is the only change here that touches the client's shape; (a) alone is invisible
and safe.

### 2. `/teams` pays 986 ms for 475 rows
`netlify/functions/page.ts:75` — `team_totals?select=*`. The view sums `seasons` per team and the plan
chooses an index-only scan of all 53,465 season rows twice (`EXPLAIN`: 986 ms).

*Fix:* materialise `team_totals` at load with the rest. It is derived data with no parameters.
**Gain:** 986 ms → **0.1 ms** (measured on a temp copy). **Risk:** none — nothing filters it.

### 3. `/history` name lookups are an unindexed expression, run in 8 chunks
`netlify/functions/page.ts:531` — `player_lookup?key=in.(…)`. `player_lookup.key` is
`regexp_replace(lower(name),'[^a-z]','','g')` and `rank` is a correlated `count(*)` over `seasons` per
player, so each chunk is a **seq scan of all 26,234 players, 48 ms**, recomputing the regexp and the
count for every row. Eight chunks per request: ~390 ms.

*Fix:* materialise `player_lookup` (same definition, computed once at load) and index `key`;
alternatively an expression index on `players (regexp_replace(lower(name),'[^a-z]','','g'))`, which
still leaves the per-row `rank` subquery.
**Gain:** ~390 ms → **~1 ms** (measured: 0.1 ms for three keys against a copied, indexed table, versus
48.4 ms per seq scan today). **Risk:** the list is refreshed only at load, which is when the data
changes anyway.

### 4. `/` builds its hero cards with N+1 reads
`netlify/functions/page.ts:850` and `:867` — for each spotlight pick and each featured player, a
`players?slug=eq.…` and a `seasons?playerSlug=eq.…`, one pair at a time: 12 players, 24 calls, 22 of
them `seasons`.

*Fix:* batch exactly as `playersByKey` already does at `page.ts:655` — one
`seasons?playerSlug=in.(a,b,c)` for all picks, one `players?slug=in.(…)`. The pattern exists in this
codebase; use it.
**Gain:** 24 → 2 calls; ~120 ms of SQL unchanged but ~1.1 s of this box's round trips (≈35 ms in
production). **Risk:** low; the shape of each player object is unchanged.

### 5. `/player/<slug>` is 38 round trips for 120 ms of SQL
`netlify/functions/slice.ts:93-186` — a player, his seasons, career, five `player_career` reads, three
`snapshots`, the roster per teammate. The queries are cheap (index scans, 0-1 ms); the cost is the
count of them.

*Fix:* batch the teammate seasons (`in.(…)`), and drop the `count=exact` round trip (§6). **Gain:**
38 → ~10 calls. **Risk:** low.

### 6. `rows()` asks the database for a row count before every read
`netlify/lib/supabase.ts:73` — `limit=1` with `prefer: count=exact` to learn `total`, then pages. For
a small result that is one wasted round trip; it is the single most repeated request in the codebase
(`/player` alone pays it ~12 times).

*Fix:* page until a short page comes back, and skip the count entirely — the count is only needed to
know how many pages to request. Costs one extra request only when a total is an exact multiple of 1000.
Reads that already pass `limit=` skip it today.
**Gain:** one call off every uncounted read (~30% of calls). **Risk:** low, and `rows()` is one
function.

### 7. `/league/<id>` reads 6,949 rows in 8 pages
`netlify/functions/page.ts:245` — `league_player_current?playerLeague=eq.…&select=*`. `EXPLAIN`:
123 ms. It renders all of them, so the rows are wanted; the width is not (`select=*` carries fields the
page never prints).

*Fix:* name the columns. **Gain:** ~40% of the 3.1 MB. **Risk:** none once the used fields are listed.

### 8. `league_leaderboard` is recomputed per request — 486 ms
The view I added yesterday ranks 18,671 rows with six window functions on every call. One call per
`/home`, so it is behind the seed and rarely felt, but it is the same materialisation candidate.

*Fix:* materialise it at load alongside the other three. **Gain:** 486 ms → ~1 ms, at a one-off
**514 ms** to build during the load (measured).

## What to do, in order

1. **Materialise the four derived views at load** — `player_list`, `team_totals`, `player_lookup`
   (+ index on `key`), `league_leaderboard`. One mechanism, one place (the loader), 4.5 s of SQL off
   the four heaviest routes, no interface change.
2. **Batch the `/home` N+1** with the `in.(…)` pattern already in `playersByKey`.
3. **Drop the count round trip** in `rows()`.
4. **Page `/players` in SQL** — the only change that touches the client's contract, and the one that
   turns 10.5 MB of egress into 60 KB.

Steps 1-3 are invisible to the client and each is a handful of lines. Step 4 is the one to do on its
own, with the parity capture used for the leaderboard change (`/tmp/parity-*` harness) to prove the
table shows the same 150 rows in the same order.

## Not verified

- Cold function instance behaviour (Netlify recycles instances; nothing here depends on it).
- Concurrency: all measurements are single-request.
- Whether `player_list`'s 3 s is worse on a cold Postgres connection — the plan is the same either way,
  and materialising removes the question.
