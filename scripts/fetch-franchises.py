#!/usr/bin/env python3
"""Group the same club across names — every league, two sources of evidence.

1. **wiki**  A Wikipedia team page carries the lineage in a fixed block:

       :'''Elora Mohawks''' 1967 to 2025
       :'''Elora Hawks''' 2025 to Present

   Junior box lacrosse renames constantly (Mohawks -> Hawks in 2025), and the
   franchise was the Fergus Thistles and Guelph Mohawks before that.

2. **alias** The feeds name one club twice: "Brooklin" and "Brooklin L.C." in MSL,
   "Mimico Mountaineers" and "Mountaineers" in OJBLL. Same-league name containment
   plus **shared players** is the evidence — 14 players appear on both Mimico rows,
   while "Kamloops Venom" and "Venom" share nobody and stay separate. Identical
   names in one league are always the same club.

  python3 scripts/fetch-franchises.py --scan          # review groups, no writes
  python3 scripts/fetch-franchises.py --apply         # write public/franchises.json
  python3 scripts/fetch-franchises.py --scan --league nf-msl

Both sources write the same shape, so the site renders one Franchise card:

    {"id", "source", "names": [{"name", "from", "to", "teamId"}]}
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict

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
COLOURS = {"gold", "purple", "black", "white", "green", "red", "blue", "grey", "gray", "orange"}
FIELD_LEAGUES = {"ncaa-d1"}


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def strip_suffix(name: str) -> str:
    return norm(re.sub(r"\b(jr|junior|senior|sr|tier|i{1,3}|ii|iii|l ?c|lc)\b", " ", name))


# --------------------------------------------------------------------- wikipedia
def api(params: dict) -> dict | None:
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
            return json.loads(r.read())
    except Exception:  # noqa: BLE001
        return None


def wikitext(title: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, re.sub(r"[^a-z0-9]+", "-", title.lower()) + ".json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f).get("wikitext") or ""
    data = api({"action": "parse", "page": title, "prop": "wikitext", "redirects": "1"})
    text = ((data or {}).get("parse") or {}).get("wikitext") or ""
    with open(path, "w") as f:
        json.dump({"title": title, "wikitext": text}, f)
    time.sleep(0.15)
    return text


def candidates(team: dict) -> list[str]:
    name = team["name"]
    if team["leagueId"] in FIELD_LEAGUES:
        return [name, f"{name} men's lacrosse"]
    return [name, f"{name} lacrosse", f"{name} (lacrosse)", f"{name} Jr. A lacrosse", f"{name} Jr. B lacrosse"]


def find_page(team: dict) -> str | None:
    for candidate in candidates(team):
        data = api({"action": "query", "titles": candidate, "redirects": "1"})
        for page in ((data or {}).get("query") or {}).get("pages") or []:
            if not page.get("missing"):
                return page["title"]
    data = api({"action": "query", "list": "search", "srsearch": f"{team['name']} box lacrosse", "srlimit": 3})
    for hit in ((data or {}).get("query") or {}).get("search") or []:
        if norm(team["name"]) in norm(hit["title"]):
            return hit["title"]
    return None


def lineage(text: str) -> list[dict]:
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


def wiki_groups(data: dict, only: str | None) -> tuple[list[dict], list[dict]]:
    by_name: dict[str, list[dict]] = defaultdict(list)
    for team in data["teams"]:
        by_name[norm(team["name"])].append(team)
        by_name[norm(team["shortName"])].append(team)

    groups: list[dict] = []
    partial: list[dict] = []
    checked = pages = chains = 0
    for team in data["teams"]:
        if only and team["leagueId"] != only:
            continue
        checked += 1
        page = find_page(team)
        if not page:
            continue
        pages += 1
        rows = lineage(wikitext(page))
        if len(rows) < 2:
            continue
        chains += 1
        members = []
        for row in rows:
            # only names alive inside the window our stats cover: the Elora franchise
            # was "Fergus Thistles" until 1962, but the Fergus Thistles club we hold is
            # a different, modern organisation reusing the name
            end = row["to"] if row["to"] is not None else 9999
            if end < COVERAGE_START:
                continue
            for candidate in by_name.get(norm(row["name"]), []):
                members.append({**row, "teamId": candidate["id"]})
                break
        if len({m["teamId"] for m in members}) < 2:
            partial.append({"page": page, "names": rows})
            continue
        gid = "f-" + norm(members[-1]["name"]).replace(" ", "-")
        if any(g["id"] == gid for g in groups):
            continue
        groups.append({"id": gid, "source": "wiki", "page": page, "names": members})

    print(f"wiki: {checked} clubs checked · {pages} had a page · {chains} carried a lineage · "
          f"{len(groups)} grouped 2+ clubs we hold · {len(partial)} partly held")
    return groups, partial


# ------------------------------------------------------------------------- alias
def rosters(data: dict) -> dict[str, set[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for p in data["players"]:
        for s in p["seasons"]:
            out[s["teamId"]].add(p["id"])
    return out


def span(data: dict, team_id: str) -> tuple[int | None, int | None]:
    years = [int(s["season"]) for p in data["players"] for s in p["seasons"]
             if s["teamId"] == team_id and str(s["season"]).isdigit()]
    return (min(years), max(years)) if years else (None, None)


def alias_groups(data: dict, only: str | None) -> list[dict]:
    """Same league, one name contained in the other, and players on both rows."""
    roster = rosters(data)
    by_league: dict[str, list[dict]] = defaultdict(list)
    for team in data["teams"]:
        by_league[team["leagueId"]].append(team)

    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    evidence: dict[str, str] = {}
    for league, teams in by_league.items():
        if only and league != only:
            continue
        for a, b in itertools.combinations(teams, 2):
            na, nb = norm(a["name"]), norm(b["name"])
            if na == nb:
                parent[find(a["id"])] = find(b["id"])
                evidence[a["id"]] = "identical name"
                continue
            sa, sb = strip_suffix(a["name"]), strip_suffix(b["name"])
            short, long_ = (sa, sb) if len(sa) <= len(sb) else (sb, sa)
            if not short or len(short.split()) > 2 or short not in long_ or len(short) < 4:
                continue
            # "Coquitlam Adanacs" and "Coquitlam Adanacs Gold" are two squads, not a rename
            if (set(short.split()) & COLOURS) != (set(long_.split()) & COLOURS):
                continue
            shared = roster.get(a["id"], set()) & roster.get(b["id"], set())
            if len(shared) < 2:
                continue
            parent[find(a["id"])] = find(b["id"])
            evidence[a["id"]] = f"{len(shared)} shared players"

    clusters: dict[str, list[dict]] = defaultdict(list)
    for teams in by_league.values():
        for team in teams:
            if team["id"] in parent:
                clusters[find(team["id"])].append(team)

    groups = []
    for members in clusters.values():
        if len({m["id"] for m in members}) < 2:
            continue
        members.sort(key=lambda t: -(span(data, t["id"])[1] or 0))
        names = []
        for i, team in enumerate(members):
            first, last = span(data, team["id"])
            names.append({
                "name": team["name"],
                "from": first,
                "to": None if i == 0 else last,   # newest name stays open
                "teamId": team["id"],
            })
        ids = {m["id"] for m in members}
        note = next((v for k, v in evidence.items() if k in ids), "name match")
        groups.append({
            "id": "f-" + norm(names[0]["name"]).replace(" ", "-"),
            "source": "alias",
            "evidence": note,
            "names": names,
        })
    groups.sort(key=lambda g: -len(g["names"]))
    print(f"alias: {len(groups)} clusters covering {len(parent)} clubs")
    return groups


# ------------------------------------------------------------------------ apply
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--league", help="limit to one league id")
    args = ap.parse_args()

    with open(DATA) as f:
        data = json.load(f)

    wiki, partial = wiki_groups(data, args.league)
    alias = alias_groups(data, args.league)

    # a club already described by a Wikipedia lineage doesn't need an alias group
    claimed = {n["teamId"] for g in wiki for n in g["names"] if n.get("teamId")}
    alias = [g for g in alias if not {n["teamId"] for n in g["names"]} <= claimed]
    groups = wiki + alias

    for g in groups:
        chain = " · ".join(f"{n['name']} ({n['from'] or '?'}–{n['to'] or 'now'})" for n in g["names"])
        print(f"  [{g['source']:<5}] {chain[:112]}")
    for g in partial:
        chain = " · ".join(f"{n['name']} ({n['from'] or '?'}–{n['to'] or 'now'})" for n in g["names"])
        print(f"  [wiki ] (partly held) {g['page'][:30]:<32} {chain[:74]}")

    if not args.apply:
        return 0

    with open(OUT, "w") as f:
        json.dump({"generated": time.strftime("%Y-%m-%d"), "groups": groups}, f, indent=1)

    index = {t["id"]: t for t in data["teams"]}
    for g in groups:
        for n in g["names"]:
            team = index.get(n.get("teamId") or "")
            if not team:
                continue
            team["franchise"] = {
                "id": g["id"],
                "source": g["source"],
                "names": [{k: v for k, v in m.items() if k != "teamId"} | {"teamId": m.get("teamId")}
                          for m in g["names"]],
            }
    with open(DATA, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    tagged = sum(1 for t in data["teams"] if t.get("franchise"))
    print(f"\nwrote {OUT}: {len(groups)} groups, {tagged} clubs tagged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
