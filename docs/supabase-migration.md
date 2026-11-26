# Migration map — the backend onto Supabase

Charted **2026-11-25**. **Steps 1–6 are built and live** — the dataset is in Postgres,
the player route and the players table answer from it *by default*, the similarity pools are
materialised at load, every other route still takes the dataset file, and the CMS now writes to
Postgres (see [Step 1](#step-1-done), [Step 2](#step-2-done), [Step 3](#step-3-done),
[Step 4](#step-4-done-partly), [Step 5](#step-5-the-store-is-done-auth-is-left),
[Step 6](#step-6-done)). The only thing still standing from the old world is the passphrase fallback,
which now goes on request — an emailed sign-in has worked end to end.

**Route coverage — beyond the plan.** The plan moved two routes. Every other route still downloaded
the whole 13.19 MB file, so this is the work that turns "two fast routes" into "a fast site". One
endpoint, `GET /data/page?path=<route>`, with a branch per route; the client keeps a `PAGE_ROUTES` set
in `src/lib/data.ts` and falls through to the dataset file when there is no branch, so a missing slice
is never a broken page.

| route | payload | time to content (1.6 Mbps, cold cache) | parity |
| --- | --- | --- | --- |
| `/leagues` | **2,062 B** (was 1,608,589) | **1.14 s / 1.14 s / 1.15 s** (was 9.66 / 9.67 / 9.74) | head line and all 19 cards identical |
| `/teams` | **18,020 B** (was 1,608,531) | **1.31 s / 1.32 s / 1.33 s** (was 12.01 / 12.54 / 12.78) | head line, all 475 cards, and a card click into the still-dataset-backed `/team/<slug>` |
| `/player/<slug>` (game log) | **71 KB gzipped**, one request (was 1,608,503 B + `games.json`) | **1.51 s / 1.52 s / 1.53 s** (was 9.62 / 9.74 / 9.83) | full page text byte-identical on four players, footer included |
| `/scores` (scorecard) | **118 KB snapshot**, one shared request for six pages | unchanged head line: 569 games across 71 dates | the file is gone from every page that read it — `/scores`, both team cards, `/game`, `/vs`, `/history` |
| `/league/<id>` | **2.2 s at ~1.1 MB** (was 1,608,531 B / 9.73 s) — the payload is the whole competition, which is what the page ranks | **2.25 s / 2.25 s / 2.30 s** (was 9.73 / 9.73 / 9.78) | hero line, the four stats, the standings table and both origin lists, on ncaa-d1 and pll |
| `/leaders` | **97,946 B** season / **210,400 B** career (was 1,608,531) | **1.64 s / 1.66 s / 1.67 s** (was 9.70 / 9.77 / 9.95) | head line, the default board, the career board, a season switch, the Pts-per-game category and the Attack filter, all compared row for row |
| `/coaches` | **23,368 B** (was 1,608,531) | **1.29 s / 1.30 s / 1.30 s** (was 9.64 / 9.69 / 9.72) | head line and the first ten rows; the page needed no change at all, because it reads `data.teams` and the staff already lives in each team record |

What that route needed: the counts and the leading scorer per competition are aggregates over 26k
players, which is exactly why the browser kept the whole file. A `league_top_scorer` view with
`distinct on` answers 19 rows instead of ordering 26k, and a `count()` helper reads Postgres' own row
count instead of transferring slugs to `.length` them.

**A silent field loss, found while building `/teams`.** The loader's column list for `teams` named ten
fields; `data.json` carries eighteen. `jsonb_populate_recordset` ignores keys with no column, so every
team's `elo`, `sos`, `city`, `cityName`, `region`, `history`, `pollRanks` and `franchise` had been
dropped — and 3,212 players' `careerLine`. The row counts and the points total both passed, because
nothing checked *columns*. All nine are now real columns, and the loader refuses to run when the
source carries a key the table does not (`assertCoverage`), which is the check that should have existed
from the first load.

**`games.json` is gone from the page's request path.** The Opp-adj board weights every game by the
opponent's Elo over the 1500 baseline, which resolves to one number per player-season, so the loader
now computes it into `player_adj` (2,077 player-seasons from 3,043 game logs) and the board reads a
number. Three things had to be got right for the number to match the wire build:

- the club index has to hold *every* team, including the ones with no Elo: "UMass" must find the
  Minutemen and drop that game, not slide down a prefix match onto "UMass Lowell" and borrow its Elo;
- prefix matching must be order-independent — longest key wins — because the browser, the database and
  the loader do not list 475 clubs in the same order, and "first prefix hit" gave a different club;
- `rows()` cached for five minutes per instance and the CDN for up to a day, so a reload could serve
  a stale board: the query cache is 60 s now, `stale-while-revalidate` is 10 minutes, and the client
  keys its refetch on the dataset's build stamp.

**`games.json` is a table now.** The importer's 28,819 game rows (3,043 player logs) live in
`player_games`, and the player slice carries its own log, so the page asks one endpoint and fetches no
file. Three parity breaks surfaced while checking the page text rather than a section of it:

- the teammate list was capped at 60 in the slice while the page prints the count in its heading
  ("Teammates · 240"), so the cap had to go;
- the footer reads `data.players.length`, and a slice only ever holds one player's circle — 247 where
  the dataset has 26,234 — so it reads `PLAYER_COUNT`, which the slice now supplies along with the real
  source list and build stamp;
- `seasons` came back from PostgREST without an `order by`, so `currentSeason()` (the *last* row, not
  the newest) picked a different season for one player in four; the query now orders by `ord`.

**Three separate correctness findings on `/leaders`**, each caught by diffing rows rather than trusting
the shape:

1. The default league was wrong because the dataset's league *order* is a page concern: `leagues[0]` is
   ncaa-d1 only because the importer writes it first. `leagues."ord"` now carries that order, the same
   way `seasons."ord"` carries `currentSeason()`'s "last row" rule.
2. Joining player identity in the function dropped every man whose *current* league differs from the
   league the season row belongs to — 22 of the top 25 were missing. The join belongs in the view, and
   the board filters on the player's league, which is what the page does.
3. The career board summed across leagues: a man's Junior A career showed up on his college board. The
   career view now filters on both the player's league and the row's league, matching `careerRow()`.

Two things that only showed up in the parity sweep: the grid's order is a *product* decision that
lived in the page (the endpoint answers alphabetically, so the sort moved into the slice branch), and
a slice-built page must reload on navigation — `data` holds one route's rows, and a client-side move
would draw the next page from almost nothing.
`docs/backend.md` is the case for having a backend at all (measured load cost, three options,
free-tier table); this doc is the route to the Supabase one: the destination, what is already
decided, and the decisions that are still open, one session each.

Read `docs/backend.md` first if the question is "should we". Read this one if the question is "how".

## Destination

**Postgres on Supabase is the system of record** for players, seasons, teams, games and the CMS
override layer; **the SPA asks for one route's data** instead of downloading the dataset; **the CMS
writes rows under real auth** instead of a passphrase cookie and a blob document.

Netlify does not go away: it keeps the SPA shell, the ~50 MB of media, and the meta/OG functions.

Arrival is measured, not declared:

- `/player/<slug>` and `/players` reach real content in **under 1 s** on the 1.6 Mbps / 150 ms-RTT
  profile that produced today's 8.4 s (method and numbers: `docs/backend.md`).
- A data refresh is a **loader run**, not a commit plus a deploy.
- The CMS survives one full re-import with every published value intact — the property the override
  layer exists for.

## Step 1, done

`supabase/schema.sql` + `scripts/load-supabase.mjs`, applied and run on 2026-11-25 against
`yxikpqorffsaoiysicxw` (us-east-2, session pooler — the direct host is IPv6-only on free).

- rows: **26,234 players · 53,465 season rows · 475 teams · 19 leagues · 2 snapshots**
- integrity: points total **420,479** in the database vs the dataset, **0** orphan season rows
- 7.2 s to load, **49 MB** of database, 500 MB free
- one route's slice, measured from SQL: a player detail is **4,182 B (813 B gzip)**, 150 players of
  table fields **24,147 B (3,428 B gzip)**, all 475 teams as cards **99,833 B (13,122 B gzip)** —
  against 1.70 MB gzip for the whole dataset that every visit downloads today

Two things the load forced, both now in the schema:

- **`slug` is the player key, not `id`.** Four players share an id with a namesake at the same club
  (`p-nf-wcjll-brenden-hooper` is both a skater and a goalie). The importer resolves the slug
  collision and not the id collision, so `id` is an indexed column and `slug` is the primary key.
  Season rows lead with `playerSlug` for the same reason: two of those pairs collide on
  (season, team, league, type) as well.
- **Column names are the dataset's own keys**, quoted camelCase. The loader maps nothing; a
  snake_case view can be added for query ergonomics later. Renaming is how `gaa`/`svp` were lost once
  already.

The grant posture is the D1 decision in practice: `service_role` has explicit grants (auto-grant is
off), the read model has RLS on and no policies, and the publishable key is answered
`42501 permission denied` — verified, not assumed.

## Step 2, done

`/player/<slug>?slice=1` is answered by `GET /data/player?slug=<slug>` (`netlify/functions/slice.ts`),
which reads Postgres through the Data API and returns that page's data with the three expensive blocks
already computed. Measured **live, cold cache, 1.6 Mbps / 150 ms RTT**, three runs each, time to the
comparable-players block actually in the DOM:

| | transferred | time to content |
| --- | --- | --- |
| `/player/<slug>?slice=1` | **59,418 B** | **1.51 s / 1.52 s / 1.88 s** |
| `/player/<slug>` (today) | 1,609,141 B | 9.75 s / 9.81 s / 9.93 s |

**~6.4× faster, 27× fewer bytes**, and the page is the same page: `npm run slice:check -- connor-kelly`
asserts the peer ranks and the six similarity scores are *identical* to what the browser computes from
the full dataset, and the rendered similar rows and title match in both modes.

How it stays identical: the slice is computed with the same functions the browser uses
(`src/lib/peers.ts`, `src/lib/similar.ts`), imported by the function and given Postgres-built pools.
Two things had to change for the pools to agree — `seasons."ord"` (the client's `.find()` takes the
first row of a split season, and a database has no inherent order) and a deterministic tie-break in
`similarTo` (`score`, then slug), which also makes the client's own output stable.

Costs and limits, measured:

- **cold fill 6.1 s** for the first request after a deploy — 17k-row similarity pool, 17 paginated
  reads. The CDN caches the answer per slug (300 s + SWR) and the instance caches the pools, so the
  second request is 1.0 s and the third 0.67 s. Step 4 replaces the pool with SQL.
- leaving a slice page is a full document load, which lands back on the 13 MB dataset.
- 400 KB decoded is still 400 KB of `JSON.parse`; step 3 shrinks it by trimming teams and leagues to
  the fields the page reads.

## Step 3, done

`/players?slice=1` is answered by `GET /data/players?<filters>&sort=&dir=` (`netlify/functions/players.ts`).
The table has always shown 150 rows and said "narrow the filters to see more" — but it needed all
26,234 players in memory to decide which 150 and how many matched. The database decides now.

Measured **live, cold cache, 1.6 Mbps / 150 ms RTT**, three runs each, time until the table's rows are
in the DOM:

| | transferred | time to rows |
| --- | --- | --- |
| `/players?slice=1` | **11,380 B** | **1.51 s / 1.52 s / 1.58 s** |
| `/players` (today) | 1,608,678 B | 9.88 s / 9.89 s / 9.92 s |

**6.5× faster, 141× fewer bytes.** Parity was then swept across six cases — default, league+position,
class year, minimum games, a name search and a sort click — and the count line and the first twelve
rows are identical in both modes.

Three things had to match exactly, each found by that sweep and not by reading the code:

- **`currentSeason()` is `seasons[seasons.length - 1]`**, not the newest season. The `player_current`
  view orders by the ordinal for the same reason `seasons."ord"` exists at all — the importer can
  write an older season last.
- the list needs the club *and the league short code* per row, because in slice mode there is no team
  or league map to look them up in — the row carries `teamShort`, `teamSlug`, `teamColor`,
  `leagueShort`.
- `statesList()` was emitting a blank option for players with no birthplace; both modes filter it now.

Cold fill is 5.2 s for the first request (26k-row read of `player_list`), 0.46 s warm, cached per
query string at the edge — step 4 is what removes that cost.

## Step 4, done (partly)

Two findings, one of them good news:

- **There are no client-side ratings to move.** Elo, SOS and the rank are computed by the importer
  (`compute_elo` in `fetch-real-data.py`) into `league.ratings`, and they arrived with the leagues
  table on the first load. The "ratings table" half of this step needed no work at all.
- **The similarity pool is now materialised.** The player route used to rebuild a position group's
  pool per cold request: 21k rows paged 1000 at a time, 17 requests, ~6 s. The loader writes one
  `snapshots` row per group (`pool:career:M` = 13,307 rows) and the request reads it once. The
  club-season roster queries for teammates also run in parallel now instead of thirteen in series.

Measured live: **cold 6.1 s → 4.2 s, warm 1.0 s → 0.5 s**, with `slice:check` still asserting the
peer ranks and similarity scores are identical for three players.

What is left of this step is the honest part: 13k rows is still ~1.6 MB moved per cold instance, and
the only way to remove it is to answer similarity *in* Postgres — a pgvector index over the same
feature vector. That changes the score itself (L2 over all features, rather than mean-squared over the
ones both players have), so it is a product decision about the similarity block, not a migration
detail. Not taken here.

One deployment lesson worth keeping: a block deletion in `slice.ts` took `export const config` with
it. The bundle still built, still ran correctly when called directly, and the *route* silently
disappeared — `/data/player` answered 404 while `/players?slice=1` kept working. Check the deploy's
route list (`/api/v1/deploys/<id>/functions` → `ro`), not just a 200 on the URL you happen to try.

## Step 6, done

The two verified routes are the default now. `/player/<slug>` and `/players` ask the database without
being told to; `?slice=0` on any URL forces the dataset file.

Measured **live, cold cache, 1.6 Mbps / 150 ms RTT**, three runs each, time to the route's real content:

| route | first run (edge cache cold) | then | bytes |
| --- | --- | --- | --- |
| `/player/cj-kirst` | 3.99 s | **1.50 s / 1.52 s** | 59,604 |
| `/player/cj-kirst?slice=0` | 9.80 s | 9.80 s / 9.77 s | 1,608,615 |
| `/players` | 6.01 s | **1.52 s / 1.54 s** | 11,577 |
| `/players?slice=0` | 10.08 s | 9.92 s / 9.93 s | 1,608,615 |

The first run is the edge cache being filled — 4 s for a player page, 6 s for the table, because that
one also pays the function's cold pool read. Every later visitor gets 1.5 s until the cache window
closes.

**Nothing else changed.** `/`, `/teams` and `/leaders` were re-checked after the deploy: each still
takes `data.wire.json` in full. Routes the database has not been verified for keep the old path.

**The failure path is a redirect, not an error.** If the endpoint fails or 404s, the page redirects
once to the same URL with `?slice=0` and loads the dataset — verified by requesting a player that does
not exist: the endpoint answered 404, the page landed on `?slice=0` and rendered the old not-found
page. The redirect is guarded so a failure on the `?slice=0` page shows the error instead of looping.

**Revert:** `?slice=0` per URL today, and deleting the two `if (sliceSlug())` / `if (listSlice())`
branches in `src/lib/data.ts` returns every visitor to the file.

## Step 5 — the store is done, auth is left

**The store moved.** `cms_store` is a key/value table, not rows, and that is deliberate: `doc.ts`
treats the override document as one object and publish as one write, and its lifecycle is the most
tested code in the CMS. Slicing it into `overrides(entity, field, value)` rows would have fragmented
that to gain queries nobody asked for. What changed is the substrate — Netlify Blobs (a token that
can expire mid-session, no backup, no query) to Postgres.

- `netlify/lib/store.ts` gained a `pgStore()` behind the same `KV` interface; `CMS_STORE=fs` still
  selects the local directory and `CMS_STORE=blobs` the old backend, so nothing is stranded.
- `scripts/migrate-cms-store.mjs` moved the live documents first: the published document (v12, the
  hero lede), the draft and all twelve version snapshots. It refuses to overwrite a newer document
  without `--force`.
- The speculative `overrides`/`revisions` row tables from step 1 are **dropped** — they were a guess
  at the shape before the CMS code was read, and empty weight is worse than no weight.

**Verified end-to-end against production**, not just locally: `cms-smoke --base https://laxdb.netlify.app
--write` runs the whole lifecycle on Postgres — sign-in, CSRF refusal, foreign-origin refusal, the
validator's 422s, stage, publish, edge-cache behaviour, history, revert, the 409 paths — and ends
`all checks passed`. The published document came back to one field with the hero lede intact.

**Auth is in.** Supabase Auth replaced the passphrase as the primary credential:

- the dock asks for an **email**, then for the **6-digit code** Supabase mails. The code flow was
  chosen over a magic link deliberately: a link needs the project's Site URL and redirect allowlist
  configured in the dashboard, and when that is wrong the link lands on `localhost:3000` and looks
  broken. The code path needs none of it.
- `/api/auth/otp` and `/api/auth/verify` proxy GoTrue, so the browser never learns the project URL
  and a rate-limited sender reports one readable message instead of a CORS error.
- every request resolves an actor: a bearer token verified with `GET /auth/v1/user`, then checked
  against `public.editors`. Being signed in to the project is not the same as being allowed to edit,
  and the publishable key lets anyone sign in.
- the account is `zvanderburgt@gmail.com`, created through the admin API and allowlisted in
  `editors`.

**The link path works without Pro.** The default email template only ships `{{ .ConfirmationURL }}`, and
editing templates is gated in this account, so the code field is best-effort — the *link* is the
supported flow. It needs one dashboard setting: **Site URL** must be the site, or GoTrue verifies the
token and then redirects to `localhost:3000` (the default) and the session lands nowhere. With
`https://laxdb.netlify.app` set, the link redirects to `https://laxdb.netlify.app#access_token=…`, and
`absorbAuthHash()` in `src/lib/overrides.ts` takes it on arrival, strips it out of the address bar and
stores it — verified in a browser: token stored, `/api/session` → `{ method: "bearer", user: … }`.

**Also verified against production without touching an inbox**: `admin/generate_link` minted a real code,
`/api/auth/verify` exchanged it, `/api/session` answered `{ method: "bearer", user: … }`, a draft
write went through **with no CSRF header at all**, and the draft was dropped again.

**What still stands is the fallback, on purpose.** The passphrase, the HMAC cookie, `csrfFor` and the
Origin check are still in `netlify/lib/auth.ts`, and `cms-smoke` still drives them — an automated
suite cannot read an inbox, so the passphrase remains its credential. Deleting that code is the last
commit of this step and it waits for one thing: a sign-in through the emailed code from a real inbox,
which proves delivery before the only other way in is removed.

## The measurement that decides everything

Every visit downloads the whole dataset. Measured from today's `public/data.json` (2026-11-25):

| | |
| --- | --- |
| `data.json` | 23.31 MB |
| `data.wire.json` (what the browser fetches) | 13.19 MB decoded, **1.70 MB gzip** |
| players / season rows / teams / leagues | 26,234 / 53,465 / 475 / 19 |
| one player detail page (bio + 13 season rows) | **3.2 KB** |
| 150 players, table fields | ~25 KB |
| all 475 teams, card fields | ~209 KB |
| media in the repo (7,025 photos + 347 logos) | 48.2 MB + 1.95 MB |

The JSON figures are uncompressed; the wire encoding plus gzip take each one down by roughly 4×. So
the prize is **1.70 MB → 8–60 KB per route**, and it is the payload, not the server: TTFB is 66–380 ms.

Two honest caveats, both of which shape the route:

1. **This win does not require Supabase.** Build-time slices (`Option A` in `backend.md`) reach the
   same payload reduction and keep the site static, with no account, no egress meter and no uptime
   dependency. The reasons to take on a database are the *other* three: query-shaped reads,
   writes that are not a file rewrite, and derived numbers computed once instead of per render.
2. **A cheaper version of this idea already measured slower.** The index/history payload split
   shipped and was reverted the same day (717 KB of summaries against 237 KB for all 54k season rows;
   `/` 554 → 708 ms). Any phase here is judged on throttled time-to-content, never on payload size
   alone. That is why phase 2 exists and why it is allowed to kill the effort.

## What moves, what stays

**Moves to Supabase**

- players, teams, leagues, seasons, games → Postgres tables
- the CMS override layer (drafts, published values, revisions) → tables
- admin auth → Supabase Auth (magic link) + RLS
- the daily refresh → a loader run instead of a commit + deploy

**Stays on Netlify**

- the SPA shell and its hashed assets (CDN, 100 GB/month free)
- all media — 50 MB, served by the CDN. See D5: this is the one asset class that must not move.
- `meta.ts` and `og.ts` with the generated `entity-index.json` — a crawler must never parse 13 MB
  from a database, and a cold OG render must not wait on a query.

## The decisions

Each is sized for one session and has a recommendation, so the plan is a route and not a menu.

### D1 — Read path: who talks to Postgres?

*Question:* browser → PostgREST with an anon key, browser → Netlify function → Postgres, or no
database reads at all?

*Recommendation:* **Netlify function proxy, edge-cached.** Entity routes go through a function that
sets `netlify-cdn-cache-control: max-age=300, stale-while-revalidate=86400` (the `meta.ts` pattern
already in the repo), so the database sees one query per distinct URL per cache window, and egress
is counted per cache fill rather than per view. Direct PostgREST lowers latency on a cache miss and
removes the function from the path, but it ships the anon key to every visitor, needs a read policy
on every table, and puts every view on the metered egress with no CDN in front.

*Resolved when:* one route serves from Postgres through the proxy and the cache hit is visible in the
response headers.

### D2 — Ingest: port the importer, or load its output?

*Question:* does `scripts/fetch-real-data.py` grow a Postgres writer, or does a new loader push the
`data.json` the pipeline already produces into the database?

*Recommendation:* **loader** — `scripts/load-supabase.py` reads `public/data.json` and upserts. The
importer is 40+ scripts of merge, repair, position and franchise logic that is the most expensive and
best-tested code in the repo; porting it is the largest hidden cost in this migration and buys
nothing until the database has proven itself. Ids are already stable (`p-pll-000339`, `t-cornell-big-red`),
and season rows key cleanly on `(player_id, season, team_id, league_id, type)` — the same tuple the
importer already dedupes on.

*Resolved when:* row counts match the dataset exactly (26,234 / 53,465 / 475 / 19) and a re-run is
idempotent.

### D3 — Where the derived numbers live

*Question:* Elo, SOS, peer ranks, similarity, leaders — computed per request, at import, or in the
browser over a slice?

*Recommendation:* split by cost. **Elo and SOS are whole-graph computations** (every game, shadow ids
for opponents outside our roster) and become a `team_ratings` table written by the loader. Standings,
polls, records and leaders are *already* materialised by the importer — they keep that shape, as
tables or as a `snapshots` row. **Peers and similarity** are per-league reads over a small slice and
are the only ones that may become RPCs; measure them before writing one.

*Resolved when:* a player page renders without ever loading more than its own row set.

### D4 — CMS auth and RLS

*Question:* keep the passphrase + HMAC cookie, or move to Supabase Auth?

*Recommendation:* **Supabase Auth, magic link, plus an `editors` allowlist table and RLS.** The
session code (`netlify/lib/auth.ts`, scrypt passphrase, HMAC cookie, Origin check) exists because
there was no auth provider; a bearer JWT in `Authorization` removes the cookie and with it the CSRF
class of bug that cost a day in the CMS build. Revisions gain a real `auth.uid()` author for free.
What must survive untouched: the draft/publish document model, `src/lib/cms-registry.ts` as the one
validator, and `bumpRevision()` after every write.

*Resolved when:* `scripts/cms-smoke.mjs` passes against the new backend — including its foreign-origin
403 and full-revert checks.

### D5 — Media stays where it is

*Question:* do photos and logos move to Supabase Storage?

*Recommendation:* **no.** 50 MB of images is the largest byte volume the site serves, and moving it
would put that volume on the metered side (1 GB storage is ample; 5 GB/month egress is not, once a
single player page pulls twenty headshots). Every URL is already root-relative through `assetUrl()`,
so a move is cheap to do later if the repo ever gets too big to deploy. Recorded here as a decision
so it does not get re-litigated mid-migration.

### D6 — Egress and the 7-day pause

*Question:* what does free tier actually allow, and what keeps the project awake?

*Recommendation:* budget from the cache, not the traffic. 5 GB/month at ~25 KB per response is
~200k responses; behind the D1 cache that is cache *fills*, which a site this size will not approach.
The database itself is 60–100 MB with indexes against 500 MB. The free project pauses after **7 days
without traffic** — the daily rankings refresh already runs on the box, so its loader call doubles as
the keep-alive; add an explicit `select 1` so it survives a failed import.

*Resolved when:* the loader's cron is the documented keep-alive and a paused-project recovery is
written down (one manual unpause, no data loss).

### D7 — Cutover and rollback

*Question:* how does the site switch, and how does it switch back?

*Recommendation:* a data-source flag (`VITE_DATA_SOURCE=wire|api`) compiled in, defaulting to `wire`,
with the wire file still shipped for one release. Per route: flip, deploy, measure on the throttled
profile, keep or revert. The importer writes JSON and rows (via the D2 loader) until the last route
flips, so no phase leaves the site without a working dataset.

*Resolved when:* every route is on the API and `data.wire.json` has been absent from a production
deploy for one week without a regression.

### D8 — Games and scores

*Question:* do `games.json` (901 KB) and `scores.json` (69 KB) become tables in phase 1?

*Recommendation:* **yes, cheaply** — two tables, no client change, and `src/lib/schedule.ts` already
isolates the fixture derivation behind `fixturesFor` / `gameHref` / `seasonRecord`. Box scores are the
one thing that genuinely wants to be a query on a per-game page.

## Fog — not yet specified

- **Search.** The ⌘K palette currently matches against all 26k names in memory and is deliberately
  forgiving (punctuation, token-spacing, high-school branch). A trigram index changes its behaviour,
  and nobody has decided whether that is acceptable.
- **`/my-roster`** — bookmarks are local today. Real accounts would make them portable; nothing
  requires it.
- **Per-version history UI** (CMS phase 4) — the shape of the query depends on D4 landing first.
- **Live anything** — Supabase Realtime for scores or edit presence is plausible and unscoped.
- **`entity-index.json` and the sitemap** — today both are generated from `data.json` at build. If the
  database becomes the source of truth, they are generated from it, and that touches the deploy.
- **`leagues`** — 19 rows carrying standings, polls and ratings. Whether those become tables or one
  JSON snapshot column is a schema decision D3 will force.

## Out of scope

- **Supabase Storage for media** (D5) — metered egress for the biggest bytes, no gain.
- **Edge Functions replacing `meta.ts` / `og.ts`** — a Deno port of satori + resvg-wasm with cold
  starts, to replace functions that already work and cost nothing.
- **Dropping Netlify** — the shell, the media and the SEO layer are free and proven there.
- **MSSQL / self-hosted Postgres on the Proxmox box** — uptime, TLS, patching and backups become the
  site's problem; `backend.md` already ruled it out.
- **Visitor accounts** — nothing on the site asks a visitor to sign in.

## Sequence

| # | Step | Effort | Kills the effort if… |
| --- | --- | --- | --- |
| 0 | Supabase project + keys (his, 5 min — see below) | — | — |
| 1 | Schema + loader + count verification (D2) | ~~1–2 days~~ **done 2026-11-25** | counts do not reconcile |
| 2 | `/player/<slug>` served from Postgres behind the flag (D1, D7) | ~~2–3 days~~ **done 2026-11-25** | it is not faster on the throttled profile — **it is: 9.8 s → 1.5 s** |
| 3 | `/players` — filters, sort, pagination in SQL | ~~3–4 days~~ **done 2026-11-25** | SQL cannot replace the in-memory sort — it can: 9.9 s → 1.5 s |
| 4 | Derived numbers: ratings table, peers/similar (D3) | ~~3–5 days~~ **partly done 2026-11-25**: ratings were already importer-side; pools materialised, cold 6.1 → 4.2 s | the O(n) JS had to become indexed SQL — it did not, and the last 1.6 MB needs pgvector |
| 5 | CMS onto Postgres + Supabase Auth (D4) | **done 2026-11-25**: store on Postgres, documents migrated, code/link sign-in live, editor hidden until signed in. Left: deleting the passphrase fallback and its cookie/CSRF code (an hour, deliberately last) | the smoke suite cannot be made to pass — it does |
| 6 | Cutover, wire file demoted to fallback (D7) | ~~1 day~~ **done 2026-11-25** | — (measured: 9.8 s → 1.5 s on the plain URLs) |

Total: **2–3 weeks of focused work**, matching `backend.md`'s estimate, with the important property
that step 2 can end the effort having cost three days and changed nothing user-facing.

## The first step (needs him)

Create the project at supabase.com (free tier), then write the connection details into
`data/supabase-env.txt` — gitignored, never pasted in chat:

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key, from Project settings → API>
SUPABASE_DB_URL=postgresql://postgres:<db password>@db.<project-ref>.supabase.co:5432/postgres
SUPABASE_ANON_KEY=<anon public key>
```

`SERVICE_ROLE_KEY` stays on this box and is used only by the loader; the site never sees it.

Done — the file holds `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_DB_URL`, and the loader runs against it. Refresh with `npm run db:load` after an import;
`schema.sql` is re-applied idempotently with `npm run db:schema` (`--reset` drops first, dev only).
