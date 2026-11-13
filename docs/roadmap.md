# Roadmap

Ordered by payoff against effort. Each item says where the data comes from, because that —
not the UI — is what decides whether it ships.

Last competitive scan: **2026-11-12** — 13 sites checked, 38 features logged, 7 blocked.
Evidence and per-site notes: `docs/competitive-scan.md`.

## Shipped

**Data**
- 21,803 players, 471 teams, 19 competitions, 34,943 player-seasons (2021–2026)
- NCAA D1: **72 programs** — 7,166 players, roughly 3,000 per season from 2022 to 2026
- MCLA (172 teams), PLL, 16 Canadian box leagues down to Junior C
- Elo + strength of schedule for 63 D1 teams, from 563 ESPN results
- 252 team logos, 3,615 player headshots (224×224 webp, square-cropped)
- Careers merged per person: 1,253 players across teams, 792 across competitions

**Pages**
- Player: bio, season-by-season, position-aware stats, per-game view, game log with last-5 form,
  **situational splits (month, result, vs RPI top 25)**,
  teammates, **comparable players (1–99 similarity)**, **peer rank ("2nd of 37 attackmen in points
  per game")**
- `#/leaders` — every stat, by competition and season **or career**, top 25, with a printed
  qualification minimum so a two-game sample cannot top a board
- `#/origins` — D1 players by home state: headcount, share, per-100k (2020 census), top feeders
- `#/history` — 126 seasons of champions, titles by program, Tewaaraton, NCAA record book
  (13 boards / 388 rows), **USILA All-Americans 2023–2026** (409 players)
- Team: roster, leaders, record, Elo/SOS, staff, **recent seasons**
- League: standings, **conference breakdown**, ratings with **consensus rank**, three polls with
  movement arrows, leaderboards
- Compare up to three players; My roster; CSV export; share cards

## Next — closing the data gaps

The site is ahead of its data: 77% of player profiles have no photo, birth date, hometown,
height or weight. Phased plan, with the source and expected yield for each step, lives in
**`docs/data-gaps.md`**. Short version:

1. **D1 historical rosters** (2022–2025) — one script, ~3,400 players, D1 core 36% → ~75%.
2. **Finish the box leagues GameSheet already covers** — matching work, +1,000–1,500.
3. **Box leagues with no bio feed** (RMLL Jr B, TOJLL, WCJLL, PNWJLL, WLA, BCJALL) — a
   scraper each; brings logos to ~95% and staff to ~80% on the same pages.
4. **MCLA** — the source publishes no bios; label it honestly, probe 10 club sites before
   investing in 172.
5. Long tail: box game logs, PLL birth dates, remaining staff and logos.

Measured with `python3 scripts/coverage.py --save`, trended in `docs/coverage-history.json`.

## Next — small, no new feed

1. **Active players climbing the record book** — join current career totals to the NCAA lists and
   project seasons-to-pass. *(Hockey-Reference "Active" tabs.)*
2. **All-time team encyclopedia** — stack every season we hold on one page: record, GF/GA,
   conference, peak Elo, leading scorer. *(Basketball-Reference franchise pages.)*
3. ~~Roster composition~~ — shipped as **returning production** on team pages; a class-by-class
   breakdown still needs a trustworthy class field (`gradYear` is the season year for 5,390 players).
4. **Eligibility clock** — a "Class of 2027" view with years-remaining badges, from `gradYear`.
   *(Transfermarkt contract expiry, translated to eligibility.)*
5. **Provenance stamps** — "last updated" and the feed behind every board. *(MaxPreps.)*

Judged and dropped from this tier: **home/away splits** (the box scores we parse publish no venue),
**poll first-place votes and also-receiving** (none of the three reachable polls print them), and
**TV listings** (USA Lacrosse publishes them, but a broadcast schedule goes stale within days and
this is a static site).

## Next — the admin CMS

An in-place editor behind admin auth: navigate the live pages, one floating dock along the bottom (the
compare tray's twin), click any editorial field and change it where it sits. It writes an override
layer keyed by entity id and never touches `data.json`, so a re-import cannot cost a correction.
Plan, field registry, auth model, infrastructure and phases: **`docs/cms.md`**; still of the surface:
`docs/cms-preview.html`.

## Next — needs a precompute pass

1. ~~Opponent-adjusted scoring~~ — shipped on the game-log tab: output weighted by opponent Elo,
   shown against the raw rate with the sample size. A league-wide adjusted leaderboard is the
   remaining piece.
2. ~~Era- and league-adjusted scoring index~~ — shipped as the **points index** on `#/leaders`
   (100 = that competition-season's average player-game). Cross-era normalisation is still open.
3. **Team efficiency** — possessions estimated from faceoffs, shots and turnovers, then points per
   100 possessions, opponent-adjusted ratings and expected W-L. *(Basketball-Reference.)*
4. **Single-number game score** — needs shots and turnovers per game, which the box scores carry but
   the importer does not yet store. *(Basketball-Reference Game Score.)*
5. **Point shares** — split team success into offensive and defensive shares. *(Hockey-Reference.)*
6. **Championship detail** — winning coach, MVP, venue and OT flag alongside the score we already
   show. *(College Lacrosse News tournament history.)*
7. **Coach directory and carousel** — W-L, tenure, titles. *(LaxGrid `/coaches/d1-men`.)*
8. **Conference pages with history** — conference record and finish by season.
9. **Recruiting commitments** — LaxNumbers publishes a ~3k-row static table of class-of-2027
   commitments with high school, club, position and destination.
10. **Transfer portal** — the only public tracker (College Lacrosse News) injects its table with JS
    and exposes no JSON, so this needs a browser fetch per page.

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
