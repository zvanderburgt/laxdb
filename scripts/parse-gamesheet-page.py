#!/usr/bin/env python3
"""Read handedness out of a saved GameSheet page.

The GameSheet player page renders `shotHand` server-side, inside the Next.js flight
payload — a field the public `/api/players/standings/<season>` endpoint does not return.
The page itself sits behind Cloudflare Turnstile, which never clears in headless Chromium,
so a page saved from a normal browser is the only route to the value.

One saved player page carries that player's **whole club roster** (23 players for Elora
Hawks), so a page per club covers a club, and a saved league players list covers a league.

  python3 scripts/parse-gamesheet-page.py ~/Downloads/*.html            # report
  python3 scripts/parse-gamesheet-page.py ~/Downloads/*.html --apply    # write hand into data.json
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")

# fields arrive in a fixed order inside each player object of the flight payload
PLAYER = re.compile(
    r'"firstName":"([^"]*)".*?"id":(\d{5,9}).*?"lastName":"([^"]*)".*?'
    r'"shotHand":"([a-zA-Z]*)"'
)


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("'", "").replace("-", " ")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def name_key(text: str) -> str:
    # "DERRICK (DJ) CROUGH(AP)" -> "derrick crough": parentheticals are nicknames and
    # affiliate markers, never part of the name we hold
    key = re.sub(r"\([^)]*\)", " ", norm(text))
    key = re.sub(r"\b(jr|sr|ii|iii|iv)\b", " ", key)
    return re.sub(r"\s+", " ", key).strip()


def read_page(path: str) -> tuple[list[dict], str]:
    raw = open(path, encoding="utf-8", errors="ignore").read()
    # the payload is JSON-escaped twice inside self.__next_f.push([1,"…"])
    flat = raw.replace('\\"', '"')
    players = [
        {"first": f, "gsId": int(i), "last": l, "hand": h[:1].upper()}
        for f, i, l, h in PLAYER.findall(flat)
        if h
    ]
    clubs = re.findall(r'"title":"([^"]{3,60})"', flat)
    club = max(set(clubs), key=clubs.count) if clubs else ""
    # the club title repeats once per roster player; anything else is chrome
    return players, club


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", nargs="+", help="saved GameSheet HTML files (globs ok)")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    paths: list[str] = []
    for pattern in args.pages:
        paths.extend(sorted(glob.glob(pattern)) or [pattern])

    with open(DATA) as f:
        data = json.load(f)
    teams = {t["id"]: t for t in data["teams"]}
    by_name: dict[str, list[dict]] = {}
    for p in data["players"]:
        by_name.setdefault(name_key(p["name"]), []).append(p)

    seen: dict[int, dict] = {}
    filled = skipped = 0
    for path in paths:
        if not os.path.exists(path):
            print(f"  ! missing {path}")
            continue
        players, club = read_page(path)
        print(f"  {os.path.basename(path)[:56]:<58} {len(players):>3} riders  club={club or '?'}")
        for row in players:
            seen[row["gsId"]] = {**row, "club": club}

    for row in seen.values():
        full = f"{row['first']} {row['last']}"
        club = norm(row["club"])
        for p in by_name.get(name_key(full), []):
            clubs = {
                norm(teams.get(s["teamId"], {}).get("name", ""))
                for s in p["seasons"]
            } | {
                norm(teams.get(s["teamId"], {}).get("shortName", ""))
                for s in p["seasons"]
            }
            if club and club not in clubs and not any(c and c in club for c in clubs):
                continue
            if p.get("hand"):
                skipped += 1
                break
            if args.apply:
                p["hand"] = row["hand"]
            filled += 1
            break

    print(f"\n{len(seen)} players in {len(paths)} page(s) · {filled} matched"
          f"{f' · {skipped} already had a hand' if skipped else ''}")
    if not args.apply:
        print("dry run — pass --apply to write")
        return 0
    with open(DATA, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"wrote {DATA}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
