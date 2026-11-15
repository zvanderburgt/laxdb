# The dataset payload

One file, fetched once at boot: `public/data.json` (18.19 MB) is the source of truth written by the
importer. The app never fetches it directly any more — `scripts/compact-data.mjs` re-encodes it into
`public/data.wire.json` on every build, and `src/lib/wire.ts` decodes that back into the same
`Dataset` shape the pages already use.

```
data.json            18.19 MB   source of truth, written by fetch-real-data.py
  ↓ compact-data.mjs (run by npm run build)
data.wire.json       11.77 MB   what the browser fetches
  ↓ wire.ts decodeDataset()
Dataset              the objects every page already expects
```

## What the wire format changes

| | data.json | data.wire.json |
| --- | --- | --- |
| decoded | 18.19 MB | **11.77 MB** (−35%) |
| brotli on the wire | 1.53 MB | **1.41 MB** (−8%) |
| season rows | 38,149 objects × 21 keys | positional tuples against one `seasonCols` header |
| club references | `"t-cornell-big-red"` per player and per season | indices into `teams` / `leagues` |
| empty player fields | printed as `""`, `[]`, `{}` | dropped, restored by `normalizePlayer()` |

The decoded saving is real (less text to parse, less heap to hold); the compressed saving is small
because a repeated key compresses almost for free. So the win is parse and memory, not bandwidth.

`node scripts/compact-data.mjs --check` decodes its own output and diffs every player field and every
season column against `data.json`. It must print `round trip: OK` before a deploy.

## Adding a field

- **Season row field:** append to `SEASON_COLS` in `scripts/compact-data.mjs` *and* to the
  `SeasonRow` type. The order is the format — reordering it silently corrupts every row.
- **Player field:** nothing to do. Sparse encoding drops it only when empty, and `normalizePlayer()`
  restores defaults; add the default there if the UI reads it unconditionally.

## The split that is still open

The wire format halves each piece, but first paint is still one 11.77 MB decode. Splitting the file
is the remaining step, and the numbers say where the weight is:

- players **without** seasons — 10.47 MB raw (bios, ids, names, empty fields)
- seasons — 9.67 MB raw → 4.21 MB as tuples
- teams + leagues + history — 0.41 MB

The shape that works, in order:

1. `index.wire.json`: players with no `seasons`, plus three precomputed values per player —
   `current` (the latest SeasonRow), `career` (the `careerTotals()` output) and `peak` (his best
   season). That is enough for Home, Players, Teams (roster membership needs a `clubs` list) and
   Origins, so the routes a first-time visitor lands on paint without the season history.
2. `seasons.wire.json`: `{ playerId: tuples }`, fetched on demand by the routes that need the
   full history — the player page, Leaders, History/climbers, Compare.
3. `currentSeason()` and `careerTotals()` in `src/lib/data.ts` read the precomputed values and fall
   back to summing `seasons`, so nothing else has to change.
4. The 62 direct `p.seasons` reads across 15 files are the audit list: each one either moves to
   `current`/`career`/`peak`, or the component calling it waits for `loadSeasons()`.

Do not start this without the audit list: `grep -rn "\.seasons" src --include=*.tsx --include=*.ts`.
