# lacrossebible.ca — the OJLL archive, 1933–2016

`https://lacrossebible.ca/ontario-junior-a-stats/` is the Ontario Junior A history page of
the Lacrosse Bibliotheque / *Power's Bible of Lacrosse*. It is a WordPress site that links
**75 plain-text season files**, one per year, at
`/wp-content/uploads/<year>-ONTARIO-LACROSSE-ASSOCIATION-JUNIOR-A.txt` (the path changes in
a few years: `ONTARIO-AMATEUR-LACROSSE-ASSOCIATION`, `INTER-CITY-JUNIOR-LACROSSE-LEAGUE`,
and a `-1` suffix in 2008, so scrape the links, never build them).

The host drops a plain `urllib`/`curl` connection (`RemoteDisconnected` — TLS fingerprint),
so the files are fetched from inside a real browser session (`fetch()` in the page context)
and cached to `scripts/.cache/lb/<year>.txt` (1.9 MB, gitignored). That cache is the
authoritative copy: a re-run of `scripts/parse-lacrossebible.py` is offline.

## What a season file holds

```
FINAL STANDINGS        club rows: GAMES WON LOST TIED GOALS FOR GOALS AGAINST POINTS
PLAYOFFS               series results ("OSHAWA DEFEATED MISSISSAUGA 4 GAMES TO 1")
MINTO CUP WINNER
TOP TEN SCORERS        leaders, "Name - Club" with GAMES GOALS ASSISTS POINTS PEN.MIN
Official All-Star Teams
<YEAR> <CLUB>          then, per club:
  REGULAR SEASON       header GAMES GOALS ASSISTS POINTS PEN.MIN
  <player rows>
  Goaltenders          header GP MIN W L T GA GAA SV SV%
  PLAYOFFS             the same two tables again for the playoffs
```

Older files are thinner: 1955 carries `GOALS ASSISTS POINTS` only and prints `xx` where
games played is unknown; a handful of early seasons list only leaders.

## Parsed totals (`scripts/parse-lacrossebible.py`)

| | |
| --- | --- |
| seasons with regular-season rows | 71 (1933–2016; 75 files) |
| regular-season player rows | 18,387 |
| playoff player rows | 10,329 |
| goalie rows | 178 |
| distinct people | 8,547 — **8,157 of them not in LAXDB** |
| club names | 100, including defunct clubs (Sarnia Pacers, Barrie Lakeshores, Mississauga Tomahawks, Long Branch Castrolites) |

Spot-checked against known facts: Jeff Teat, 2016 Brampton — 19 GP, 56 G, 89 A, 145 PTS.
Rows are regular season and playoffs separately; a season row in `data.json` is
`type: "regular"`, so a playoff total needs its own row shape (there is no `type: "playoff"`
anywhere in the pipeline yet).

## What it would take

Importing it is the same shape as `scripts/import-gamesheet-season.py`: create a player only
when the printed name has no holder, attach season rows, create the historical clubs. Two
consequences to accept before running it:

- **+8,157 people (+37% of the dataset)** with no bio of any kind — no birth date, height,
  weight, hometown or photo exists in the archive, so every one of them lands in the
  "statistics only" bucket.
- **100 club names**, most defunct, which enter the Teams directory and the Leagues counts
  unless defunct clubs are marked as such.

Phased option: 2000–2016 alone is 17 seasons and roughly 2,500 new people, which keeps the
clubs mostly alive and the era within living memory of the rest of the dataset.

Not in the archive: assists before the 1950s in some files, penalty minutes often missing
before 1968, and no game-by-game results beyond the playoff series lines — so no Elo, no game
logs, season aggregates only.
