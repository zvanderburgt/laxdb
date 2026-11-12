# Roadmap

Ordered by payoff against effort. Each item says where the data comes from, because that —
not the UI — is what decides whether it ships.

Last competitive scan: **2026-11-12** — 13 sites checked, 38 features logged, 7 blocked.
Evidence and per-site notes: `docs/competitive-scan.md`.

## Shipped

**Data**
- 17,685 players, 472 teams, 19 competitions, 26,164 player-seasons (2021–2026)
- NCAA D1: **71 programs** (was 25) — 3,025 players, 2,991 with box-score game logs
- MCLA (172 teams), PLL, 16 Canadian box leagues down to Junior C
- Elo + strength of schedule for 63 D1 teams, from 563 ESPN results
- 209 team logos, 1,261 player headshots (224×224 webp, square-cropped)
- Careers merged per person: 1,118 players across teams, 623 across competitions

**Pages**
- Player: bio, season-by-season, position-aware stats, per-game view, game log with last-5 form,
  teammates, **comparable players (1–99 similarity)**, **peer rank ("2nd of 37 attackmen in points
  per game")**
- `#/leaders` — every stat, by competition and season **or career**, top 25, with a printed
  qualification minimum so a two-game sample cannot top a board
- `#/origins` — D1 players by home state: headcount, share, per-100k (2020 census), top feeders
- `#/history` — 126 seasons of champions, titles by program, Tewaaraton, NCAA record book
  (13 boards / 388 rows), **USILA All-Americans 2023–2026** (409 players)
- Team: roster, leaders, record, Elo/SOS, staff, **recent seasons**
- League: standings, ratings, **three polls with movement arrows**, leaderboards
- Compare up to three players; My roster; CSV export; share cards

## Next — small, no new feed

1. **Situational splits** — home/away, month, vs ranked, win/loss, from the game logs already held
   for 2,991 D1 players. *(Baseball-Reference splits.)*
2. **Game highs linking to the game** — career best per category, each pointing at the date it
   happened. *(Basketball-Reference.)*
3. **Assisted vs unassisted goals** — derivable from G/A box scores; separates creators from
   finishers. *(PLL Advanced Stats.)*
4. **Award race** — position-weighted index over current-season stats, split overall / offence /
   defence / FOGO so a pole or faceoff man can lead something. *(Lacrosse Reference.)*
5. **Consensus rating** — RPI, Elo and both polls side by side with a unanimity score.
   *(LaxPower2 / LaxMath.)*
6. **Poll archive** — week-by-week order, points and first-place votes where published.
7. **All-American archive filters** — year, team, position, school, conference, CSV.
8. **Provenance stamps** — "last updated" and the feed behind every board. *(MaxPreps.)*

## Next — needs a precompute pass

9. **Opponent-adjusted scoring** — divide per-game output by opponent Elo so a mid-major scorer is
   not ranked with a blue blood. *(LaxGrid "Goals Added".)*
10. **Conference pages with history** — conference record and finish by season; we hold the results.
11. **Head-to-head series** — all-time record, streaks, full meeting list. *(LaxGrid `/vs/a/b`.)*
    Requires storing team-result rows, which the importer currently aggregates away.
12. **Scores by date** — the missing entry point: a day-by-day list of finals.
13. **Game pages** — one page per game with both teams' lines from the box scores.
14. **Championship detail** — final score, site, OT flag, winning coach, MVP.
15. **All-time team encyclopedia** — every season we hold on one page with record, GF/GA,
    conference, Elo. *(Basketball-Reference franchise page.)*
16. **Single-game impact score** — one number per game (points, GB, CT, faceoffs, saves) so "best
    game of his career" is sortable. *(Basketball-Reference Game Score.)*
17. **Recruiting commitments** — LaxNumbers publishes a 3,102-row class-of-2027 page as plain HTML.
18. **Coach directory** — W-L, tenure, titles *(LaxGrid `/coaches/d1-men`)*. Needs a coach entity.

## Later — new modelling or a new source

19. **Season depth to 2000** — the biggest credibility gap. LaxGrid and College Lacrosse News carry
    2000+; we carry 2022+. Any "all-time" claim today means "since 2022".
20. **Era- and schedule-adjusted scoring** — normalise across 15-game NCAA seasons, 24-game box
    seasons and the shot-clock era. *(Hockey-Reference adjusted stats.)*
21. **Possession efficiency** — offensive/defensive points per possession, pace, expected W-L. No
    feed publishes possessions for college lacrosse.
22. **Win probability per game** — needs play-by-play or scoring runs.
23. **Defunct NLL franchises, pre-2023 pro history** — StatsCrew carries 1987–2026 including MILL.
24. **NCAA D2/D3** — ~250 programs. Domains are probeable (Salisbury, Tufts, RIT, Adelphi all serve
    parseable tables); the import is a multi-hour job.
25. **Historical box to the 1900s** — Lacrosse Bibliotheque has player-seasons past 1936; name
    matching against 17.7k players is the real cost.

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

Charts: one line per career, as before. Team identity is carried by the markers (stroked in the
club colour) and a legend, and a season that spans two clubs plots their sum with a per-point
tooltip showing the split.

## Blocked

| Source | Why | Workaround |
| --- | --- | --- |
| GameSheet (Ontario Jr A/B/C) | Cloudflare Turnstile at the network layer | `stats.netfrontsports.com` publishes the same ladder as plain HTML — in use |
| Inside Lacrosse | Cloudflare interstitial on every path | none; dropped rather than faked |
| College Lacrosse News tables | JS-injected; `wp-json` returns `rest_no_route` | readable one page at a time in a browser |
| Lacrosse Reference tables | zero `<table>` elements, all client-rendered | headless browser, page at a time |
| MaxPreps box scores | game URLs 404 to a plain client | stat leaders and team pages only |
| LaxNumbers RPI/SOS/odds | JS-rendered | the commits page is static and scrapable |
| Notre Dame, Virginia, Penn State, VMI | different season path on their athletics sites | `docs/deferred-sources.md` |

## Judged and rejected

- **Shadcn/ui + Tailwind rebuild** — built, then reverted at request. The custom system stays.
- **Synthetic data** — never. Every number traces to a published source.
- **Scalar player value (WAR / point shares)** — lacrosse has no defensible replacement level, and
  an invented one is worse than no number. Peer ranks and similarity scores instead.
- **Transfer log from roster diffs** — tried: earlier seasons' rosters list only players who
  recorded stats, so arrivals look like transfers and departures cannot be inferred at all. There
  are zero D1-to-D1 moves in the data. Needs real roster history first.

## Coverage gaps (not features)

- **Women's lacrosse**: same parser against `/sports/wlax/`, unverified but likely to work.
- **Prep/high school**: no reliable public stats source; MaxPreps is JavaScript-gated.

## Known data issues

- Box leagues publish one season of detail per team page; career totals come from their own
  aggregate table, labelled as such.
- ESPN returns a median of 4–5 games per team for 2023/24 against 15 for 2025, so only complete
  seasons are published as season records.
- The merge policy resolves most cross-league duplicates, but two genuinely different players who
  share a name inside one league stay separate by design — a DOB feed is the only real fix.
