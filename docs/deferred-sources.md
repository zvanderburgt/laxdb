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
