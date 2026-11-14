# Content providers — what we pull, what we miss

One page per question: *which source gives which field, and where are the holes.*
Run `python3 scripts/coverage.py` for the live numbers; this file is the map.

## Providers

| Provider | Covers | Gives us | Known holes |
| --- | --- | --- | --- |
| School athletics sites (Sidearm), 72 D1 programs | NCAA D1 | season stats (every season page, not just the current roster), rosters, hometown, height, weight, class year, headshots, staff, logos | no date of birth; headshots on 44% of players because most schools only publish a photo for the current roster; a handful of schools publish none at all |
| mcla.us | 172 club teams | rosters, season stats, conference standings, team logos | no bios at all: no photo, hometown, height, weight, class |
| stats.premierlacrosseleague.com | PLL | season stats, games with scores/venues, headshots (100%) | no date of birth or hometown |
| stats.netfrontsports.com | 16 Canadian box leagues | season + career stats per player, team pages | stats only: no bios, no photos, no club logos |
| **gamesheetstats.com** | the same box leagues, plus OJLL/OJCL/OSL/MSL/WCSLA | **date of birth, hometown, height, weight, jersey, player photos, club logos**, 20 seasons deep | coverage of a club depends on the league uploading bios; photos exist for a minority of players |
| ESPN scoreboard | D1 results | scores, standings, Elo inputs | names need alias mapping (~13 unmatched per season) |
| ncaa.com | D1 polls + goalie leaders | committee top 10, RPI, individual goalie stats | client-rendered, browser only |
| usila.org | coaches poll, All-Americans | 20 ranked teams, All-America PDFs | Inside Lacrosse is Cloudflare-blocked |
| Wikipedia | champions, titles, Tewaaraton, record book | history tables | annual layout changes; note rows must be filtered |

## GameSheet Stats

The public stats site is a Next.js app over an open JSON API. The HTML pages sit
behind a bot check, but `/api/*` answers plainly — no token, no browser:

```
GET /api/season-info/{seasonId}              -> title, sport, dates, league{id,title}
GET /api/leagues/{leagueId}/seasons          -> every season of that league
GET /api/players/standings/{seasonId}?limit= -> every player in the season
GET /api/season-divisions/{seasonId}         -> divisions
```

`?limit=` is required on the players route: the default is 20, which looks like a
pagination bug until you pass `limit=5000`.

A player row carries `birthdate`, `hometown`, `height`, `weight`, `jersey`,
`positions`, `photoUrl` and `teams[]` with `{id, title, logo}`. The logo and photo
URLs are Cloudflare Images; the bare URL 400s, so append `/public` to the path.

**Discovery.** Season ids are not sequential per league and there is no league
index. One season id resolves to its league, and the league lists its siblings, so
`SEED_SEASONS` in `scripts/fetch-gamesheet.py` holds a few known ids per
competition and `--discover` expands them into a league map
(`scripts/.cache/gs/league-map.json`). Brute-forcing league ids works but gets
rate-limited after ~170 requests.

**Matching.** Leagues do not line up between providers — GameSheet's "Ontario
Junior Lacrosse League" season contains the Junior B clubs we file under
`nf-ojbll`. So a row is matched on a printed name **and** a club that appears on
the GameSheet row. Where the two feeds name the same club differently ("Elora
Hawks" vs "Elora Mohawks") the home town is accepted, but only when the name is
unique. `name alone` is never used.

**Assets.** Headshots are square-cropped at 224x224 webp q84 (30% vertical bias),
club logos 120x120 webp q86 — the same contract as the Sidearm/PLL pipeline.

## Run order

```bash
python3 scripts/fetch-gamesheet.py --discover    # refresh the league map (cached)
python3 scripts/fetch-gamesheet.py --apply       # fill fields + download assets
python3 scripts/coverage.py                      # what is still missing, by league
```

`--apply` writes `public/data.json` in place, so take a copy first. It only fills
empty fields — it never overwrites what a provider already supplied.

## Why this helps duplicate merging

`same_person()` in `scripts/fetch-real-data.py` now refuses to merge two records
that carry different `dob` values, and that check only became useful once the box
leagues had real birth dates. A dob also lets a future pass merge two same-name
players across leagues (PLL ↔ NLL ↔ MSL) where team evidence alone is ambiguous.

## Still open

- BCJALL, WCJLL, PNWJLL, WLA, TOJLL, RMLL tiers and the NLL: no GameSheet seed
  season found yet, so those clubs still have no bios or logos from this source.
  (BCJALL, PNWJLL and OSL bios come from the Digitalshift ticket API instead — see
  `docs/deferred-sources.md` — but the other four still have none.)
- MCLA has no bio source at all.
- D1 dates of birth are not published by any school feed we have found.
- GameSheet publishes per-opponent and home/away splits per player that we do not
  ingest yet.
