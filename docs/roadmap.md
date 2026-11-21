# Roadmap

Ordered by payoff against effort. Each item says where the data comes from, because that —
not the UI — is what decides whether it ships.

Last competitive scan: **2026-11-12** — 13 sites checked, 38 features logged, 7 blocked.
Evidence and per-site notes: `docs/competitive-scan.md`.
Last improvement scan: **2026-11-14** — `docs/improvement-scan.md` (search, suggested lists,
honors, record book, roster-only profiles: shipped; crawl policy: shipped; what is open, below).
Last payload pass: **2026-11-21** — the dataset is two files now (`docs/dataset.md`).

## Shipped

**2026-11-21 — per-entity share cards**
- `/og/player/<slug>.png`, `/og/team/<slug>.png` and `/og/league/<id>.png` are real 1200×630 cards:
  the entity's name, club colours, career line, points-by-season bars (player) or career leaders
  (team, league). Rendered server-side by `netlify/functions/og.ts` — satori lays out the card as SVG,
  `@resvg/resvg-wasm` rasterises it — with the Inter fonts and the wasm inlined into the bundle, so no
  runtime dependency and a zip deploy is still possible. ~150 ms warm, cached a week at the edge.
- `meta.ts` now points `og:image`/`twitter:image` at the entity's card, with `og:image:alt`.
  `entity-index.json` grew the facts a card needs (club colours, career totals, the last four scoring
  seasons, a club's and a league's top three scorers) so a cold start never parses the dataset.

