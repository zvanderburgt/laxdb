# What GitHub actually has

A sweep of GitHub (repo search: `lacrosse stats|data|scraper|analytics`, `premier lacrosse
league`, `college lacrosse`, `nll stats`, `box lacrosse`, `mcla`, `pointstreak`) looking for
sites or datasets similar to LAXDB that could feed it player data. Nearly every hit is an
app, a scraper for a source we already own, or a school project. Four repos carry data, and
one of those led somewhere better than the repo itself.

## 1. `octonion/lacrosse` — the only real archive (★18, 120 MB)

Scraped from Pointstreak before it died, so it is the surviving copy of several competitions.
Four trees, measured:

| Tree | What | Volume |
| --- | --- | --- |
| `mll/` | Major League Lacrosse **per-game box scores**, 2005–2015 (seasons, playoffs, all-star, WMLC) | 519 games, 3,323 player rows → **841 distinct people**, 84% carry height + weight, 100% jersey, 0% handedness |
| `ncaa/csv/ncaa_games_*.csv` | NCAA game results, **all divisions**, 2002–2023 | 90,834 games across 437 clubs — D1 19,636 · D2 13,553 · D3 57,576 |
| `ncaa_rails/rails_rosters.csv` | NCAA rosters (club id, jersey, `Last, First`) | 11,315 rows, 8,753 of them D2/D3 |
| `ncaa_rails/rails_pbp.csv` | NCAA play-by-play text | 1.6 M events, 782 games, 8,568 `GOAL by …` lines with assists + 8,637 faceoffs |

Also `nll/` and `ncaa_women/` (11 MB). The `*.csv` files in `mll/csv` and `nll/csv` are
**empty shells** — the payload is the JSON (`mll/json`, 519 files) and 2,042 Pointstreak XML
box scores (`nll/xml`, `mll/xml`) carrying `Player PlayerID Name Number Pos G A SOG PIM PLUS`
per game. No bios in the XML either, but it is 2,000+ NLL game logs, which the dataset does
not have (18,768 players are without one).

Usable today:

- **MLL as a new league.** 765 people we do not hold (76 of the 841 names already exist as
  PLL/NLL/NCAA players). Per-game G/A/SOG/PIM/shots per player, height and weight per row.
  No birth dates, no hometowns, no handedness, and the photo/logo URLs are
  `static*.pointstreak.com` — **403 now**, so no crests or headshots.
- **NCAA D2/D3**, which `docs/deferred-sources.md` lists as blocked on a school→domain map.
  This repo removes the need for that map: 71,000 games of scores, 8,753 roster rows
  (name + jersey, no bios), and play-by-play for a subset from which per-player goals and
  assists can be derived. It does **not** carry season stat lines, so a D2/D3 player would
  show a game log and no season row unless the pbp is parsed.

Not usable: everything photograph-related. Every image URL in the repo points at Pointstreak,
which 403s; nothing to fill `data/missing-crests.md` with.

## 2. `parnic/shift_stats` — the Digitalshift key (`api.shiftstats.com`)

A 2018 Ruby gem for the same league platform our box leagues run on. It publishes the
**app API key** and the `StatsAuth ticket="…"` header scheme — but against the *old* host
(`api.shiftstats.com`), whose `/leagues` now answers `403 access_denied` for that key.

The current host is a different one and needs no key at all. Each league site prints its
tenant id in `window.config.client_service_id`:

```
POST https://web.api.digitalshift.ca/login   {"client_service_id": "<tenant>"}
  -> {"ticket": {"hash": "..."}}
GET  https://web.api.digitalshift.ca/partials/stats/...   Authorization: ticket="<hash>"
```

Partial endpoints (all return `{"content": "<html>"}`):

- `partials/stats/filters?type=league&id=<id>` — seasons (BCJALL back to 1999)
- `partials/stats/filters?type=season&id=<id>` — divisions
- `partials/stats/filters?type=division&id=<id>` — clubs, one team id **per season**
- `partials/stats/team/roster?team_id=<id>` — the roster table
- `partials/stats/player?player_id=<id>` — bio tab + headshot URL
- `partials/stats/team/stats?team_id=<id>` — team stat table

Tenants found, each read from that site's own `window.config`:

| Our league | Host | `client_service_id` | league id |
| --- | --- | --- | --- |
| `nf-bcjall` | bcjall.com | `295901f9-454c-4158-bcca-2c643672df78` | 23 |
| `nf-pnwjll` | pnwjll.com | `8722a4a1-16d5-4eaf-952b-5a2dbfa76906` | 675 |
| `nf-osl` | ontarioserieslacrosse.com | `d8d5e08f-9747-40a7-a053-a28f42227e9d` | 284 |
| (not ours) | canadianlacrosseleague.com | `a534da30-3532-4992-9a13-3aef1e843e97` | 3551, 3367, 188 |

`wcjll.com`, `tojll.com`, `rmll.ca`, `ojll.ca` and `ojbll.ca` now 301 to
canadianlacrosseleague.com, which hosts three unrelated leagues (Play Lacrosse, Australian
Lacrosse League, International Indoor Junior) — the old tenants are gone with the domains, so
those box leagues still have no bios route. `wla.ca` is a parked domain.

What the API gives that the rendered page pass (`fetch-digitalshift.py`) does not: no browser,
no 7-second repaint wait, historical seasons (a team **id per season**, so 28 BCJALL seasons
are reachable), and player photos.

Bio columns are a **per-season switch on their side**: the newest season publishes
`# | Name | POS | Shoots | Height | Weight | Hometown | Minor Association | Sponsor |
Collegiate Team`, every archived roster is `# | Name | POS` only. Clients:
`scripts/fetch-digitalshift-api.py`.

## 3. `apalensky/NLL` — no bios

Four CSVs of NLL per-game stats (2019, 2020 regular season + playoffs). Stat lines only, no
birth date / hometown / height — nothing the NLL feed we already parse does not carry.

## 4. `WalrusQuant/{pypll,pllr}` — a client for a source we already use

Python and R clients for the PLL stats API (~70 columns). It is the same API our importer
calls, so the only thing to check is whether their column list has bio fields we skip; PLL
`dob` coverage is 10% and `weight` 40%, so worth a look before a PLL bio pass, not a data
source of its own.

## The ones that look promising and are not

`demayj10/LaxStats2-scraper`, `st-carr/roster-data`, `BlaineMcMahon44/College-Lacrosse-Data-Scraper`,
`dcnu/lax-stats`, `MasonPease/Pll_DataScrape` — all scrapers for NCAA/PLL pages, i.e. sources we
already import with better parsers. `bilalahhmedd/lacrosse-prediction` claims club+player
scraping bots but ships no data. Nothing on GitHub carries handedness, birth dates or
hometowns for our box leagues; those still come only from GameSheet and Wikipedia.
