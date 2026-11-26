# The dataset payload

`public/data.json` (23.80 MB) is what the importer writes. **No page fetches it any more** — the site
reads Postgres, and `scripts/load-supabase.mjs` is the only thing that reads `data.json`.

```
fetch-*.py                     writes the files below
  ↓
public/data.json        23.80 MB   players, teams, leagues, seasons, history
public/games.json        3.5 MB    per-player game logs   → player_games, player_adj
public/scores.json       118 KB    the scorecard          → snapshots(key='scores')
public/history-results.json, franchises.json, rankings*.json → snapshots
  ↓ node scripts/load-supabase.mjs   (npm run db:load)
Postgres                          the only thing a request reads
```

**Every process that changes data ends by loading Postgres.** The fetchers still write files — they
are 41 scripts mutating one shared `data.json`, so they have to finish before anything can read it —
and the loader is the last stage of each pipeline:

| process | when | loader |
| --- | --- | --- |
| `scripts/rebuild-all.sh [--refresh]` — the full pipeline | biweekly cron, 3am on the 1st and 15th, and by hand | `── postgres` stage, after the integrity check, before the build |
| `laxdb-rankings-refresh` cron — polls + scores | daily, 9am | step 5, after `check-data.py`, before build/deploy/commit |

The loader truncates and reloads every table in one transaction (~15 s) and verifies row counts, the
points total and the orphan join before committing; it exits non-zero on any of those, and both
pipelines stop before building or deploying when it does. Running a single fetcher by hand still
needs `npm run db:load` afterwards — the site reads only the database.

The build no longer produces `data.wire.json`.

## Why one file and not two

An index/history split shipped on 2026-11-21: `index.wire.json` carried every player plus three
summaries (latest row, career totals, per-league peak) so list routes never needed the rows, and
`seasons.wire.json` carried the history for the routes that did. It measured **slower on every route**
and was reverted the same day. The numbers, one dataset, gzip:

| payload | decoded | gzip |
| --- | --- | --- |
| single file, pre-split | 14.45 MB | 1647 KB |
| index as shipped | 13.69 MB | 1778 KB |
| — of which the summaries | — | **717 KB** |
| — of which the bios alone | — | 1061 KB |
| seasons file | 2.02 MB | 237 KB |
| single file, now | 13.45 MB | 1653 KB |

The summaries cost **three times** what the entire season history costs. The same numbers
re-expressed per player (a latest row, a career sum, a per-league peak) do not repeat, so they do not
compress, while the rows they duplicate are 54k near-identical tuples that gzip almost to nothing.
The split also added a second request and a gate, which shows up in wall-clock (localhost, cold cache,
median of two runs, time to the route's real content):

| route | pre-split | split | reverted |
| --- | --- | --- | --- |
| `/` | 554 ms | 708 ms | 478 ms |
| `/player/<slug>` | 746 ms | 961 ms | 785 ms |
| `/team/<slug>` | 535 ms | 848 ms | 558 ms |

So the payload is one file. What the writer still buys is the shell pruning — recursive empty values
(`scouting`, the `birthplace` shell) are dropped, and that is where the 1.4 MB decoded and the 43% of
bytes come from.

## What the wire format changes

| | data.json | data.wire.json |
| --- | --- | --- |
| decoded | 23.80 MB | 13.45 MB |
| season rows | 54,328 objects × 23 keys | positional tuples against one `seasonCols` header |
| club references | `"t-cornell-big-red"` per player and per season | indices into `teams` / `leagues` |
| empty player fields | printed as `""`, `[]`, `{}` | dropped, restored by `normalizePlayer()` |

`node scripts/compact-data.mjs --check` decodes its own output and diffs every player field and every
season column against `data.json`. It must print `round trip: OK` before a deploy — the build runs the
writer but not the check.

## Adding a field

- **Season row field:** append to `SEASON_COLS` in `scripts/compact-data.mjs` *and* to the
  `SeasonRow` type. The order is the format — reordering it silently corrupts every row. `gaa`/`svp`
  sat outside the column list for months, which is why 1,287 box goaltender rows silently lost their
  published rates.
- **Player field:** nothing to do. Sparse encoding drops it only when empty, and `normalizePlayer()`
  restores defaults; add the default there if the UI reads it unconditionally.

## Still true

- `data.json` remains the fallback the client fetches when `data.wire.json` is missing (a cached shell
  from an older deploy).
- A production deploy can outlive a foreground tool call — run it in the background and verify live.