**2026-11-21 — the payload split**
- `data.json` (23.76 MB) is re-encoded into `index.wire.json` (13.65 MB: one record per player plus
  his latest line, career totals, per-competition peak and clubs) and `seasons.wire.json` (2.02 MB:
  every season row but each player's newest, which rides in the index). First paint decodes 13.65 MB
  instead of 14.45 (−5.5%); the history is fetched on demand and the routes that read it gate behind
  the boot skeleton.
- `gaa`/`svp` were being dropped by the wire encoder — 1,287 box goaltender rows lost their
  published rates. They are in `SEASON_COLS` now, and the season table prints them instead of "—".

**2026-11-14 — findability, correctness, polish**
- **Search** that survives punctuation and initials (`oneill`, `c j kirst`, `mount st marys`), and
  a name query is no longer padded with club or school substring noise. Same index backs the
  players table.
- **One notable-player picker** behind the hero carousel, the home strip, Compare and ⌘K — scoped
  to the competition, so a Junior B summer peak cannot rank as a "leading D1 scorer".
- **Honors on the profile**: All-America matched over the whole career (118 → 201 players),
  Tewaaraton winners on the timeline, hero tags for both.
- Record book expands past 12 rows (388 rows reachable, was 156); roster-only profiles say so
  instead of drawing an empty chart (411 players); palette is a real combobox.
- **Crawl policy and real URLs** — `docs/crawling.md`: path routing, per-entity `<title>`,
  canonical, Open Graph card and JSON-LD via a Netlify function, `robots.txt` that admits search
  engines and refuses bulk/AI crawlers, `x-robots-tag` on every feed, 22,443-URL sitemap, `/x/`
  canary.

**Data**
- 26,972 players, 475 teams, 19 competitions, 54,328 player-seasons (2020–2026)
- NCAA D1: **72 programs** — roughly 3,000 players per season from 2022 to 2026
- MCLA (172 teams), PLL, 16 Canadian box leagues down to Junior C
- Elo + strength of schedule for 63 D1 teams, from 563 ESPN results
- 252 team logos, 6,256 player headshots (224×224 webp, square-cropped)
- Careers merged per person: 1,253 players across teams, 792 across competitions

**Pages**
- Player: bio, season-by-season, position-aware stats, per-game view, game log with last-5 form,
  **situational splits (month, result, vs RPI top 25)**,
  teammates, **comparable players (1–99 similarity)**, **peer rank ("2nd of 37 attackmen in points
  per game")**
- `/leaders` — every stat, by competition and season **or career**, top 25, with a printed
  qualification minimum so a two-game sample cannot top a board
- `/origins` — D1 players by home state: headcount, share, per-100k (2020 census), top feeders
- `/history` — 126 seasons of champions, titles by program, Tewaaraton, NCAA record book
  (13 boards / 388 rows), **USILA All-Americans 2023–2026** (409 players)
- Team: roster, leaders, record, Elo/SOS, staff, **recent seasons**
- League: standings, **conference breakdown**, ratings with **consensus rank**, three polls with
  movement arrows, leaderboards
- Compare up to three players; My roster; CSV export; share cards


## Next — closing the data gaps

The site is still ahead of its data: most player profiles have no photo, birth date, hometown,
height or weight. Phased plan, with the source and expected yield for each step, lives in
**`docs/data-gaps.md`**. Phases 1–4 are shipped (D1 historical rosters; the box leagues GameSheet
already covers; BCJALL bios through the Digitalshift ticket API; MCLA labelled "statistics only").
What is left:

1. **The long tail** (`data-gaps.md` phase 5) — box game logs, PLL birth dates, remaining staff and
   logos. Each is a scraper per source; measure with `coverage.py` before and after.
2. **Handedness** (`data-gaps.md` phase 6) — the value is printed in GameSheet's *rendered* club
   roster table and in no JSON surface. The two blockers are gone: requests go through a Chromium TLS
   fingerprint (`scripts/netget.py`), and `scripts/parse-gamesheet-page.py` reads the roster table
   directly, so a club pass needs no saved pages. Coverage is still 74 players (0.3%) because that
   batch has not been run — OJBLL and BCJALL fill the field, several clubs ship nulls by data entry.

Measured with `python3 scripts/coverage.py --save`, trended in `docs/coverage-history.json`.

## Next — what the improvement scan left open

`docs/improvement-scan.md` has the evidence for each of these. Shipped since the scan: the game pages
are linked from every fixture a team page shows, the team page has a dated **Schedule & results**
card with a season selector (`src/lib/schedule.ts`; D1 and PLL only — no score feed exists for the
NLL, MCLA or the box leagues), and the dataset is split into an index plus a season history.

1. ~~**Per-entity share images**~~ — shipped as `/og/*.png` (satori + resvg-wasm in the function,
   facts from `entity-index.json`). Next: a build-time sweep that verifies every player/team/league
   slug renders, and a few card variants (a goalie card, a record-book card).
2. **A third file for bios** — measured and *not* worth it as planned: `birthplace` is needed by the
   Players state/high-school filters and Origins, and the hero shows height/weight, so moving those
   1.6 MB behind a gate would slow the two list routes it was meant to speed up. Only a field no list
   route reads can leave the index; what is left (`careerLine`, `experience`, `status`, `gradYear`)
   is ~0.5 MB. Parked until the index grows for another reason.
3. **Manual, outside the repo** — verify the domain in Search Console and Bing, submit
   `/sitemap.xml`, and decide whether Cloudflare sits in front for per-IP rate limits on the feeds
   (`docs/crawling.md`).

## Next — small, no new feed

1. **All-time team encyclopedia** — stack every season we hold on one page: record, GF/GA,
   conference, peak Elo, leading scorer. *(Basketball-Reference franchise pages.)*
2. ~~Roster composition~~ — shipped as **returning production** on team pages; a class-by-class
   breakdown still needs a trustworthy class field (`gradYear` is the season year for 5,390 players).
3. **Eligibility clock** — a "Class of 2027" view with years-remaining badges, from `gradYear`.
   *(Transfermarkt contract expiry, translated to eligibility.)*

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

Phases 0–3 are shipped (override layer, dock and inline fields, structured controls, photo/logo
upload with the client-side 224×224 crop, club colour), and phase 4's **version history**, revert to
feed and health report are in the dock too. Left:

1. **Phase 4 leftovers** — flags for a suspect feed value, and the orphan report for overrides whose
   entity no longer exists.
2. **Phase 5** — hardening pass (rate limits on the API, audit trail, a review the whole surface).

## Next — needs a precompute pass

1. ~~Opponent-adjusted scoring~~ — shipped twice: on the game-log tab (raw rate beside the adjusted
   one, with the sample size) and as the **Opp-adj PTS** board on `/leaders` (D1 and PLL, single
   season, same qualification rule as every other board).
2. ~~Era- and league-adjusted scoring index~~ — shipped as the **points index** on `/leaders`
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

- **Blaze Riorden carries skater lines in the NLL** (34 G / 39 A in 2022, career 107 G / 132 A for a
  goalie) while his PLL rows are correct goalie lines with zero goals. Only 3 of 1,704 goalies have a
  g+a total above 20, so this is a few bad rows, not a parser rule. Needs the NetFront rows re-read
  for that club-season before the card and the profile are trusted for him.
- Box leagues publish one season of detail per team page; career totals come from their own
  aggregate table, labelled as such.
- ESPN returns a median of 4–5 games per team for 2023/24 against 15 for 2025, so only complete
  seasons are published as season records.
- The merge policy resolves most cross-league duplicates, but two genuinely different players who
  share a name inside one league stay separate by design — a DOB feed is the only real fix.
