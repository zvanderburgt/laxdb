# Step 2 — the player route from Postgres

Jev sized the request **not small** (`p(small)=0.07`), so this is a spec-backed step rather than a
patch. Scope settled in the grill: one route, one flag, one measurement, revertible in one line.

## Decision

`/player/<slug>?slice=1` answers from the database. Everything else keeps the dataset file. The
query parameter *is* the flag: same deploy, same CDN, two URLs, and the revert is "stop linking to
`?slice=1`".

## What the function returns

`GET /api/slice?slug=<slug>` — 400 KB JSON / 62 KB gzip:

| part | why it cannot be dropped |
| --- | --- |
| player + season rows | the page |
| all 475 teams, 19 leagues | `teamById` / `leagueById` lookups across the page and its links |
| history snapshot | All-America and Tewaaraton blocks read `data.history` |
| peers | `peerRanks` normally filters 26k players by league and position group |
| similar (6) | `similarTo` normally z-scores every player in the position group |
| mates (60) | `teammatesOf` normally indexes every roster he played on |

Peers, similarity and teammates are computed with the **same** functions the browser uses
(`src/lib/peers.ts`, `src/lib/similar.ts`), imported by the function and given Postgres-built pools,
so the two modes cannot drift. `npm run slice:check -- connor-kelly` asserts they are identical.

## Tickets

1. **Schema** — `player_career` view (career sums per player) and `seasons."ord"`, because a split
   season resolves to the client's *first* row and the database has no inherent order. Done.
2. **Endpoint** — `/api/slice`, Data API reads with the secret key, paginated (PostgREST caps at
   1000 rows and a silent truncation changes every rank), CDN-cached per slug. Done.
3. **Client** — `?slice=1` loads the slice instead of the file; `data.players` holds only this
   page's people, so any navigation becomes a full document load (`src/lib/app.tsx`). Done.
4. **Page** — `PlayerPage` prefers the slice's peers/similar/mates. Done.
5. **Verify** — `slice:check` (parity) + the built page driven locally in both modes. Done.
6. **Measure** — throttled 1.6 Mbps / 150 ms, cold cache, both URLs, time to the comparable-players
   block. Open.

## Known limits, on purpose

- Cold fill of the slice costs seconds (17k-row similarity pool, 17 paginated reads) — the CDN
  cache and the in-instance pool cache absorb it, and step 4 replaces it with SQL.
- Leaving a slice page is a full page load, which lands on the 13 MB dataset again.
- The scouting block's peer percentile still reads `data.players`; a player with graded scouting
  would show unranked in slice mode. No such row exists today.
