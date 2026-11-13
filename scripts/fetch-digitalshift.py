#!/usr/bin/env python3
"""Bios for the box leagues that publish them on Digitalshift.

BCJALL, WCJLL, TOJLL, PNWJLL, RMLL (Jr B tiers, Senior B) and the WLA all run the same
league platform. Its player API answers 401 outside the browser, but the rendered roster
table carries more than any feed we hold:

    # | Name | POS | Shoots | Height | Weight | Hometown | Minor Association | ...

Height, weight, hometown and — for the first time anywhere in this dataset — handedness.

  python3 scripts/fetch-digitalshift.py                  # report, no writes
  python3 scripts/fetch-digitalshift.py --apply
  python3 scripts/fetch-digitalshift.py --league bcjall --apply
  python3 scripts/fetch-digitalshift.py --refresh        # ignore the row cache

Rendered rows are cached per league under scripts/.cache/ds, so a second run is a disk
read and the browser only starts when something is missing.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import cdp  # noqa: E402

DATA = os.path.join(ROOT, "public", "data.json")
CACHE = os.path.join(ROOT, "scripts", ".cache", "ds")

# our league id -> (site, optional entry path that already scopes the league)
# A domain that 301s to another host cannot be scraped here; the entry path is for sites
# whose league route is not linked from the root page (PNWJLL hides its division behind it).
LEAGUES = {
    "nf-bcjall": ("https://www.bcjall.com", None),
    "nf-pnwjll": ("https://www.pnwjll.com", "/stats#/675/teams?division_id=51261"),
    # these three only redirect to canadianlacrosseleague.com; see docs/deferred-sources.md
    "nf-wcjll": ("https://www.wcjll.com", None),
    "nf-tojll": ("https://www.tojll.com", None),
    "nf-rmll-junior-b-tier-1": ("https://www.rmll.ca", None),
    "nf-rmll-junior-b-tier-2": ("https://www.rmll.ca", None),
    "nf-rmll-senior-b": ("https://www.rmll.ca", None),
    "nf-wla": ("https://www.wla.ca", None),
}

READ_ROSTER = """
(() => {
  const tables = [...document.querySelectorAll('table')];
  // prefer the extended roster, but accept a plain name/position table too: that is the
  // honest answer for a league that publishes no bios, and it shows up as 0 filled rather
  // than as a silent failure
  const rich = tables.filter(x => {
    const head = [...x.querySelectorAll('th')].map(h => h.innerText.trim().toLowerCase()).join('|');
    return head.includes('name') && (head.includes('height') || head.includes('hometown'));
  });
  const t = rich[0] || tables.find(x => {
    const head = [...x.querySelectorAll('th')].map(h => h.innerText.trim().toLowerCase()).join('|');
    return head.includes('name') && head.includes('pos');
  });
  if (!t) return null;
  const heads = [...t.querySelectorAll('thead th')].map(h => h.innerText.trim());
  const rows = [...t.querySelectorAll('tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => td.innerText.trim())
  ).filter(r => r.length > 3);
  return {heads, rows};
})()
"""

TEAMS_LINKS = """
(() => [...new Set([...document.querySelectorAll('a')]
  .map(a => a.getAttribute('href'))
  .filter(h => h && /#\\/\\d+\\/teams/.test(h)))])
"""

TEAM_LINKS = """
(() => [...document.querySelectorAll('a')]
  .map(a => a.getAttribute('href'))
  .filter(h => h && /#\\/team\\/\\d+\\/roster/.test(h))
  .filter((h, i, arr) => arr.indexOf(h) === i))()
"""


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("&", " and ").replace("-", " ").replace("'", "")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def name_key(text: str) -> str:
    key = re.sub(r"\b(jr|sr|ii|iii|iv)\b", " ", norm(text))
    return re.sub(r"\s+", " ", key).strip()


def inches(text: str) -> int:
    m = re.search(r"(\d)\s*['’]\s*(\d{1,2})", text or "")
    if m:
        return int(m.group(1)) * 12 + int(m.group(2))
    return 0


def pounds(text: str) -> int:
    m = re.search(r"(\d{2,3})", text or "")
    if not m:
        return 0
    n = int(m.group(1))
    return n if 100 <= n <= 350 else 0


def hand_of(text: str) -> str:
    key = (text or "").strip().lower()
    if key.startswith("l"):
        return "L"
    if key.startswith("r"):
        return "R"
    return ""


async def scrape(site: str, refresh: bool, entry: str | None = None) -> tuple[list[dict], int]:
    slug = re.sub(r"[^a-z0-9]+", "-", site.split("//")[1]).strip("-")
    path = os.path.join(CACHE, f"{slug}.json")
    if os.path.exists(path) and not refresh:
        with open(path) as f:
            payload = json.load(f)
        return payload["players"], payload.get("teams", 0)

    page = await cdp.open_page(site + entry if entry else site, wait=10.0)
    players: list[dict] = []
    teams = 0
    try:
        # the league-scoped teams route is not always linked from the root page
        teams_links = await page.eval(TEAMS_LINKS) or []
        if not teams_links and not entry:
            await page.goto(site + "/stats", wait=6.0)
            teams_links = await page.eval(TEAMS_LINKS) or []
        roster_links: list[str] = []
        if teams_links:
            await page.goto(site + teams_links[0], wait=6.0)
            roster_links = await page.eval(TEAM_LINKS) or []
        if not roster_links:
            # fall back to whatever roster links the current page already exposes
            roster_links = await page.eval(TEAM_LINKS) or []
        if not roster_links:
            # one more settle: this platform lazily paints the team grid
            await asyncio.sleep(6)
            roster_links = await page.eval(TEAM_LINKS) or []
        for href in roster_links:
            table = None
            # the hash-routed app paints the table a beat after load; retry once rather
            # than silently dropping the club from the pass
            # the hash route repaints a couple of seconds after the shell loads; below
            # ~7s half the clubs come back with no table at all
            for wait in (9.0, 12.0):
                await page.goto(site + href, wait=wait)
                table = await page.eval(READ_ROSTER)
                if table:
                    break
            if not table:
                continue
            teams += 1
            heads = [h.lower() for h in table["heads"]]
            col = {k: next((i for i, h in enumerate(heads) if k in h), None)
                   for k in ("name", "pos", "shoots", "height", "weight", "hometown")}
            team_name = (await page.eval("document.title") or "").split(" - ")[0].strip()
            for row in table["rows"]:
                if col["name"] is None or col["name"] >= len(row):
                    continue
                players.append({
                    "name": row[col["name"]],
                    "team": team_name,
                    "pos": row[col["pos"]] if col["pos"] is not None and col["pos"] < len(row) else "",
                    "shoots": row[col["shoots"]] if col["shoots"] is not None and col["shoots"] < len(row) else "",
                    "height": row[col["height"]] if col["height"] is not None and col["height"] < len(row) else "",
                    "weight": row[col["weight"]] if col["weight"] is not None and col["weight"] < len(row) else "",
                    "hometown": row[col["hometown"]] if col["hometown"] is not None and col["hometown"] < len(row) else "",
                    "season": "",
                    "team_name": team_name,
                })
    finally:
        await page.ws.close()
    os.makedirs(CACHE, exist_ok=True)
    with open(path, "w") as f:
        json.dump({"players": players, "teams": teams}, f)
    return players, teams


async def main_async(args) -> int:
    with open(DATA) as f:
        data = json.load(f)
    team_by_id = {t["id"]: t for t in data["teams"]}
    by_name: dict[str, list[dict]] = defaultdict(list)
    for p in data["players"]:
        by_name[name_key(p["name"])].append(p)

    filled = defaultdict(int)
    for league_id, cfg in LEAGUES.items():
        if args.league and args.league != league_id:
            continue
        site, entry = cfg
        rows, teams = await scrape(site, args.refresh, entry)
        if not rows:
            print(f"  {league_id}: no roster rows ({site})")
            continue
        ours = [t for t in data["teams"] if t["leagueId"] == league_id]
        hits = 0
        for row in rows:
            club = norm(row.get("team_name") or "")
            for p in by_name.get(name_key(row["name"]), []):
                on_league = [s for s in p["seasons"]
                             if team_by_id.get(s["teamId"], {}).get("leagueId") == league_id]
                if not on_league:
                    continue
                if club:
                    names = set()
                    for s in on_league:
                        t = team_by_id.get(s["teamId"]) or {}
                        names |= {norm(t.get("name", "")), norm(t.get("shortName", ""))}
                    squashed = {n.replace(" ", "") for n in names}
                    if not (club in names or {club.replace(" ", "")} & squashed
                            or any(n and n in club for n in names)):
                        continue
                hits += 1
                if not p.get("heightIn") and inches(row["height"]):
                    p["heightIn"] = inches(row["height"])
                    filled["heightIn"] += 1
                if not p.get("weightLb") and pounds(row["weight"]):
                    p["weightLb"] = pounds(row["weight"])
                    filled["weightLb"] += 1
                if row["hometown"] and not (p.get("birthplace") or {}).get("city"):
                    bp = dict(p.get("birthplace") or {"city": "", "state": "", "country": ""})
                    bp["city"] = row["hometown"]
                    bp["country"] = bp.get("country") or "CAN"
                    p["birthplace"] = bp
                    filled["birthplace"] += 1
                if row["shoots"] and not p.get("hand"):
                    p["hand"] = hand_of(row["shoots"])
                    filled["hand"] += 1
                break
        print(f"  {league_id:<26}{len(ours):>4} clubs {teams:>3} read  {len(rows):>5} riders  {hits:>4} matched")

    print("\n" + " · ".join(f"{k} +{v}" for k, v in filled.items()) if filled else "\nnothing filled")
    if args.apply:
        with open(DATA, "w") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"wrote {DATA}")
    else:
        print("dry run — pass --apply to write")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--league", help="limit to one of our league ids")
    ap.add_argument("--refresh", action="store_true")
    return asyncio.run(main_async(ap.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
