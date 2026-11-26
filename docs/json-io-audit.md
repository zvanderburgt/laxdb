# JSON in and out: every read and write, and what stands in its place

Audited against the tree at the deploy that ships this file. Three commands reproduce the whole list:

```bash
grep -rn --include=*.ts --include=*.tsx "\.json" src/                 # browser
grep -rn --include=*.ts "readFile\|readdir\|node:fs" netlify/         # functions
grep -rln "json.dump\|write_text" scripts/*.py                        # importer
ls dist/*.json                                                        # what the deploy actually carries
```

**Result: no browser code reads a data file, no function reads a data file at runtime, and the
deploy carries no data file.** One file remains — `overrides.json` — and it is a rendered copy of a
database document, not a second source of truth.

## Browser (`src/`)

| where | was | now |
| --- | --- | --- |
| `lib/data.ts` `loadDataset()` | fetched `data.wire.json`, fell back to `data.json` | **removed.** Every route takes a slice; a route without one throws instead of downloading 13 MB |
| `lib/data.ts` `loadGames()` | fetched `games.json` (3.5 MB) | **removed.** The player slice carries the log from `player_games` |
| `lib/schedule.ts` `loadScores()` | fetched `scores.json`, file as fallback | **removed.** `/data/page?path=/snapshot&key=scores` |
| `pages/Game.tsx` | fetched `games.json` for the box score | **removed.** `/data/page?path=/box&date=…&teams=…` |
| `lib/overrides.ts:285` | `fetch overrides.json` when `/api/overrides` fails | **kept, whitelisted** — see below |

`overrides.json` is the only JSON the browser can request. It is written by
`scripts/cms-snapshot.py`, which fetches `/api/overrides` — i.e. reads `cms_store` in Postgres — and
writes what visitors already get. It is read only when the API cannot be reached, and a failed
snapshot leaves the previous copy in place. Removing it would mean an API outage silently reverts
editorial work, so the file stays and the database remains the source.

## Functions (`netlify/`)

| where | reads | verdict |
| --- | --- | --- |
| `lib/supabase.ts:22` | `data/supabase-env.txt` | credentials, not data — kept |
| `lib/store.ts` `fsStore` | `data/cms-store/` when `CMS_STORE=fs` | development only. Production resolves to Postgres: `usePg()` is true whenever the project credentials exist, and the CMS smoke run against production round-trips through `cms_store` |
| `functions/og.ts:32` | `import entity-cards.json` | bundled by esbuild at build time — no runtime file I/O |
| everything else | — | Postgres via `netlify/lib/supabase.ts` |

## Deploy (`dist/`)

`vite build` used to copy every file under `public/` into `dist/`, so a 33 MB deploy carried 26 MB of
files nothing could reach: `data.json` (22.2 MB), `games.json`, `scores.json`,
`history-results.json`, `franchises.json`, `rankings.json`, `rankings-history.json`,
`entity-cards.json`, `entity-index.json`.

`scripts/strip-data-files.mjs` now runs inside `npm run build` and removes them. `dist/` is 6.9 MB
and carries one JSON file, `overrides.json`. Verified on production:

```
/data.json 404   /data.wire.json 404   /games.json 404   /scores.json 404   /overrides.json 200
```

`npm run buildKeepData` is the same build without the strip, for debugging.

## Importer and tooling (`scripts/`)

The 41 Python fetchers write `public/data.json` and the side files. That is deliberate and stays:
they mutate one shared document incrementally (merge, repair, re-merge), so they cannot each own a
table, and `check-data.py` asserts integrity on the file before anything is published.

`scripts/load-supabase.mjs` is the only writer to Postgres, and both pipelines end with it:

- `scripts/rebuild-all.sh` — `── postgres` after the integrity check, before build and deploy.
- the daily `laxdb-rankings-refresh` cron — between `check-data.py` and the build.

A single fetcher run by hand still needs `npm run db:load` afterwards. The loader exits 1 with one
`FAIL <what>: <reason>` line when the env file is missing, the database is unreachable, the source
carries a column the table does not, or a count comes back short — which stops both pipelines before
they deploy.

## Scheduling (Hermes cron store, not the repo)

| job | when | database |
| --- | --- | --- |
| `laxdb-rankings-refresh` | daily 09:00 | loads after `check-data.py` |
| `LAXDB biweekly full refresh` | 03:00 on the 1st and 15th | loads inside `rebuild-all.sh` |

## What a page requests now

| route | requests |
| --- | --- |
| `/` | `/data/page?path=/home` |
| `/players` | `/data/players` |
| `/player/<slug>` | `/data/player?slug=` |
| `/leagues`, `/teams`, `/coaches`, `/leaders`, `/history`, `/origins`, `/league/<id>`, `/team/<slug>` | `/data/page?path=…` (+ `/snapshot?key=scores` where a scorecard is drawn) |
| `/compare`, `/my-roster` | `/data/page?path=/player-set&ids=…` (+ `/search` for the typeahead) |
| `/vs/<a>/<b>` | `/data/page?path=/team-set&slugs=…` + `/snapshot?key=scores` |

Measured with a cold cache across fourteen routes: zero `.json` requests. `/game` is excluded because
the page itself throws before it draws — a pre-existing render bug, recorded in
`docs/supabase-migration.md`, with its data path ready.
