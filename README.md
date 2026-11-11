# LAXDB — the lacrosse player database

A working clone of the Elite Prospects player-database model, rebuilt for lacrosse, with
**real data** pulled from public sources. Apple-inspired UI: system type, hairline structure,
frosted chrome, quiet color, data first.

Elite Prospects itself is behind a Cloudflare challenge on this network, so the feature set was
rebuilt from its known structure (bio card → career stats by season/team/league → game logs →
awards → rankings → scouting → comparables). The UI is deliberately not theirs.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
npm run preview    # serve the build on :4173
```

Static output with hash routing (`#/player/joey-spallina`) — drop `dist/` on Netlify, Vercel, S3,
GitHub Pages, or any static host. No server, no keys.

## What's in it

| Route | Page |
| --- | --- |
| `#/` | Hero, live leaderboard with league/stat switcher, featured profiles, competition grid |
| `#/players` | Full database: search, position pills, league / class / region filters, sortable table + cards |
| `#/player/:slug` | Profile: Overview, Stats, Awards (only when present); rail with vitals, draft, rankings, comparables |
| `#/teams`, `#/team/:slug` | Team directory; team page with real roster, leaders, record and support staff |
| `#/leagues`, `#/league/:id` | Competition directory; standings, leaderboard with position filter, teams, goalie leaders |
| `#/compare` | Up to three players side by side, row-scaled bars, deep-linkable (`?ids=`) |

Product details:

- **Sport-aware columns.** Field skaters show GP, G, A, PTS, SH, SH%, GB, TO, CT, FO%; field goalies
  swap to MIN, GA, GAA, SV, SV%, W–L. Box leagues show GP, G, A, PTS, PIM and, for goalies, W–L, GAA,
  SV% — the columns their feeds actually publish (no goals-against or minutes are available, so the
  site reads the published rates instead of computing zeros).
- **Command palette** (⌘K / Ctrl+K) across players, teams and leagues.
- **Compare tray** persists in `localStorage` and follows you between pages.
- **Deep links**: filters and comparisons live in the URL hash.
- **Light + dark**, following the OS preference on first visit.
- **Responsive** to phone widths; tables scroll rather than squeeze.

## The data

**17,269 real players, 427 teams, 19 competitions, 22,280 player-seasons, 2021–2026.** No invented
names or synthetic stat lines anywhere in the dataset.

| Source | What it gives | Notes |
| --- | --- | --- |
| School athletics sites (Sidearm) — 25 D1 programs | Full cumulative season stats (G, A, PTS, SH, GB, TO, CT, FO) + roster bios (position, height, weight, class, hometown, high school) | One page per season per school; 2022–2026 |
| NCAA.com individual statistic pages | Goaltending: minutes, goals allowed, saves, save %, GAA | School pages omit the goalie table |
| Premier Lacrosse League stats API | Per-season pro lines 2021–2026, jersey, position, experience, headshots | `stats.premierlacrosseleague.com/api/v4/players/season-stats` |
| MCLA (mcla.us) | College club: full skater + goalie tables per team, 2025–2026 | 172 teams, 9 conferences; positions come from the stat table's prefix |
| stats.netfrontsports.com | Canadian box pyramid: season-by-season skater and goalie tables per team, plus career aggregates | 16 leagues, 221 teams, 7,423 players — NLL, MSL, WLA, OSL, WCSLA, RMLL Sr B, BCJALL, OJLL, RMLL Jr A, OJBLL, PNWJLL, TOJLL, WCJLL, RMLL Jr B Tier I and Tier II, **OJCL (Junior C)**; 2021–2026 |

Standings and staff coverage:

| Competition | Standings | Support staff |
| --- | --- | --- |
| NCAA D1 | W–L, PCT, GF/GA — tallied from ESPN game results, not an official table | Full coaching table (name, title) from the school athletics site |
| MCLA | W–L, conference record, GF/GA per conference and division, straight from mcla.us | Head coach, from the team page header |
| PLL | W–L, PCT, GF/GA, conference record from the league's standings API | Not published in the API |
| Box (16 leagues) | None — NetFront publishes no standings and no schedule results | None published |

Coverage gaps, stated plainly:

- **No NCAA D2/D3, prep or international yet** — the tiers below D1 are covered by MCLA and the
  Canadian box pyramid, not by D2/D3 field programs. See `docs/deferred-sources.md`.
- 25 of 30 attempted D1 programs; Virginia, Notre Dame, Penn State, Princeton and Harvard publish
  stats behind different URL patterns that weren't mapped.
