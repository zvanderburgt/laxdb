# Closing the data gaps

What stands between the dataset and a complete player record, ordered by yield against
effort. Every number here comes from `python3 scripts/coverage.py --save`; the snapshot
lives in `docs/coverage-history.json`, so progress is a diff, not an opinion.

**Snapshot 2026-11-12** — 21,754 players · 471 clubs · 37,369 player-seasons · 19 leagues

| | |
| --- | --- |
| players with no photo, birth date, hometown, height or weight | **16,811 (77%)** |
| photo / hometown / height / weight / jersey | 20% / 19% / 18% / 17% / 61% |
| birth date | 6% |
| club logos | 344 of 471 (73%) |
| club staff | 244 of 471 (52%) |
| players with a game log | 3,044 (14%) |
| handedness | 0% — **no source publishes it**, not a failed import |

Two facts decide the whole plan. Everything cheap has already been imported; and the
remaining gaps are uneven — half of all empty profiles sit in one league (MCLA), and a
third of the fixable ones sit in one league-season range (NCAA D1, 2022–2025).

---

## Phase 1 — D1 historical rosters — SHIPPED 2026-11-12

`scripts/fetch-d1-rosters.py` · 288 schools × seasons · 290 pages cached.

| | before | after |
| --- | --- | --- |
| D1 players with no bio | 3,938 | **48** |
| D1 core score | 36% | **76%** |
| D1 photo / height / hometown | 44 / 44 / 45% | **68 / 98 / 99%** |
| D1 weight / jersey | 38 / 45% | **91 / 98%** |
| D1 high school / class year | 34 / 33% | **76 / 76%** |
| empty profiles, whole site | 16,811 (77%) | **12,890 (59%)** |
| players with a headshot | 4,427 | **6,088** |

The remaining D1 gap is birth date (1%, no college source publishes it) and the ~32% of
photos the archived pages don't carry.

One school needs no work: **Iona**'s men's programme began in 2025 (first game
2025-02-01), so its 2022–2024 roster URLs serve the current roster — a soft 404, not a
parser failure. The script now says so instead of reporting a nameless "none matched".

<details><summary>Original plan, kept for the repeatability notes</summary>

**Gap:** 3,938 D1 players with no bio at all. Coverage by season explains why:

| season | player-seasons | photo | height | hometown |
| --- | --- | --- | --- | --- |
| 2022 | 2,950 | 3% | 3% | 3% |
| 2023 | 2,904 | 18% | 19% | 19% |
| 2024 | 3,016 | 39% | 39% | 40% |
| 2025 | 3,151 | 67% | 66% | 68% |
| 2026 | 3,130 | 98% | 97% | 99% |

The importer enriches the **current** season from each school's roster page and nothing
else. Every earlier season is dark, which is why no single school looks at fault.

**Source:** archived per-season roster pages, `/sports/mens-lacrosse/roster/<year>`.
Verified on `goprincetontigers.com/…/roster/2023` and `umassathletics.com/…/roster/2024`:
each carries jersey, position, class year, height, weight, hometown, *last school*
(the high-school field we have almost nowhere) and a headshot.

**Work:**
1. Walk every D1 school for seasons 2022–2025 (`scripts/fetch-d1-rosters.py`, new). Reuse
   the roster parser the current-season import already has; the only new part is the
   season URL and the photo download.
2. Fall back to the site's own season picker when the URL 404s — the four unmapped hosts
   (Notre Dame, Virginia, Penn State, VMI) are a URL-template job, already in
   `docs/deferred-sources.md`.
3. Square-crop photos at import (224×224, 30% vertical bias) like the existing pass.

**Expected:** ~3,400 players gain a bio, ~7,900 player-seasons enriched, D1 core 36% → ~75%.
Fills four fields at once: photo, height, weight, hometown. Also unlocks *high school*
(89% missing) and *class year* (89% missing) for D1 specifically, and improves duplicate
merging — a class year plus a hometown is real evidence.

