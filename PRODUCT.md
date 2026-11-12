# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anyone with a lacrosse question — fans, alumni, current players, parents and media — arriving from
search or a shared link to look up a player, team, league, game or record. The product is a broad
consumer database, not a tool for one profession: it should read as the default public reference for
the sport. *(Confirmed with the project owner, 2026-11-12.)*

## Product Purpose

LAXDB is a lacrosse player database rebuilt on the Elite Prospects product shape — bio card, career
stats by season/team/league, game logs, awards, rankings, scouting, comparables — and populated with
real public data. It exists so questions that today require scattered school athletics pages, league
APIs and PDFs can be answered on one profile. Success is becoming the lacrosse reference people reach
for first: the Elite Prospects of lacrosse, at or beyond its depth for this sport. *(Confirmed,
2026-11-12.)*

## Positioning

A single merged career across college field, pro field and the Canadian box pyramid, built from
published feeds with conservative, evidence-based identity matching — delivered in the reference-site
product shape. The position is the combination: one person's whole record, one interface, every number
traceable. A site with depth in one tier or one competition is not the same product.

## Operating Context

- People browse on desktop and phone, usually to answer one specific question, and share deep links
  into filtered tables and comparisons. There is no account and no saved server-side state; "My
  roster" lives in the browser.
- Data work is a first-class part of the product: Python importers read school athletics sites
  (Sidearm), NCAA.com statistic pages, the PLL stats API, MCLA and NetFront's Canadian box pages,
  cache every response, and rebuild the dataset through `scripts/rebuild-all.sh`. Logos and headshots
  are topped up by separate passes.
- The site is currently a static, hash-routed Vite build deployed to Netlify from GitHub
  (`laxdb.netlify.app`), with no server or API keys. That is the present implementation, not a
  confirmed permanent constraint.
- The indexed span is 2021/2022–2026. Any "career" or "all-time" statement on the site means that
  span, and the interface says so.

## Capabilities and Constraints

- Roughly 21.8k players, 471 teams, 19 competitions and 34.9k player-seasons: 72 NCAA D1 programs,
  172 MCLA teams, the PLL, and 16 Canadian box leagues down to Junior C.
- Routes cover the home page, player directory and profiles, teams, leagues, compare (up to three),
  my roster, history and records, origins by state, stat leaders, scores, head-to-head series and
  single games. Filters and comparisons live in the URL.
- Analysis includes team Elo and strength of schedule, conference breakdowns, returning production,
  teammates, comparable players, peer rank, All-America honours, situational splits,
  opponent-adjusted scoring, a competition-normalised points index, qualification minimums and CSV
  export.
- **Hard constraint, confirmed: real data only.** No synthetic names, stat lines or invented metrics.
  When a source does not publish something, the UI hides it or labels the gap rather than guessing.
- Source limits that shape the product: NCAA D2/D3, prep and international play are not covered yet;
  goalies appear only when they qualified on a leaderboard; box leagues publish one season of detail
  per team page plus their own career aggregate; headshots exist for PLL and most D1 players but not
  MCLA or box; no date of birth is published, so cross-league identity matching stays deliberately
  conservative and can leave two profiles for one person.
- Rates (PTS/G, SH%, SV%, GAA, FO%) are computed at render time from stored raw counts, so totals and
  tables cannot disagree.
- Open decisions: extending season depth to 2000, adding D2/D3 and women's lacrosse, and whether
  accounts, an API or any paid tier should exist. None of these is decided.

## Brand Commitments

- Name: **LAXDB**, described as "the lacrosse player database".
- The interface is deliberately not Elite Prospects' UI, and the project has already rejected a
  Shadcn/Tailwind rebuild in favour of its own system. The incumbent Apple-inspired visual language —
  system type, hairline structure, frosted chrome, one accent, data first — is documented in
  `README.md`, `docs/design-notes.md` and `src/styles.css`.

## Evidence on Hand

- Real dataset: `src/data/dataset.json`; game logs: `public/games.json`; scores:
  `public/scores.json`; history: `public/history-results.json`; poll history:
  `public/rankings-history.json`.
- Assets: 3,615 player headshots under `public/players/` and 252 team marks under `public/logos/`.
- Browser-verified competitive research in `docs/competitive-scan.md` (13 sites, dated 2026-11-12),
  roadmap and merge policy in `docs/roadmap.md`, source coverage and stated gaps in `README.md`, and
  a dated changelog in `CHANGELOG.md`.
- Live site: https://laxdb.netlify.app · repository: `github.com/zvanderburgt/laxdb`.
- Absent: testimonials, press coverage, user research, analytics and revenue figures. Future work
  must not fabricate them.

## Product Principles

1. **Real data or nothing.** A missing number is acceptable; an invented one is not. Hide the tab or
   label the gap.
2. **One person, one profile.** Merge seasons across teams and competitions only on evidence; a shared
   name alone is never enough.
3. **Put the caveat beside the number.** Qualification minimums, coverage spans, aggregate labels and
   provenance belong on the page, not in a footnote nobody reads.
4. **Match reference-site depth; keep our own interface.** Feature ambition comes from the best
   references in sport; the look and feel does not.
5. **Answer without a hunt.** Search, deep links, comparisons and one-hop navigation should get a
   visitor from question to answer in seconds.
