# Deferred data sources

Sources we deliberately skipped. Each entry records what failed, what was tried, and
what would unblock it — so a future pass doesn't re-run the same dead ends.

Last reviewed: 2026-11-12

---

## GameSheet (gamesheetstats.com)

**Status:** not used. Blocked from this host by a Cloudflare Turnstile interstitial
(`🐴 Just a moment…`), both over plain HTTP and in a real headless Chromium session.

**Why it mattered:** GameSheet hosts several Canadian junior and minor box leagues.

**Why it is not a blocker right now:** stats.netfrontsports.com carries the same
ladder — BCJALL, OJLL, OJBLL, **OJCL (Junior C)**, PNWJLL, TOJLL, WCJLL, RMLL Jr A/B
Tier I & II, Senior A/B, and the NLL — in plain server-rendered HTML. The GameSheet
data we wanted is already in the dataset under different league IDs.

**If a league turns out to be GameSheet-only, the options are:**
- A residential/mobile proxy with a stealth browser profile (fragile, likely ToS
  violation; only worth it for a league with real demand).
- Manual export: open the league in Firefox, save the players page, hand the HTML over.
- Ask the league for a data feed — junior leagues are usually happy to share.

---

## Four D1 athletics sites with a different stats URL

**Status:** configured but not imported — the season segment is not `/sports/mens-lacrosse/stats/<year>`.

| School | Domain | What the site does |
| --- | --- | --- |
| Notre Dame | und.com → fightingirish.com | `und.com` now 404s and redirects to `fightingirish.com`; that host also 404s `/sports/mens-lacrosse` and `/stats/2026` |
| Virginia | virginiasports.com | `/sports/mlax/` and `/sports/mens-lacrosse/stats/<year>` both 404 |
| Penn State | gopsusports.com | `/sports/mens-lacrosse` loads, `/sports/mens-lacrosse/stats` returns a JS shell with zero tables |
| VMI | vmisports.com | sport page 404s; the athletics site may live on another host |

**Fixed:** Princeton was listed as `goprinceton.com`, which does not exist. The real host is
`goprincetontigers.com`, and its stats page parses normally (51 players, full stat lines).

**What would unblock it:** read the season links off each site's `/stats` index (they use a
`2025-26` style segment) and add a per-school URL template. The parser itself already handles
their tables — this is a URL-mapping job, not a parsing one.

---

## Digitalshift (BCJALL, WCJLL, TOJLL, PNWJLL, RMLL, WLA)

**Status:** used. BCJALL, PNWJLL and OSL are imported through the ticket API.

**The 401 was a missing ticket, not a closed endpoint.** Every league site prints its tenant
id in `window.config.client_service_id`, and `/login` hands out an anonymous session for it:

```
POST https://web.api.digitalshift.ca/login  {"client_service_id": "<tenant>"}
  -> {"ticket": {"hash": "..."}}
GET  https://web.api.digitalshift.ca/partials/stats/...  Authorization: ticket="<hash>"
```

`partials/stats/filters?type=league&id=<id>` → seasons (BCJALL back to 2005), `?type=season&id=`
→ divisions, `?type=division&id=` → clubs — **one team id per season**, so a club's 2019 roster
has a different id from its 2026 one. `partials/stats/team/roster?team_id=` returns
`{"content": "<html>"}` with the same table the rendered page shows, and
`partials/stats/player?player_id=` carries the bio tab plus a signed 140 px headshot URL (any
other size in that filename 403s, so the source is stored at its own size).

Tenants: bcjall.com `295901f9-454c-4158-bcca-2c643672df78` (league 23), pnwjll.com
`8722a4a1-16d5-4eaf-952b-5a2dbfa76906` (675), ontarioserieslacrosse.com
`d8d5e08f-9747-40a7-a053-a28f42227e9d` (284). `scripts/fetch-digitalshift-api.py` runs the
whole pass with no browser; `scripts/fetch-digitalshift.py` stays as the rendered-page
fallback.

**Where it still blocks:** the extended columns are a **per-season, per-club data-entry switch**,
not a platform feature. BCJALL has them from 2021 on (2022–2026 mostly), PNWJLL from 2022, OSL
from 2022 — and even there only ~10% of cells are filled (BCJALL: 639 heights, 257 `Shoots` out
of 6,511 roster rows). `wcjll.com`, `tojll.com` and `rmll.ca` 301 to
canadianlacrosseleague.com, which hosts three unrelated leagues (3551 Play Lacrosse, 3367
Australian, 188 International Indoor Junior) — the old tenants went with the domains, so those
leagues have no bios route at all. `wla.ca` is a parked domain.

**If a league turns it on later:** read its `window.config.client_service_id` and add a row to
`TENANTS` in `scripts/fetch-digitalshift-api.py`.

---

## GameSheet handedness

The player page at `gamesheetstats.com/seasons/<id>/players/<pid>` shows a handedness /
shoots field. It is **not** in the API: `/api/players/standings/<season>?limit=1000` returns
exactly 13 fields per player — `birthdate, externalId, firstName, height, hometown, id,
jersey, lastName, photoUrl, positions, stats, teams, weight` — and the full 489 KB payload
for season 14861 contains the string "shoot" zero times. `/api/season-info/<id>` matches
"shoot" only inside penalty labels ("Goalie Interference by Shooter"). Every other path
tried (`/api/players/<pid>`, `/api/seasons/<sid>/players/<pid>[/stats|/details]`,
`/api/teams/<tid>/players`, roster/entries variants, `?bio=true`) returns 404.

The player page itself never passes its Cloudflare Turnstile challenge in headless Chromium
(`Just a moment…` after 25s), so the rendered value cannot be read either.

**Unblock:** a saved page or a logged-in browser session exported by hand, or the league
asking GameSheet to expose the field. For the leagues Digitalshift covers, `Shoots` is on
the roster table and already imported.

---

## USILA D2/D3 All-American sheets

The D2 and D3 PDFs group players by position, with region, jersey number and selection in the
same row:

```
GOALIE  Region  School  #  Class.  Selection
Christian Tomei  North  Adelphi  23  Junior  1st Team GOY
```

The D1 sheet (imported) instead prints "Player School Class Position" under team headings, so a
D2/D3 parser needs its own column map per position group. Those players are also outside our
current coverage, which is D1 only.

---

## NCAA Division II and III full rosters

**Status:** not used beyond leaderboards.

**What works:** `ncaa.com/stats/lacrosse-men/d2|d3/current/individual/<cat>` — top 50
per category per division. No rosters, no per-player season history.

**Blocker:** full rosters live on ~250 individual school sites, each on Sidearm or a
bespoke platform with its own URL pattern. D1 worked because those domains are known;
D2/D3 needs a school → athletics-domain map built and validated first.

**Unblock plan:** assemble the domain list (Wikipedia infobox athletics sites, then
validate each by fetching `/sports/mens-lacrosse/stats/<year>`), then reuse the D1
Sidearm parser unchanged. Estimated +12k players.

---

## Canadian leagues on the Digitalshift platform

**Status:** superseded. `web.api.digitalshift.ca` serves Angular templates rather than
data; the numeric endpoints are internal and the A–Z player index renders no clickable
elements. Not worth further work while NetFront covers these leagues.

---

## NLL via nllstatsapp.aordev.com

**Status:** superseded. The NLL is imported through NetFront (`nf-nll`, 40 teams
including historical franchises) with season and career tables.

---

## Women's lacrosse

**Status:** not covered. NCAA women's stats follow the same school-site pattern as the
men's game; the same parser should work with `/sports/wlax/`. Unverified.
