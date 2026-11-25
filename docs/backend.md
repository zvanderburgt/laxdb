# A backend: what it would fix, what it would cost

Scoping note, 2026-11-22. Nothing here is built. It exists so the decision is made on measurements
rather than on the appeal of having a database.

**The route to the Supabase version of this is `docs/supabase-migration.md`** — destination, the eight
decisions still open, what stays on Netlify, and the sequence. This doc answers "should we".

## The measurement that matters

The site today is a static SPA. Every route downloads the whole dataset before it can render:
`data.wire.json`, 1,578 KB brotli / 13.45 MB decoded. Against the live site, cold cache, on an
emulated mid-tier phone link (1.6 Mbps down, 150 ms RTT):

| route | TTFB | payload on the wire | time to real content |
| --- | --- | --- | --- |
| `/` | 380 ms | 1,578 KB in **7,862 ms** | 9.1 s |
| `/players` | 66 ms | same | 8.5 s |
| `/player/cj-kirst` | 79 ms | same | 8.4 s |

The server is not the problem — TTFB is 66–380 ms. **The payload is the whole cost**, and it is the
same payload on every route. What each route actually needs, measured from the dataset:

| route | bytes it would need |
| --- | --- |
| `/players` (150 rows, table fields) | 24.9 KB |
| `/player/<slug>` (bio + every season row) | 6.9 KB |
| `/teams` (all 475 clubs, card fields) | 80.6 KB |

So the prize is real: 1,578 KB → 7–80 KB per route, and ~8.4 s → under 1 s on that link.

## What a backend does and does not fix

- **A database alone changes nothing.** If the client still fetches one payload at boot, hosting it
  behind Postgres just moves the bytes. The load-time win comes from *asking for one route's data*, and
  that is an API/SSR change; the database is one way to serve it.
- **A backend buys three other things** that matter more long-term than the bytes:
  1. Query-shaped reads: filters, sorts and pagination done by the database instead of over 27k
     objects in the browser (the Players table already sorts 27k rows per keystroke).
  2. Writes that are not a file rewrite: the importer currently rebuilds a 23.8 MB JSON and the CMS
     stores overrides in Blobs; a database makes both ordinary.
  3. Derived numbers (peer ranks, similar players, leaders, origins) can become SQL or materialised
     views instead of per-render JavaScript.
- **It does not remove the need for SSR/prerender.** SEO and unfurls still want a rendered head —
  `netlify/functions/meta.ts` already does that from a generated index, and it can keep doing it.

## Three ways to get the same win

**Option A — no backend, build-time slicing.** The build writes per-route payloads: a
`players-index.json` (~1.5 MB for the table, ~25 KB per league-slice), one file per player
(27k × ~7 KB ≈ 190 MB — or a function that returns the slice from a bundled compact dataset), plus the
existing team/league pages. Keeps static hosting, no new account, no uptime dependency. Cost: a build
step and a client data layer; the per-player files are the awkward part (deploy size, cache churn).

