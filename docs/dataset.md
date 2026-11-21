# The dataset payload

`public/data.json` (23.76 MB) is the source of truth, written by the importer. The app never fetches
it directly: `scripts/compact-data.mjs` re-encodes it into **two** wire files on every build, and
`src/lib/wire.ts` decodes them back into the same `Dataset` shape the pages already use.

```
data.json             23.76 MB   source of truth, written by fetch-real-data.py
  ↓ compact-data.mjs (run by npm run build)
index.wire.json       13.65 MB   one record per player + three summaries   ← before first paint
seasons.wire.json      3.92 MB   the full season history, per player       ← on demand
  ↓ wire.ts decodeIndex() / applySeasonHistory()
Dataset              the objects every page already expects
```

## Why two files

The payload used to be one 14.45 MB file decoded before any route could paint. It is now split on the
line that matters: **a list row needs one line per player, not his whole career.**

- `index.wire.json` — every player's identity, bio, club and photo, plus `cur` (his latest season row),
  `tot` (career totals), `pk` (his best season per competition) and `cl` (the clubs he played for).
  Home, Players, Teams, Origins, My roster, Compare and the ⌘K palette render from this alone.
- `seasons.wire.json` — 54,328 season rows, one tuple array per player, aligned to the index's player
  order. The player page, Leaders, History, League boards and a team's season cards need it;
  `useSeasons()` gates exactly those routes behind the boot skeleton, and `primeSeasons()` starts the
  fetch immediately when the landing route is one of them (otherwise after first paint, and never on
  a metered or 2G/3G connection).

Measured on the 2026-11-21 build (26,972 players, 54,328 player-seasons):

| | decoded | note |
| --- | --- | --- |
| one file, before | 14.45 MB | parsed before any route painted |
| index now | 13.65 MB | first paint: **−5.5%** |
| seasons now | 3.92 MB | was 11.67 MB as objects; off the first-paint path |

The honest reading: the summaries (`cur` 1.89, `tot` 1.02, `pk` 0.51, `cl` 0.15 MB) cost almost as
much as the rows they replace, because nearly every list row prints a current-season line and a
career total. What the split buys is structural — the 12.09 MB of per-player bio stays flat as
history grows, and every season added since 2020 lands in a file no list route downloads.

## What the wire format changes

| | data.json | index.wire.json |
| --- | --- | --- |
| decoded | 23.76 MB | 13.65 MB |
| season rows | 54,328 objects × 23 keys | one latest row per player, positional |
| club references | `"t-cornell-big-red"` per player and per row | indices into `teams` / `leagues` |
| empty player fields | printed as `""`, `[]`, `{}` | dropped, restored by `normalizePlayer()` |

`node scripts/compact-data.mjs --check` decodes both files it just wrote and diffs every player
field, every season row and the three summaries against `data.json`. It must print
`round trip: OK` before a deploy — the build runs the writer but not the check.

## The next lever (measured, not done)

The index is 12.09 MB of bio and 3.57 MB of summaries. The fields only a **detail** route reads —
`birthplace` (1.13 MB), `careerLine`, `gradYear`, `highSchool`, `jersey`, `heightIn`, `weightLb`,
`dob` (~1.6 MB together) — would make a third file for the player page, Players' state/high-school
filters, Origins and Compare, taking first paint to roughly 12 MB. Do that before adding a
competition, not after.

## Adding a field

- **Season row field:** append to `SEASON_COLS` in `scripts/compact-data.mjs` *and* to the
  `SeasonRow` type. The order is the format — reordering it silently corrupts every row. If a list
  reads it off the newest row, add it to `CAREER_COLS`/the summary too, or the value is missing until
  the history arrives.
- **Player field:** nothing to do. Sparse encoding drops it only when empty, and `normalizePlayer()`
  restores defaults; add the default there if the UI reads it unconditionally.
- **A precomputed value** must stay consistent with what the client would compute from the rows:
  `careerTuples()` in the writer mirrors `careerTotals()` in `src/lib/data.ts`, and `--check` compares
  the two.

## Still true from the single-file era

- `data.json` is the fallback the client fetches when `index.wire.json` is missing (a cached shell
  from an older deploy). It carries its own seasons, and `loadDataset()` marks the history ready.
- A production deploy can outlive a foreground tool call — run it in the background and verify live.
