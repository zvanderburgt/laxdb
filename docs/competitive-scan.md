# Competitive scan — 2026-11-12

Thirteen sites checked in a real browser, 38 features logged, 7 sources blocked. Every item below
was seen rendering; nothing is inferred from a screenshot or a description. Effort is for this
codebase: **S** = UI over data we already hold, **M** = a precompute pass, **L** = new modelling or
a new feed.

## What each site is good at

### LaxGrid (laxgrid.com) — closest structural competitor
D1/D2/D3 men and women, 2000–present, fully server-rendered, so its URL patterns are a blueprint.

| Feature | Evidence | Effort |
| --- | --- | --- |
| Hometown dashboard: state totals, per-100k, share of pool, top 3 feeders | `/hometowns/d1-men` | S — **shipped** as `#/origins` |
| Head-to-head series page: all-time record, streaks, meeting list | `/vs/njit/wagner` | M |
| Coach directory with career records and tenures | `/coaches/d1-men` | M |
| Coaching carousel per division | `/coaching-carousel/d1-men` | S |
| Opponent-adjusted player value ("Goals Added") | `/ratings/d1-men/2026/value` | M |
| Conference pages with prior seasons | `/conference/d1-men/acc` | M |
| Date-based scoreboard | `/scores/d1-men` | M |

### Lacrosse Reference — analytics depth
- Per-player **expected goals added (EGA)**, so defenders and off-ball players get a number.
- **Possession efficiency**: offensive/defensive points per possession, pace, adjusted shooting.
- **Win-probability curve per game**, hash-addressable, with an EGA column in the box score.
- **Award race** computed from EGA, split Overall / Offense / Defense / FOGO.
- **Returning production** writeups: roster size vs peers, % experience returning, projected change.
- All tables render client-side (zero `<table>` elements) — headless browser only.

### College Lacrosse News — breadth and archives
- **All-American archive 2003–2026**, filterable by year, team, school, conference, position, with
  CSV export; 16,140 rows in the HTML.
- Transfer portal joined to prior-season stats (JS-injected, no public JSON).
- "Who Would Win" era-adjusted Monte Carlo simulator with an explicit data-confidence rating.
- Season stats back to 2000, individual and team, sortable.

### LaxNumbers / MaxPreps — recruiting and qualification rules
- **3,102-row class-of-2027 commitment table**, static HTML: name, class, state, high school, club,
  position, division, college. The single best new feed available.
- MaxPreps leaderboards carry an explicit **qualification minimum** and a "last updated" stamp —
  adopted on `#/leaders`.
- Rank boards sliced by position, region and state (ESPN recruiting does the same).

### Reference sites in other sports
- **Basketball-Reference**: similarity scores (shipped), Game Score, game highs linked to the box
  score, franchise encyclopedia pages.
- **Baseball-Reference**: splits explorer (~25 dimensions), stat rank ledger ("8.6 (1st)"),
  position appearances per season.
- **Hockey-Reference**: adjusted scoring for era and schedule length, embedded awards column,
  point shares.
- **Transfermarkt / Over The Cap / Olympedia**: dated move history, peer-rank and share-of-total
  context, longevity records, advanced multi-filter search.

## Adopted so far

| Feature | Where it landed |
| --- | --- |
| Hometown aggregation by state and per-capita | `#/origins` |
| Statistical similarity scores (1–99, within position group) | player page |
| Peer rank ("2nd of 37 attackmen in points per game") | player page |
| Leaderboards with a printed qualification minimum | `#/leaders`, season and career |
| Poll movement (previous rank + delta) | league page |
| Multi-year All-American archive | `#/history` 2023–2026 |

## Blocked during the scan

| Source | Symptom |
| --- | --- |
| insidelacrosse.com | Cloudflare `403` on every path; "Performing security verification" persisted past 20s in Chromium |
| collegelacrossenews.com | `HTTP/2 stream not closed cleanly`; `--http1.1` gives `SSL_read: unexpected eof` |
| lacrossereference.com | same TLS/HTTP2 fingerprint check; fine in a browser |
| laxnumbers.com college RPI/SOS/QW | tables JS-rendered; only nav links verifiable |
| usalacrosse.com rankings | Nuxt shell renders, body stays empty |
| maxpreps.com game pages | 404 or nav-only to a plain client |
| pro-football-reference.com, fangraphs.com, spotrac.com, eliteprospects.com, 247sports.com, on3.com | Cloudflare bot walls / `406` |

## The gap that matters most

Season depth. LaxGrid and College Lacrosse News carry **2000–2026**; LAXDB carries 2022+. Every
"all-time" or "career" claim on the site today means "since 2022", and the peer ranks and career
boards inherit that limit. Closing it is a new historical source, not a UI job — the highest-value
large item on the roadmap.