**Effort:** medium. One new script, 72 schools × 4 seasons, mostly request volume.

</details>

**Repeatable:** `python3 scripts/fetch-d1-rosters.py --apply` (add `--season 2024` or
`--only princeton` to narrow it). Pages are cached under `scripts/.cache/d1`, and a school
with no archived page is remembered as a `.miss` marker, so a second run makes almost no
requests: the 290 pages that exist are read from disk and the rest are skipped in one
stat() per season. It is wired into `scripts/rebuild-all.sh` after the headshot pass.

---

## Phase 2 — finish the box leagues GameSheet already covers — SHIPPED 2026-11-12

`scripts/gamesheet-gap.py` (diagnostic) + hardened parsers in `scripts/gamesheet.py`.

**The estimate in this section was wrong, and the diagnostic is why.** Of the 1,979 players
in GameSheet-covered leagues still short a photo or height:

| bucket | players | meaning |
| --- | --- | --- |
| no GameSheet row at all | 1,123 (57%) | the club-season isn't in GameSheet — nothing to match |
| row exists, carries no bio | 570 (29%) | OJCL especially: the row has a name and stats only |
| same name, we missed it | 89 (4.5%) | real matching bugs |
| "Parker Robbins AP" style names | 49 (2.5%) | affiliate/captain suffixes |
| same jersey, different name | 148 (7.5%) | coincidence, not evidence; left alone |

So the ceiling here was ~140 players, not the 1,000–1,500 predicted. Matching was already
mostly right; GameSheet's *coverage* is the limit.

**What was actually broken, and fixed:**

- **Centimetre heights were discarded.** The junior feed publishes `height: 160`, which
  needs converting (63in); the old parser only read feet-and-inches and silently produced 0.
- **A height string in the weight column became pounds.** `weight: "5”10"` fell through to
  `10`, and 21 players were listed at 10–11 lb. Weights are now range-gated to 100–350 lb
  and any quote mark is refused outright; implausible values already in the dataset are
  cleared on load and refilled from the corrected parser.
