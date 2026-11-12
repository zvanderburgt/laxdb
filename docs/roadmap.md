# Roadmap

Ordered by payoff against effort. Each item says where the data comes from, because that —
not the UI — is what decides whether it ships.

## Shipped

- Player profiles: bio, career by season/team/league, position-aware stat sets, box vs field rules
- Compare up to three players, deep-linkable
- Teams: roster, leaders, record, conference place, support staff, recruiting origins
- Leagues: standings (D1 derived / MCLA / PLL), Elo + SOS for D1, leaderboards, origins
- Per-game stat view, league-aware CSV export
- 1200×630 share card per player
- My roster: in-browser bookmarks with CSV export
- Teammates on every profile
- Game logs from official D1 box scores (10,641 player-games, reconciles to season totals)
- Team season summaries: goals/game, goals against/game, shooting %, save %, faceoff %
- Payload split: `data.json` 11.7 MB (down from 15.3) + `games.json` 1.3 MB loaded on demand
- Team logos (194 clubs) and headshots (1,060 players, up from 453)
- Advanced player search with shareable filter URLs; sortable league leaderboards
- Game-log form: last-5 averages, best game, streak, W/L strip
- Three D1 polls (committee, RPI, USILA coaches) via a browser-rendered fetch, with a
  day-by-day archive in `rankings-history.json`
- Records page: 126 seasons of national champions, titles by program, 26 Tewaaraton winners
- NCAA record book: 13 leaderboards (career + single season, points/goals/assists, per game),
  388 rows, plus program win totals
- 2026 USILA D1 All-Americans: 100 players across 1st/2nd/3rd/honourable mention, parsed from
  the published PDF

## Duplicate players (done)

One person can arrive once per source: the same pro in the NLL and the PLL, a junior moving from
B to C, a source listing a club's career table next to its season table. `merge_players()` folds
those records, but only with evidence:

| Evidence | Merged | Example |
| --- | --- | --- |
| Same program, or a naming variant of it | yes | "UC Santa Barbara" and "Santa Barbara" |
| Same Canadian box ladder, one year apart | yes | OJBLL 2025 → OJCLL 2026 |
| Pro box ↔ pro field, ≤ 5 years apart | yes | MSL/NLL + PLL |
| NCAA → pro, ≤ 2 years apart | yes | Cornell → PLL Waterdogs |
| Same league, different school, same window | **no** | two "Aidan Smith"s, two MCLA schools |
| Field ↔ box outside the pro tier | **no** | MCLA club player and a junior box club |

A goalie is never merged with an attacker, two records on the same pro club are never merged (the
rosters are small enough for genuine namesakes), and names shared by more than four records require
a program match. Seasons that arrive twice — a club listed in both PNWJLL and WCJLL — are deduped
on `(season, team, stats)` so career totals never double.

The current team is the newest season, ranked by competition when a player finished two in the same
year; the headshot is taken from that competition when one exists.

Charts follow the same rule: once a career spans clubs, the season chart becomes grouped bars — one
bar per team, in that team's colour, with a legend and a value per bar. A single-club player keeps
the original area line.

## Next (in progress or ready to start)

### 1. All-Americans for earlier seasons
The 2026 D1 sheet is in. Earlier years need their PDF URLs (the document path includes a
publication date, so they cannot be derived). D2/D3 use a different layout — see
`docs/deferred-sources.md`.

### 2. Weekly poll movement — already have the data
`rankings-history.json` keeps a snapshot per poll per day, so a "movement" column (up/down since
the previous snapshot) is pure presentation once there are two snapshots.

## Later (needs a new source)

### 5. Rankings — scrape
USILA coaches poll, NCAA RPI, Inside Lacrosse media poll, by week and division. Both College
Lacrosse News and LaxGrid publish these; we would parse rather than compute.

### 6. Awards and record books — scrape
All-American teams, Tewaaraton history, all-time individual and team records, champions by year.
Static pages, low refresh rate, high reference value.

### 7. Transfer portal and commitments — scrape + name matching
Highest-risk item: portal entries are name + school + class, and matching them to our profiles
without a DOB will produce false positives. Ship only with a confidence flag on each match.

### 8. Historical depth — new source
LaxGrid goes back to 2000. ESPN's scoreboard only gives us the current season, so multi-season
Elo and any "who would win" simulation wait on a historical results source.

## Coverage gaps (not features)

- **NCAA D2/D3**: blocked on a school → athletics-domain map. ~250 sites, same Sidearm parser
  once the domains are known. Biggest single coverage win available.
- **Women's lacrosse**: same parser against `/sports/wlax/`, unverified but likely to work.
- **Prep/high school**: no reliable public stats source found; MaxPreps is JavaScript-gated.

See `docs/deferred-sources.md` for the sources that are blocked and what would unblock them.

## Known data issues

- Field-league penalty minutes were stored in seconds while box PIM is minutes — fixed in the
  importer; existing rows need a rebuild to pick it up.
- Box leagues publish one season of detail per team page; career totals come from their own
  aggregate table, labelled as such.
- A player in two leagues (NLL and PLL) has one profile per league — merging needs a DOB.
