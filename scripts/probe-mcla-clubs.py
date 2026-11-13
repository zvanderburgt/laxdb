#!/usr/bin/env python3
"""Do MCLA clubs publish their own rosters, and do those rosters have bios?

mcla.us itself carries name, position, class and stats — no height, weight or hometown.
Many clubs run their own site, and the MCLA team page links to it. This walks a sample and
reports, per club, whether a roster with bios exists, so the decision to scrape 172 sites
(or not) rests on a number.

  python3 scripts/probe-mcla-clubs.py            # 12 clubs, biggest rosters first
  python3 scripts/probe-mcla-clubs.py --limit 30
"""
from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from collections import Counter
from urllib.parse import urljoin, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0 Safari/537.36 LAXDB/1.0"}
JUNK = ("facebook", "twitter", "x.com", "instagram", "youtube", "tiktok", "google", "gstatic",
        "cloudflare", "adlightning", "impactcanopy", "newbalanceteam", "lacrossespecialties",
        "velocitysportinggoods", "mcla.us", "uslacrosse", "ncaa")


def get(url: str, timeout: int = 20) -> str:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.read().decode("utf-8", "ignore")
    except Exception:  # noqa: BLE001
        return ""


def club_sites(html: str) -> list[str]:
    out = []
    for href in re.findall(r'href="(https?://[^"]+)"', html):
        if any(j in href.lower() for j in JUNK):
            continue
        out.append(href)
    return out[:4]


def roster_links(html: str, base: str) -> list[str]:
    seen = []
    for href in re.findall(r'href="([^"]+)"', html):
        if re.search(r"roster|players|team", href, re.I) and not href.startswith(("#", "mailto")):
            url = urljoin(base, href)
            if urlparse(url).netloc == urlparse(base).netloc and url not in seen:
                seen.append(url)
    return seen[:3]


def bios(html: str) -> dict[str, int]:
    low = html.lower()
    return {k: low.count(k) for k in ("hometown", "height", "weight", "major")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=12)
    args = ap.parse_args()

    with open(DATA) as f:
        data = json.load(f)
    sizes = Counter()
    for p in data["players"]:
        if p["leagueId"] == "mcla":
            sizes[p["teamId"]] += 1
    slugs = {t["id"]: t["slug"] for t in data["teams"]}
    # our slugs are prefixed with the league ("mcla-michigan-state"); mcla.us drops it
    ranked = [slugs[t].removeprefix("mcla-") for t, _ in sizes.most_common(args.limit)]

    verdicts = Counter()
    for slug in ranked:
        page = get(f"https://mcla.us/teams/{slug}/2026")
        if not page:
            verdicts["mcla page missing"] += 1
            continue
        sites = club_sites(page)
        if not sites:
            verdicts["no club site"] += 1
            print(f"  {slug:<34} no club site linked")
            continue
        hit = None
        for site in sites:
            home = get(site)
            if not home:
                continue
            for link in [site] + roster_links(home, site):
                html = home if link == site else get(link)
                counts = bios(html)
                if counts["hometown"] or (counts["height"] and counts["weight"]):
                    hit = (link, counts)
                    break
            if hit:
                break
        if hit:
            verdicts["roster with bios"] += 1
            print(f"  {slug:<34} {hit[0][:64]:<66} {hit[1]}")
        else:
            verdicts["roster without bios"] += 1
            print(f"  {slug:<34} site found, no bio fields ({sites[0][:50]})")

    total = sum(verdicts.values())
    print(f"\n{total} clubs: " + " · ".join(f"{k} {v}" for k, v in verdicts.most_common()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