- Goalies are matched from NCAA leaderboards, so only goalies who qualified appear (44 of them).
- No game logs, awards, recruiting rankings or scouting grades — those aren't in these sources, so
  the UI hides those tabs instead of inventing content.
- Career totals cover the seasons indexed here (2021/2022 onward), not necessarily a full career.
  The profile states the span under the stat strip.
- Box league team pages publish one season of detail plus a career aggregate. Box profiles
  therefore show the current campaign season-by-season and the league's own career total beneath
  it — labelled as such, rather than presented as a full season history.
- Box rosters carry no F/D/T split (the feeds list skaters and goalies only), so box skaters are
  badged as runners.
- D1 standings are derived from results, so a game ESPN doesn't carry leaves a record one short.
  The standings card says so instead of implying an official feed.
- A player who plays in two different leagues (say the NLL and the PLL) has one profile per league.
  Merging those would need a date of birth, which none of these feeds publish; matching on name
  alone would collapse different athletes who share one.

Rebuild the dataset:

```bash
python3 scripts/fetch-real-data.py            # uses scripts/.cache/ for pages already fetched
python3 scripts/fetch-real-data.py --refresh  # ignore the cache
python3 scripts/fetch-real-data.py --no-photos
```

The fetcher caches every HTML response under `scripts/.cache/`, so re-runs and parser fixes take
seconds instead of re-hitting 25 schools.

Headshots live in `public/players/pll/` (428 webp files, ~4 MB, resized to 320px).

## Schema

`src/data/dataset.json` — leagues, teams, players. Each player owns `seasons[]` keyed by
(season, teamId, leagueId, type), plus `games`, `awards`, `rankings`, `scouting`, `draft`, `photo`.
Raw counts are stored; every rate (PTS/G, SH%, SV%, GAA, FO%) is computed at render time so totals
can never disagree with the tables.

```jsonc
{
  "leagues": [{ "id": "ncaa-d1", "name": "NCAA Division I", "short": "D1",
                "level": "College", "type": "field", "country": "USA", "tier": 1 }],
  "teams":   [{ "id": "t-syracuse-orange", "name": "Syracuse Orange", "shortName": "Syracuse",
                "leagueId": "ncaa-d1", "conference": "ACC", "colors": ["#F76900", "#000E54"] }],
  "players": [{
    "id": "p-ncaa-joey-spallina-syracuse-o", "slug": "joey-spallina",
    "name": "Joey Spallina", "position": "A", "teamId": "t-syracuse-orange",
    "classYear": 2026, "heightIn": 71, "weightLb": 192,
    "seasons": [{ "season": "2026", "gp": 19, "gs": 19, "g": 35, "a": 52, "pts": 87,
                  "sh": 111, "gb": 29, "to": 38, "ct": 7, "foW": 0, "foA": 0 }]
  }]
}
```

## Design notes

- **Type**: system stack (SF Pro on Apple devices), tight display tracking, tabular numerals.
- **Structure**: hairlines, 20–26px radii, one elevation level per surface.
- **Color**: one accent (`#0071e3` / `#0a84ff`); team colors only for identity washes and badges.
- **Motion**: `cubic-bezier(.22,1,.36,1)`, 2–3px lifts, honors `prefers-reduced-motion`.

## Deployment

- Netlify site: `laxdb` → https://laxdb.netlify.app, building `main` from
  `github.com/zvanderburgt/laxdb` (`npm run build` → `dist`, `NODE_VERSION=20`).
  Every push to `main` triggers a build; `netlify.toml` carries the settings and cache headers.
- Manual deploy fallback (no repo build): `python3 scripts/deploy-netlify.py` — zips `dist/`
  and uploads it over the Netlify API. Auth comes from `NETLIFY_AUTH_TOKEN` or the token the
  Netlify CLI stores after `netlify login`.
- Repo pushes from this machine use the deploy key `~/.ssh/id_ed25519_github_laxdb`
  (write access to `laxdb` only).

## Structure

```
src/
  lib/        types, dataset access + stat math, router/theme/compare providers
  components/ ui primitives, chrome (nav, command palette, compare tray)
  pages/      Home, Players, PlayerPage, Teams, Leagues, Compare
  data/       dataset.json  (generated)
  styles.css  design system
scripts/
  fetch-real-data.py    importer for the three sources
  generate-data.py      synthetic generator (kept for schema/demo work)
```

## Next

- D2/D3 and MCLA ingestion (same Sidearm pattern, more schools)
- Map the five missing D1 programs' URL patterns
- Game logs from school box scores
- Recruiting rankings + awards ingest
- API surface + auth for team/coach accounts
