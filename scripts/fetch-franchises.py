#!/usr/bin/env python3
"""Group clubs that were renamed or relocated, using Wikipedia.

Junior box lacrosse is full of renames: the Elora Mohawks became the Elora Hawks
in 2025, and the same franchise has been the Fergus Thistles and the Guelph
Mohawks. Our feeds treat each name as a separate club, so a player's career splits
across rows and two "clubs" share one arena.

Wikipedia team pages carry the lineage in a predictable block:

    :'''Fergus Thistles''' 19xx – 1962
    :'''Guelph Mohawks''' 1963 – 1966
    :'''Elora Mohawks''' 1967 to 2025
    :'''Elora Hawks''' 2025 to Present

  python3 scripts/fetch-franchises.py --scan     # what Wikipedia knows, no writes
  python3 scripts/fetch-franchises.py --apply    # write team.franchise into data.json

Matching is name-exact against our own team rows (loose case/punctuation), so a
lineage only groups clubs we actually hold.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
CACHE = os.path.join(ROOT, "scripts", ".cache", "wiki")
OUT = os.path.join(ROOT, "public", "franchises.json")

UA = {"User-Agent": "LAXDB/1.0 (lacrosse database; https://laxdb.netlify.app)"}
API = "https://en.wikipedia.org/w/api.php"

# :'''Name''' 1967 to 2025   |   :'''Name''' 19xx – 1962
LINEAGE = re.compile(r"^:\s*'{2,3}([^']+?)'{2,3}\s*(\d{2,4}[^\n]*)$", re.M)
COVERAGE_START = 2021   # our earliest season; a lineage name that ended before it is not ours
YEAR = re.compile(r"(\d{4})")


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def api(params: dict) -> dict | None:
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
            return json.loads(r.read())
    except Exception:  # noqa: BLE001
        return None


def wikitext(title: str) -> str | None:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, re.sub(r"[^a-z0-9]+", "-", title.lower()) + ".json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f).get("wikitext")
    data = api({"action": "parse", "page": title, "prop": "wikitext", "redirects": "1"})
    text = ((data or {}).get("parse") or {}).get("wikitext")
    with open(path, "w") as f:
        json.dump({"title": title, "wikitext": text}, f)
    time.sleep(0.2)
    return text


def find_page(team_name: str) -> str | None:
    """Exact title first, then a lacrosse-scoped search."""
    for candidate in (team_name, f"{team_name} lacrosse"):
        data = api({"action": "query", "titles": candidate, "redirects": "1"})
        pages = ((data or {}).get("query") or {}).get("pages") or []
        for page in pages:
            if page.get("missing"):
                continue
            if norm(page.get("title", "")).startswith(norm(team_name).split()[0]):
                return page["title"]
    data = api({"action": "query", "list": "search", "srsearch": f"{team_name} box lacrosse", "srlimit": 3})
    for hit in ((data or {}).get("query") or {}).get("search") or []:
        if norm(team_name) in norm(hit["title"]):
            return hit["title"]
    return None


def lineage(text: str) -> list[dict]:
    """Years per name from the :'''Name''' years block, oldest first."""
    rows = []
    for name, years in LINEAGE.findall(text or ""):
        found = YEAR.findall(years)
        if not found and "present" not in years.lower():
            continue
        if "present" in years.lower():
            start, end = (int(found[0]) if found else None), None
        elif len(found) >= 2:
            start, end = int(found[0]), int(found[-1])
        elif found:
            start, end = None, int(found[0])       # "19xx – 1962" only has the end
        else:
            start = end = None
        rows.append({"name": name.strip(), "from": start, "to": end})
    return rows


def run(apply: bool):
    with open(DATA) as f:
        data = json.load(f)

    by_name: dict[str, list[dict]] = {}
    for team in data["teams"]:
        by_name.setdefault(norm(team["name"]), []).append(team)
        by_name.setdefault(norm(team["shortName"]), []).append(team)

    groups: list[dict] = []
    checked = 0
    pages = 0
    chains = 0
    partial: list[tuple[str, list[dict]]] = []
    for team in data["teams"]:
        if team["leagueId"] not in {"nf-ojbll", "nf-ojll", "nf-ojcll", "nf-msl", "nf-osl",
                                    "nf-wla", "nf-wcsla", "nf-bcjall", "nf-tojll", "nf-wcjll",
                                    "nf-pnwjll", "nf-rmll-junior-a", "nf-rmll-junior-b-tier-1",
                                    "nf-rmll-junior-b-tier-2", "nf-rmll-senior-b", "nf-nll"}:
            continue
        page = find_page(team["name"])
        checked += 1
        if not page:
            continue
        pages += 1
        rows = lineage(wikitext(page) or "")
        if len(rows) < 2:
            continue
        chains += 1
        members = []
        for row in rows:
            # only names alive inside the window our stats cover: the Elora franchise
            # was "Fergus Thistles" until 1962, but the Fergus Thistles club we hold is
            # a different, modern organisation that reuses the name
            end = row["to"] if row["to"] is not None else 9999
            if end < COVERAGE_START:
                continue
            key = norm(row["name"])
            for candidate in by_name.get(key, []):
                members.append({"name": row["name"], "from": row["from"], "to": row["to"], "teamId": candidate["id"]})
                break
        if len({m["teamId"] for m in members}) < 2:
            partial.append((page, rows))
            continue
        gid = "f-" + norm(members[-1]["name"]).replace(" ", "-")
        if any(g["id"] == gid for g in groups):
            continue
        groups.append({"id": gid, "page": page, "names": members})

    print(f"checked {checked} clubs · {pages} had a Wikipedia page · {chains} carried a lineage · "
          f"{len(groups)} grouped at least two clubs we hold")
    for g in groups:
        chain = " -> ".join(f"{n['name']} ({n['from'] or '?'}-{n['to'] or 'now'})" for n in g["names"])
        linked = sum(1 for n in g["names"] if n.get("teamId"))
        print(f"  {g['id']:<34} {linked}/{len(g['names'])} held   {chain[:96]}")
    if partial:
        print("\nlineages we only partly hold (one name in our data):")
        for page, rows in partial:
            chain = " -> ".join(f"{r['name']} ({r['from'] or '?'}-{r['to'] or 'now'})" for r in rows)
            print(f"  {page[:44]:<46} {chain[:88]}")

    if apply:
        with open(OUT, "w") as f:
            json.dump({"generated": time.strftime("%Y-%m-%d"), "groups": groups}, f, indent=1)
        index = {t["id"]: t for t in data["teams"]}
        for g in groups:
            others = [n for n in g["names"] if n.get("teamId")]
            for n in others:
                team = index[n["teamId"]]
                team["franchise"] = {
                    "id": g["id"],
                    "names": [{k: v for k, v in m.items() if k != "teamId"} | {"teamId": m.get("teamId")} for m in g["names"]],
                }
        with open(DATA, "w") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"\nwrote {OUT} and team.franchise on {sum(1 for t in data['teams'] if t.get('franchise'))} clubs")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    return run(apply=args.apply)


if __name__ == "__main__":
    sys.exit(main())
