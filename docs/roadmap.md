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

## Next (in progress or ready to start)

### 1. Advanced player search — no new source
Filter by hometown, high-school, height, handedness, shooting % and games minimums; keep the
filters in the URL so results are shareable. EP charges for the equivalent.

### 2. Sortable leaderboards — no new source
The league leaderboard has fixed columns; make every column sortable and add the per-game toggle
that profiles already have.

### 3. Game highs and recent form — cheap, on top of the shipped box scores
Single-game career highs, "last 5 games" averages, and a form strip on the profile. The game rows
are already stored; this is presentation.

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
