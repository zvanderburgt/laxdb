# Design and feature references

What we borrow from, and what we deliberately don't.

## Primary model

**Elite Prospects** (eliteprospects.com) — the product shape: bio card → career stats by
season/team/league → game logs → awards → rankings → scouting → comparables. We rebuilt the
feature set from its known structure because the site sits behind Cloudflare on this network.
UI is deliberately not theirs.

## Lacrosse competitors

**LaxGrid (laxgrid.com) — primary design/feature reference.**
D1/D2/D3 men's and women's, history to 2000. What we want to match in depth:
- Per-game box scores with period scoring and full player lines (G/A/Pts/Sh/GB/CT/TO/Sv)
- Elo team ratings built from every final, with a strength-of-schedule column
- Team stat pages: goals per game, goals allowed per game, shooting %, faceoff %, save %
- Records and championships archives
Match the feature depth; do not copy the visual style.

**College Lacrosse News (collegelacrossenews.com)**
- Rankings hub: USILA coaches poll, NCAA RPI, Inside Lacrosse media poll, by week and division
- Records & history: all-time individual and team records, All-American archives, Tewaaraton
- Recruiting: commitments, transfer portal, camps, NCAA calendar
- "Who Would Win?" — era-adjusted historical matchup simulator

**Goalbound (goalbound.co)**
- Recruiting-origin analytics: where a program recruits, top hometowns and high schools,
  who plays by class, town yield
- Program profiles: record by season, coaches, campus/academics

## Feature ideas taken from Elite Prospects premium

Game logs, advanced stat filters, per-game averages, "coaches played for", player connections
(teammates), export to PDF/Excel, bookmarks, my roster/lineup, generated player stats card.

## Imagery

Headshots are stored square (224×224 webp). Schools publish 3:4 portraits, and a non-square
asset either stretches under `object-fit: fill` or spills out of a square avatar box, so the
importer crop-squares each photo 30% from the top (faces sit high) before resizing. Avatars then
clip with `overflow: hidden` and fill with `object-fit: cover; object-position: 50% 18%`.

## Visual language (ours)

Apple-inspired, not EP's density: system font stack, hairline rules, frosted chrome, one accent
colour, generous whitespace, tables that scroll rather than squeeze.
