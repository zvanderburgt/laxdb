#!/usr/bin/env python3
"""Parse the Lacrosse Bible / Bibliotheque OJLL archive (lacrossebible.ca) — dry run first.

Each season is a plain-text file (1933–2016, 75 files, ~1.9 MB) holding:

    FINAL STANDINGS              team rows: games won lost tied gf ga pts
    PLAYOFFS                     series results
    Official All-Star Teams
    <YEAR> <CLUB>                 per club:
      REGULAR SEASON              header GAMES GOALS ASSISTS POINTS PEN.MIN
        <player rows>
      Goaltenders                 header GP MIN W L T GA GAA SV SV%
      PLAYOFFS                    the same two tables again for the playoffs

The files are fixed-width and the column set changes with the era (1955 has three
numeric columns, 2016 has five plus a goalie block), so the parser reads the header
row above each block instead of assuming positions.

  python3 scripts/parse-lacrossebible.py                 # report only
  python3 scripts/parse-lacrossebible.py --year 2016     # one season
  python3 scripts/parse-lacrossebible.py --json out.json # dump the parsed rows
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", ".cache", "lb")

NUM = re.compile(r"-?\d+(?:\.\d+)?")
HEADER_WORDS = ("GAMES", "GOALS", "ASSISTS", "POINTS", "PEN", "GP", "MIN", "GAA", "SV",
                "TOTALS", "SPARE", "GOALTEND", "REGULAR", "PLAYOFF", "NAME", "PLAYERS")


def row_name(line: str) -> tuple[str, list[str]] | None:
    """Split a table line into (name, numbers) — None when it is not a data row."""
    stripped = line.strip()
    if not stripped or len(stripped) < 6:
        return None
    nums = NUM.findall(stripped) + re.findall(r"\bxx\b|--", stripped, flags=re.I)
    if len(nums) < 2:
        return None
    # the name is everything before the numeric tail; the numeric tail must be
    # whitespace separated from it by at least two spaces
    m = re.match(r"^(.*?\S)\s{2,}((?:(?:-?\d+(?:\.\d+)?|\d+:\d{2}|\.\d+|xx|--)\s*)+)$",
                 stripped, flags=re.I)
    if not m:
        return None
    name = m.group(1).strip()
    if not name or name.upper().startswith(HEADER_WORDS):
        return None
    if not re.search(r"[A-Za-z]", name):
        return None
    if re.fullmatch(r"[\d\s.:\-]+", name):
        return None
    if re.match(r"(?i)^(totals?|bench|spare|team)\b", name):
        return None
    return name, re.findall(r"\d+:\d{2}|-?\d+(?:\.\d+)?|\.\d+|xx|--", m.group(2), flags=re.I)


def _next_nonblank(lines: list[str], i: int) -> str:
    for j in range(i + 1, min(i + 4, len(lines))):
        if lines[j].strip():
            return lines[j].strip().upper()
    return ""


def parse_file(path: str) -> dict:
    """One season file -> player rows, goalie rows and the clubs in it.

    Three states matter. Standings and "TOP TEN SCORERS" blocks print club names and
    leader rows that look exactly like player rows, so they are skipped until a club
    heading appears; the club heading itself is recognised by what follows it
    (`REGULAR SEASON` on the next non-blank line), because the shape changes between
    eras ("1968 BRAMALEA EXCELSIORS" vs a bare name). Older files print `xx` for an
    unknown games-played, which is why the cell regex accepts it.
    """
    year = os.path.basename(path).replace(".txt", "")
    rows, goalies, sections = [], [], []
    team = ""
    block = "regular"
    mode = "team"
    state = "skip"          # skip | team
    header: list[str] = []
    with open(path, errors="replace") as f:
        lines = f.read().split("\n")
    for i, raw in enumerate(lines):
        line = raw.rstrip()
        up = line.strip().upper()
        if not up:
            continue
        nxt = _next_nonblank(lines, i)
        if "REGULAR SEASON" in nxt and up == line.strip():
            team = re.sub(r"^\d{4}\s+", "", line.strip())
            mode, block, header, state = "team", "regular", [], "team"
            continue
        if "STANDINGS" in up or "TOP TEN" in up or "SCORERS" in up or "LEADERS" in up:
            state = "skip"
            sections.append("standings" if "STANDINGS" in up else "leaders")
            continue
        if up.startswith("ALL-STAR") or up.startswith("OFFICIAL ALL"):
            state, team = "skip", ""
            sections.append("allstar")
            continue
        if up.startswith("GOALTEND"):
            mode, header = "goalie", []
            continue
        if re.search(r"\bPLAYOFFS?\b", up) and len(up) < 40 and up == line.strip():
            block, header = "playoff", []
            continue
        if "GOALS" in up and ("ASSIST" in up or "POINT" in up):
            header = re.findall(r"[A-Z][A-Z.%]+", up)
            mode = "team"
            continue
        if up.startswith("GP") and "GAA" in up:
            header = re.findall(r"[A-Z][A-Z.%]+", up)
            mode = "goalie"
            continue
        parsed = row_name(line)
        if not parsed:
            continue
        name, nums = parsed
        if state != "team":
            continue
        club = team
        if not club and " - " in name:
            name, club = (x.strip() for x in name.rsplit(" - ", 1))
        if name.isupper() and len(nums) >= 6:
            continue                      # a standings row: club in caps, GF/GA/points
        if mode == "goalie" or (len(nums) == 7 and "GOALS" not in header):
            if len(nums) < 5:
                continue
            goalies.append({"year": year, "team": club, "section": block, "name": name,
                            "cells": nums, "header": header})
        else:
            if len(nums) < 3:
                continue
            rows.append({"year": year, "team": club, "section": block, "name": name,
                         "cells": nums, "header": header})
    return {"year": year, "players": rows, "goalies": goalies,
            "sections": sections, "teams": sorted({r["team"] for r in rows if r["team"]})}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year")
    ap.add_argument("--json")
    args = ap.parse_args()
    files = sorted(f for f in os.listdir(CACHE) if f.endswith(".txt"))
    if args.year:
        files = [f for f in files if f.startswith(args.year)]
    out = []
    by_decade = Counter()
    names = Counter()
    for fn in files:
        parsed = parse_file(os.path.join(CACHE, fn))
        out.append(parsed)
        print(f"  {parsed['year']}  {len(parsed['players']):>5} skater rows  "
              f"{len(parsed['goalies']):>4} goalie rows  {len(parsed['teams']):>3} clubs")
        by_decade[parsed["year"][:3] + "0s"] += len(parsed["players"])
        for r in parsed["players"]:
            names[r["name"].lower()] += 1
    print(f"\n{sum(len(p['players']) for p in out)} skater rows, "
          f"{sum(len(p['goalies']) for p in out)} goalie rows, "
          f"{len({n for n in names})} distinct names")
    print("by decade:", dict(sorted(by_decade.items())))
    if args.json:
        with open(args.json, "w") as f:
            json.dump(out, f, indent=0)
        print("wrote", args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