- **`"511"`** (the feed's concatenated 5'11") is read as feet and inches.
- **Affiliate and captain markers** — `PARKER ROBBINS AP`, `JACK WEBLEY(AP)`, `RYDER PERRY ☆`
  — are stripped before name comparison, so those rows match.

**Result**

| | before | after |
| --- | --- | --- |
| OJBLL core | 57% | 61% |
| NLL core | 13% | 19% |
| MSL core | 19% | 21% |
| OSL core | 10% | 11% |
| OJCL core | 34% | 35% |
| PLL core (merged careers) | 38% | 53% |
| players with a height | 7,983 | 8,094 |
| players with a photo | 6,088 | 6,127 |
| implausible weight / height values | 21 / 4 | **0 / 0** |
| empty profiles, whole site | 12,890 | **12,809** |

**Repeatable:** `python3 scripts/fetch-gamesheet.py --apply` (cache under `scripts/.cache/gs`,
`--no-seasons` for bios only, `--only <league>` to narrow). The gap diagnostic is
`python3 scripts/gamesheet-gap.py` and costs nothing but disk reads on a warm cache.

---

## Phase 2 (original plan, kept for context)

**Gap:** the box leagues we do enrich are still half empty — OJLL 62% core, OJBLL 57%,
OJCL 34%, MSL 19%, NLL 13%, OSL 10%, RMLL Jr A 14%. The importer reports **14,601
GameSheet rows whose name we don't hold** and 1,283 with no club match.

**Source:** `gamesheetstats.com/api/players/standings/<seasonId>` — open, no token, already
wired in `scripts/gamesheet.py`.

**Work:**
1. Loosen matching one step at a time, measuring each: club alias map (already have
   `public/franchises.json`), town-level ties, then birth-date-only linking for the
   leftover unambiguous names.
2. Add the remaining GameSheet seasons for leagues we hold (RMLL Senior A, WCSLA, NLL).
3. Record every unmatched row to `scripts/.cache/gs/unmatched.json` so the next pass
   reviews 200 rows instead of 14,601.

**Expected:** +1,000–1,500 players enriched; box photo coverage from ~1 in 5 to ~1 in 3.

**Effort:** small-medium, and it compounds with Phase 1's merge evidence.

---

## Phase 3 — the box leagues with no bio feed at all — PART SHIPPED 2026-11-12

### BCJALL — done

`scripts/fetch-digitalshift.py` renders each club's roster in headless Chromium and reads
the table. The platform's own API answers 401 outside the browser, so the rendered DOM is
the only way in — but it carries more than any feed we hold:

    # | Name | POS | Shoots | Height | Weight | Hometown | Minor Association | Collegiate Team

| | before | after |
| --- | --- | --- | --- | --- |
| BCJALL core | 3% | **18%** |
| height / weight / hometown | 3 / 3 / 2% | **35 / 32 / 35%** |
| handedness, whole dataset | 0 | **148 players** |

**Handedness exists here.** It was the one field marked "no source publishes it" — the
BCJALL roster prints `Shoots`, and the player page already renders `RH right-handed`. 148
players now have it, split 74 left / 74 right.

8 clubs read, 228 riders, 211 matched. Our dataset lists 16 BCJALL clubs because it keeps
the defunct ones; the league currently fields 8.

### The other six leagues: mapped, and the answer is "not configured for bios"

Each one was checked, not assumed:

| league | what the domain does | result |
| --- | --- | --- |
| PNWJLL | still serves its own platform (league 675) | roster table is `# · Name · POS` — **no bio columns**. 7 clubs, 44 riders read, 0 fillable |
| WCJLL, TOJLL, RMLL Jr B T-I/T-II, RMLL Sr B | 301 to `canadianlacrosseleague.com` | the umbrella site exposes no league index — only league 188, an international competition — and its stats route rejects our ids |
| WLA | does not answer (60-byte response, TLS failure) | no route |

So the extended roster table is a **per-league configuration** on that platform, not a
platform feature: BCJALL switched it on, PNWJLL did not, and the redirected leagues cannot
be addressed at all. The scraper keeps the entry-path plumbing (`LEAGUES` is now
`(site, entry_path)`) so a league that turns bios on can be picked up with one line, and a
plain `# · Name · POS` table now reports "0 filled" instead of looking like a crash.

**What's left for these leagues:** the data has to come from the league itself — the
configuration is on their side.

---

## Phase 3 (original plan, kept for context)

**Gap:** ~2,600 players at 0–3% core: **RMLL Junior B Tier 1 (458), Tier 2 (667), TOJLL
(326), WCJLL (486), PNWJLL (181), WLA (195), RMLL Senior B (170), BCJALL (451)**.

**Why it's stuck:** netfront publishes stat lines only, and **GameSheet does not index any
of these leagues** — checked, there is no entry for RMLL Jr B, TOJLL, WCJLL or PNWJLL in
its league list. So no existing feed will fill them.

**Work:** one small scraper per league, in the shape of `fetch-gamesheet.py`:
1. Start with **BCJALL** and **WCJLL** — both run current league sites with player pages,
   and BCJALL is the strongest league of the set.
2. Each pass should take logos and staff off the same pages (127 clubs have no logo, 227
   have no staff, and these leagues are the bulk of both).
3. If a league has no player page at all, record it in `docs/deferred-sources.md` and stop
   citing it as a gap.

**Expected:** +1,500–2,000 players enriched, logo coverage 73% → ~95%, staff 52% → ~80%.

**Effort:** medium (2–3 scrapers), then cheap repetition.

---

## Phase 4 — MCLA, decide once — SHIPPED 2026-11-12 (option 1)

**Probe result: the club sites are not a source.** `scripts/probe-mcla-clubs.py` walked the
12 largest MCLA clubs, following the club website each MCLA team page links to:

| | clubs |
| --- | --- |
| roster with height/weight/hometown | **0** |
| club site, roster without bios | 7 |
| no club site linked | 2 |
| "bio markers" that were Wix CSS, not data | 3 |

So the 172-club crawl is off the table — the share with real bios is 0%, well under the
50% bar this plan set. 8,297 MCLA players stay statistics-only, and that is the source's
limit, not a missing import.

**Shipped instead — say so on the page.** Any player with no photo, birth date, hometown,
height, weight, high school or class year now carries a line in the hero and in the
Profile card:

> Statistics only — MCLA publishes no player bios, so there is no birth date, hometown,
> height or photo in the source.

It applies wherever the data is absent, not just MCLA: 12,598 players site-wide, 8,237 of
them MCLA. The rest are the box leagues in Phase 3 that are still waiting on the division
map, and the line will quietly disappear for them as those fills land.

---

## Phase 4 (original plan, kept for context)

**Gap:** 8,297 players — half of every empty profile on the site — at 16% core, and 0% on
photo, birth date, hometown, height and weight.

**What I checked:** `mcla.us/teams/<slug>/<year>/roster` renders a roster, but the page
carries name, position and class only — zero occurrences of "hometown", zero of "weight".
MCLA does not publish bios. This is not a parser we forgot to run.

**Options, cheapest first:**
1. **Accept and label** — MCLA is a club league; mark those profiles "stats only" in the
   UI so the emptiness is honest rather than looking broken. *Cost: an afternoon.*
2. **School club sites** — many MCLA teams run their own site with a real roster (height,
   weight, hometown). Sample 10, measure the hit rate, then decide whether 172 club sites
   are worth it. *Cost: medium, uneven.*
3. **Drop MCLA from the "should have bios" set** — it stays a stat database with a note.

**Recommendation:** do 1 now, run 2 as a 10-club probe, and only scale 2 if the probe
finds bios on more than half.

---

## Phase 5 — the long tail

| gap | size | source | note |
| --- | --- | --- | --- |
| game logs | 18,710 players | netfront box scores, ESPN | D1 + PLL only today; box game sheets exist per league |
| birth dates, PLL | 410 of 420 | PLL API | 403 on a bare GET; the importer's headers work |
| birth dates, NCAA | 7,076 | — | college rosters do not publish DOB; structural, leave it |
| staff | 227 clubs | league + club sites | free once Phase 3's scrapers exist |
| logos | 127 clubs | same | free once Phase 3's scrapers exist |
| handedness | 21,754 | — | nobody publishes it; remove from all gap reporting |

---

## Targets

After each phase, `scripts/coverage.py --save` should show:

| after | empty profiles | photo | height | logo | staff |
| --- | --- | --- | --- | --- | --- |
| baseline 2026-11-12 | 16,811 | 20% | 18% | 73% | 52% |
| **Phase 1 — done** | **12,890** | **28%** | **32%** | 73% | 52% |
| **Phase 2 — done** | **12,809** | **28%** | **37%** | 73% | 52% |
| Phase 3 | ~9,800 | 40% | 42% | 95% | 80% |
| Phase 4 (option 1) | ~9,800 + honest label | — | — | — | — |

Phase 1 beat its target (predicted 13,400 empty, delivered 12,890) because the archived
pages also carried the *last school* and class year, which the current-season parser drops
on some hosts.

A floor worth stating plainly: **birth date will never reach parity** (only box and pro
feeds publish it) and **handedness will stay at zero**. Everything else on this page is
reachable from a source we have already proven.

---

## Rules for every pass

- Measure before and after: `python3 scripts/coverage.py --save`, then diff
  `docs/coverage-history.json`.
- Import only what the source actually publishes; never infer a birth date, height or
  hometown from a name or a team.
- A new feed is a new script beside the others, wired into `scripts/rebuild-all.sh`, so the
  gap closes again on the next run instead of needing this document.
- If a source turns out to be empty, write it down in `docs/deferred-sources.md` the same
  day — the next pass should not re-run a dead end.
