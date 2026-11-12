# Changelog

## 2026-11-12

A night of coverage, correctness and new routes. Everything below is live at
https://laxdb.netlify.app.

### Coverage
- **D1: 25 → 72 programs.** Each program's athletics site was found by probing candidate domains and
  verifying the stats page really carries a lacrosse table.
- **Season depth.** The importer only built players from the current roster, so anyone who graduated
  never entered the database and his seasons disappeared. It now unions every season's stat page:
  D1 went 3,072 → **7,166 players**, and 2023 coverage 511 → **2,910**.
- **Princeton** was configured against `goprinceton.com`, which does not exist. The real host is
  `goprincetontigers.com`; the 2026 champion is now in the dataset.
- Dataset: **21,803 players, 471 teams, 19 competitions, 34,943 player-seasons.**
- Headshots 1,234 → **3,163** for D1 (99 % of current players); team logos 29 → **72** for D1.
- **USILA All-Americans 2023–2026** (409 players), across three different PDF layouts.
- **Scores**: 1,146 D1 finals (2025–26) and 101 PLL games, from ESPN and the PLL games API.

### New routes
- `#/scores`, `#/game/:date/:home/:away`, `#/vs/:a/:b`, `#/leaders`, `#/origins`.

### New on existing pages
- Comparable players (1–99 similarity, z-scored inside each position group).
- Peer rank ("2nd of 37 attackmen in points per game").
- Splits by month, result and versus RPI top-25 opponents; opponent-adjusted points per game.
- Single-game highs with dates; returning production per team; conference breakdown; consensus
  rating; season series with scores; championship final scores; All-American honours.
- The ⌘K palette now reaches every route.

### Correctness
- 60 MCLA stat cells parsed from a dash as negative numbers — clamped, and the importer now runs the
  same sanity pass before it writes.
- Three BC clubs appeared twice (same id, one row per league) — merged.
- Hamilton Bengals were referenced by 29 seasons with no team row — restored.
- Five same-name players had been merged by mistake and double-counted a season — the merge now
  refuses when both records carry the same season on the same club, and the five were split apart.
- `scripts/check-data.py` asserts slugs, references and stat arithmetic; `scripts/repair-data.py`
  fixes what it finds; both run inside `scripts/rebuild-all.sh`.

### Rejected after trying
- **Transfer log from roster diffs.** Earlier seasons' rosters list only players who recorded stats,
  so arrivals look like transfers and departures cannot be inferred; there are zero D1-to-D1 moves
  in the data. Needs real roster history first.
- **Home/away splits.** The box scores we parse publish no venue.
- **Class-by-class roster mix.** `gradYear` is the season year for 5,390 players.
