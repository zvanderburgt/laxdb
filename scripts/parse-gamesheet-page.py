#!/usr/bin/env python3
"""Read handedness out of a saved GameSheet page.

The GameSheet player page renders `shotHand` server-side, inside the Next.js flight
payload — a field the public `/api/players/standings/<season>` endpoint does not return.
The page itself sits behind Cloudflare Turnstile, which never clears in headless Chromium,
so a page saved from a normal browser is the only route to the value.

What one page contains depends on the route: a saved **team** page carries the whole roster
(23 riders for Elora Hawks), while a saved **player** page carries only that player — the
object is still there, so both are read here, and the byte counts decide which we got.

  python3 scripts/parse-gamesheet-page.py ~/Downloads/*.html            # report
  python3 scripts/parse-gamesheet-page.py ~/Downloads/*.html --apply    # write hand into data.json

Field order inside the flight payload differs per route (`id` comes before `firstName` on a
player page, after it on a roster row), so this matches on `shotHand` and reads the fields
out of a window around it instead of assuming an order.
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

SHOT = re.compile(r'"shotHand":"(left|right|both|switch)"', re.I)
# a roster page lists every club player but carries no shotHand at all (OJBLL is configured
# without it, OJLL with it), so those objects are still worth reading for bios
FIRST = re.compile(r'"firstName":"([^"]{1,40})"')
FIELD = {
    "first": re.compile(r'"firstName":"([^"]{1,40})"'),
    "last": re.compile(r'"lastName":"([^"]{1,40})"'),
    "gsId": re.compile(r'"id":(\d{5,9})'),
    "dob": re.compile(r'"birthdate":"(\d{4}-\d{2}-\d{2})"'),
    "height": re.compile(r'"height":"(\d)\'(\d{1,2})"'),
    "weight": re.compile(r'"weight":"(\d{2,3})"'),
    "hometown": re.compile(r'"hometown":"([^"]{2,40})"'),
    "team": re.compile(r'"team":\{"id":(\d{4,7}),"title":"([^"]{3,60})"'),
    "jersey": re.compile(r'"jersey":"(\d{1,2})"'),
}


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("'", "").replace("-", " ")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def name_key(text: str) -> str:
    # "DERRICK (DJ) CROUGH(AP)" -> "derrick crough": parentheticals are nicknames and
    # affiliate markers, never part of the name we hold
    key = re.sub(r"\([^)]*\)", " ", re.sub(r"★|☆", " ", norm(text)))
    key = re.sub(r"\b(jr|sr|ii|iii|iv)\b", " ", key)
    return re.sub(r"\s+", " ", key).strip()


def merge_rows(rows: list[dict]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for row in rows:
        prev = out.get(row["gsId"])
        if prev is None:
            out[row["gsId"]] = row
        else:
            # a player can appear on both his player page and a roster page; keep every fact
            for k, v in row.items():
                if v and not prev.get(k):
                    prev[k] = v
    return out


def row_at(flat: str, pos: int, hand: str) -> dict | None:
    window = flat[max(0, pos - 700): pos + 700]
    found = {k: (v.search(window).group(1) if v.search(window) else "") for k, v in FIELD.items()}
    team = FIELD["team"].search(window)
    if not found["first"] or not found["last"] or not found["gsId"]:
        return None
    if "$undefined" in (found["first"], found["last"]):
        return None
    row = {
        "first": found["first"].strip(),
        "last": found["last"].strip(),
        "gsId": int(found["gsId"]),
        "hand": hand,
        "club": team.group(2) if team else "",
        "teamId": int(team.group(1)) if team else 0,
    }
    if found["dob"]:
        row["dob"] = found["dob"]
    h = FIELD["height"].search(window)
    if h:
        row["heightIn"] = int(h.group(1)) * 12 + int(h.group(2))
    if found["weight"]:
        row["weightLb"] = int(found["weight"])
    if found["hometown"]:
        row["hometown"] = found["hometown"].strip()
    jersey = FIELD["jersey"].search(window)
    if jersey:
        row["jersey"] = int(jersey.group(1))
    return row


def read_page(path: str) -> list[dict]:
    raw = open(path, encoding="utf-8", errors="ignore").read()
    # the payload is JSON-escaped twice inside self.__next_f.push([1,"…"])
    flat = raw.replace('\\"', '"')
    players = [r for r in (row_at(flat, m.start(), m.group(1)[:1].upper())
                           for m in SHOT.finditer(flat)) if r]
    if players:
        return players
    # a roster page: every club player, bios only
    return [r for r in (row_at(flat, m.start(), "") for m in FIRST.finditer(flat)) if r]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", nargs="+", help="saved GameSheet HTML files (globs ok)")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    paths: list[str] = []
    for pattern in args.pages:
        paths.extend(sorted(glob.glob(pattern)) or [pattern])
    # macOS metadata sidecars are named "._foo.html" and carry no payload
    paths = [p for p in paths if not os.path.basename(p).startswith("._")]

    with open(DATA) as f:
        data = json.load(f)
    teams = {t["id"]: t for t in data["teams"]}
    by_name: dict[str, list[dict]] = {}
    for p in data["players"]:
        by_name.setdefault(name_key(p["name"]), []).append(p)

    seen: dict[int, dict] = {}
    for path in paths:
        if not os.path.exists(path):
            print(f"  ! missing {path}")
            continue
        players = read_page(path)
        clubs = {p["club"] for p in players if p["club"]}
        print(f"  {os.path.basename(path)[:50]:<52} {len(players):>3} riders  "
              f"club={', '.join(sorted(clubs))[:34] or '?'}")
        for row in players:
            prev = seen.get(row["gsId"])
            # keep the copy that carries a club name — a player page's own team block is
            # more reliable than the majority title on a roster page
            if prev is None or (not prev["club"] and row["club"]):
                seen[row["gsId"]] = row

    filled = skipped = bios = 0
    for row in seen.values():
        full = f"{row['first']} {row['last']}"
        club = norm(row["club"])
        for p in by_name.get(name_key(full), []):
            clubs = {norm(teams.get(s["teamId"], {}).get("name", "")) for s in p["seasons"]} | {
                norm(teams.get(s["teamId"], {}).get("shortName", "")) for s in p["seasons"]
            }
            # a shared name is not identity: the club must appear in his career
            if club and club not in clubs and not any(c and (c in club or club in c) for c in clubs):
                continue
            touched = False
            for field in ("dob", "heightIn", "weightLb", "jersey"):
                if row.get(field) and not p.get(field):
                    if args.apply:
                        p[field] = row[field]
                    bios += 1
                    touched = True
            if row.get("hand") and not p.get("hand"):
                if args.apply:
                    p["hand"] = row["hand"]
                filled += 1
                touched = True
            elif p.get("hand"):
                skipped += 1
            if touched:
                break

    print(f"\n{len(seen)} players in {len(paths)} page(s) · {filled} handedness written"
          f"{f' · {skipped} already had a hand' if skipped else ''}"
          f"{f' · {bios} bio fields filled' if bios else ''}")
    if not args.apply:
        print("dry run — pass --apply to write")
        return 0
    with open(DATA, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"wrote {DATA} — {sum(1 for p in data['players'] if p.get('hand'))} players with a hand")
    return 0


if __name__ == "__main__":
    sys.exit(main())