**Option B — managed Postgres + a thin API (Supabase or Neon).** The importer writes to Postgres; a
small API (or Supabase's auto-generated REST/PostgREST) serves the same slices; the SPA fetches per
route; the OG/meta functions read the DB or keep the generated index. This is the "real backend" ask.
Cost: schema + importer rewrite + API + client rewrite; ~2–3 weeks focused.

**Option C — the same API, but on MSSQL.** Identical shape, different dialect, and the free hosting
problem is the blocker (see the table). Practically: SQL Server Express 2022 in a container on the
Proxmox host, behind a Cloudflare Tunnel, which makes the public site depend on that box and on your
patching/backups.

## Free hosting, checked against the vendors (2026-11-22)

| platform | free tier | what would bite |
| --- | --- | --- |
| **Supabase** (Postgres) | 500 MB DB, 1 GB files, 5 GB egress + 5 GB cached/month, unlimited API requests, 50k auth MAU | 5 GB egress ≈ 200k route-views at 25 KB; **projects pause after 7 days with no traffic** and need a manual unpause; 2 active projects |
| **Neon** (Postgres) | 1 GB storage, 100 CU-hours/project/month, 5 GB egress, scale-to-zero, no card | 100 CU-hours ≈ 400 h of active compute at 0.25 CU; egress 5 GB; cold resume of a few hundred ms |
| **Cloudflare D1 + Workers** | 5 GB storage (500 MB per DB), 5M rows read/day, 100k Worker req/day, **no egress charge** | rows-read and request meters, not bandwidth; SQLite dialect; 10 ms CPU per invocation |
| **Turso** (SQLite) | 5 GB storage, 500M rows read/month, 10M written | billed on rows scanned; acquired by Supabase (Oct 2026), so no longer an independent vendor |
| **Azure SQL free offer** (MSSQL) | 100k vCore-seconds + 32 GB per DB, recurring monthly, 10 DBs | 100k vCores ≈ **~14 hours of wall-clock compute a month** at 2 vCores; **auto-pauses after 15 min**; on exhaustion the DB is either gone for the month or silently billed |
| **Render** | 512 MB web service, free Postgres | free Postgres **expires 30 days after creation**; services spin down after 15 min |
| **Fly.io** | none since 2024 | $2.19/month minimum for a bare Machine, $38/month for managed Postgres |
| **Somee** (free MSSQL) | 150 MB disk, 30 MB database | injects ads into every response; deletes the site if unvisited 30 days |
| **GearHost** | hobby sandbox only | no free SQL Server any more — DBs start at $10/month |
| **SQL Server Express** (self-host) | free engine: 10 GB/DB, 1,410 MB buffer pool, 4 cores/1 socket | you own the host, patching, backups and uptime |

Sources: supabase.com/pricing, neon.com/pricing, developers.cloudflare.com/d1/platform/limits,
turso.tech/pricing, learn.microsoft.com/azure-sql/database/free-offer,
azure.microsoft.com/pricing/details/functions, render.com/docs/free, fly.io/docs/about/pricing,
somee.com/FreeAspNetHosting, gearhost.com/pricing, learn.microsoft.com (SQL Server 2022 editions).

## Data model (Postgres; MSSQL differs only in types)

```
players(id pk, slug unique, name, first_name, last_name, position, position_name, hand,
        height_in, weight_lb, dob, city, state, country, class_year, grad_year,
        high_school, team_id fk, league_id fk, jersey, status, photo, career_line jsonb)
teams(id pk, slug unique, name, short_name, league_id fk, city, conference, colors text[2],
      logo, elo, sos, record jsonb, franchise jsonb)
leagues(id pk, name, short, level, type, country, tier, strength)
seasons(player_id fk, season, team_id fk, league_id fk, type, gp, gs, g, a, pts, sh, gb,
        to, ct, fo_w, fo_a, pen, min, ga, sv, w, l, gaa, svp)          -- 54,328 rows
games(id, date, league_id, home_team_id, away_team_id, home_score, away_score, venue)
staff(team_id fk, name, role)
honors(player_id fk, kind, year, tier, division)
championships(year, team_name, team_id)
polls(league_id fk, key, fetched, rank, team_id, record, points)
overrides(entity_type, entity_id, path, value, updated_at)             -- what the CMS writes now
```

Indexes that carry the site: `players(slug)`, `players(league_id, team_id)`, `seasons(player_id)`,
`seasons(season, league_id)`, `seasons(team_id, season)`, and a trigram index on `players.name` /
`teams.name` for the search box. Estimated size: **60–100 MB with indexes**, so it fits inside
Supabase's 500 MB and Neon's 1 GB with room for the games tables.

## API surface (maps 1:1 to today's routes)

```
GET /players?q=&pos=&league=&year=&state=&gp=&sort=&dir=&limit=&offset=
GET /players/:slug            → player, seasons[], honors[], peers, similar
GET /teams     /teams/:slug   → club, roster, schedule, franchise history
GET /leagues   /leagues/:id   → standings, ratings, polls, leaders
GET /leaders?league=&season=&stat=&scope=season|career
GET /history   /origins       /coaches   /scores   /games/:id   /vs/:a/:b
GET /search?q=                → the palette, trigram-ranked
```

Every response cached `s-maxage=300, stale-while-revalidate=86400` on entity routes, with the
importer invalidating on write. The OG/meta functions keep their generated index (2.6 MB) so a
crawler never touches the database.

## Phases, with the risky part called out

1. **Schema + importer** (1–2 days): `fetch-real-data.py` writes rows instead of JSON; verify counts
   against the current dataset (27k players / 54k seasons / 475 teams).
2. **Read API, two routes** (2–3 days): `/players` and `/players/:slug`, cached. Ship behind a flag
   and compare payload sizes and time-to-content against today's numbers above.
3. **Client** (3–4 days): per-route fetches replace the boot payload; the parts that assume the whole
   dataset in memory (peer ranks, similarity, leaders, origins, the ⌘K palette) move to API calls or
   server-computed responses. **This is the risky phase** — those are O(n) computations today and
   their SQL equivalents need indexes and a cache, not just a `SELECT`.
4. **The rest of the routes** (3–5 days): teams, leagues, history, coaches, scores.
5. **CMS onto the database** (1–2 days): the overrides document becomes a table; the existing
   session/passphrase flow and smoke suite stay.
6. **Cutover** (1 day): keep `data.wire.json` as a read-only fallback for a release, then delete the
   importer's JSON writer.

Total: **2–3 weeks of focused work**, of which phase 3 is the part that decides whether the site feels
faster or just different.

## Recommendation

- **If the goal is load time:** the cheapest win is not a database. Option A (build-time slices) gets
  the same 1,578 KB → 25 KB reduction on the routes that matter and keeps the site static and free.
  Measure it the same way: throttled link, time to real content.
- **If the goal is a real backend** — query-shaped reads, a sane importer, server-side analytics — then
  **Supabase free is the pick**: 500 MB holds the data with room, 5 GB egress is ~200k route-views,
  and it gives auth, storage and a REST layer you would otherwise write. Its one real operational
  cost for a quiet site is the **7-day pause**, which a weekly visit (or the importer's cron) clears;
  Neon avoids that (scale-to-zero, auto-resume) at the price of a compute-hours meter, and is the
  better choice if the site goes a month between sessions.
- **Don't build the public site on free MSSQL.** Azure's free offer is a development allowance that
  auto-pauses every 15 minutes and runs out at ~14 compute-hours a month; the other free MSSQL hosts
  are gone (GearHost) or inject ads (Somee). SQL Server Express on the Proxmox box is genuinely free
  and genuinely familiar — but then the site's uptime, TLS, backups and patching are yours, and a
  home-lab outage is a site outage.
- **Dialect is the smallest variable.** The work is the schema, ~12 queries, a search index and a
  client rewrite — about a week of `T-SQL` familiarity, not a reason to choose a thinner platform.

## What I would do first (low regret)

Build phase 1 (schema + importer) against Supabase's free project and keep the site on the static
payload. That costs a day, proves the row counts and the query shapes, and makes the load-time
decision separable from the migration: if phase 2 shows the API is not faster in practice, nothing
user-facing has changed.
