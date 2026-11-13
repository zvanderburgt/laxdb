#!/usr/bin/env python3
"""Fill player handedness from Wikipedia's lacrosse infobox.

{{Infobox lacrosse player}} carries `shoots = left|right`, which is the only open, scriptable
handedness source in lacrosse. Coverage is limited to notable players (the article set is
~500 pages), but it costs one batch fetch and it maps cleanly by name.

The page list comes from `list=embeddedin` on the infobox template plus the player categories,
so newly written articles are picked up on the next run without changing this script.

  python3 scripts/fetch-wikipedia-hands.py            # report only
  python3 scripts/fetch-wikipedia-hands.py --apply    # write data.json
  python3 scripts/fetch-wikipedia-hands.py --refresh  # ignore the wikitext cache
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

API = "https://en.wikipedia.org/w/api.php"
UA = {"User-Agent": "laxdb/1.0 (lacrosse database; batch metadata fetch)"}

CATEGORIES = [
    "Category:National Lacrosse League players",
    "Category:Canadian lacrosse players",
    "Category:American lacrosse players",
    "Category:Premier Lacrosse League players",
    "Category:Major League Lacrosse players",
    "Category:Western Lacrosse Association players",
]


def api(params: dict) -> dict:
    params = dict(params, format="json", formatversion="2")
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r)
        except Exception as exc:
            if attempt == 2:
                print(f"  ! api {exc}", file=sys.stderr)
                return {}
            time.sleep(1.5 * (attempt + 1))
    return {}


def titanic(pages: list[str]) -> list[str]:
    seen, out = set(), []
    for title in pages:
        if title not in seen:
            seen.add(title)
            out.append(title)
    return out


def list_infobox_pages() -> list[str]:
    titles, cont = [], {}
    while True:
        params = {
            "action": "query", "list": "embeddedin", "eititle": "Template:Infobox lacrosse player",
            "einamespace": "0", "eilimit": "500",
        }
        params.update(cont)
        d = api(params)
        titles += [x["title"] for x in d.get("query", {}).get("embeddedin", [])]
        if "continue" in d:
            cont = dict(d["continue"])
        else:
            break
    return titles


def expand_subcategories(cats: list[str]) -> list[str]:
    """Active pros sit in per-team categories (Category:Buffalo Bandits players), so pull one
    level of subcategories rather than relying on the parent category's direct members."""
    out = list(cats)
    for cat in cats:
        cont = {}
        while True:
            params = {"action": "query", "list": "categorymembers", "cmtitle": cat,
                      "cmtype": "subcat", "cmlimit": "500"}
            params.update(cont)
            d = api(params)
            out += [x["title"] for x in d.get("query", {}).get("categorymembers", [])]
            if "continue" in d:
                cont = dict(d["continue"])
            else:
                break
    return titanic(out)


def list_category_pages() -> list[str]:
    titles = []
    for cat in expand_subcategories(CATEGORIES):
        cont = {}
        while True:
            params = {
                "action": "query", "list": "categorymembers", "cmtitle": cat,
                "cmnamespace": "0", "cmlimit": "500",
            }
            params.update(cont)
            d = api(params)
            titles += [x["title"] for x in d.get("query", {}).get("categorymembers", [])]
            if "continue" in d:
                cont = dict(d["continue"])
            else:
                break
    return titles


def list_search_pages() -> list[str]:
    """The infobox is not used consistently, so also ask the search index for pages that
    mention a `shoots` value anywhere in their source."""
    titles = []
    for query in ('insource:"shoots =" lacrosse', 'insource:"shoots=" lacrosse',
                  '"shoots" lacrosse player left-handed right-handed infobox'):
        cont = {}
        while True:
            params = {"action": "query", "list": "search", "srsearch": query,
                      "srlimit": "500", "srnamespace": "0"}
            params.update(cont)
            d = api(params)
            titles += [x["title"] for x in d.get("query", {}).get("search", [])]
            if "continue" in d and len(titles) < 4000:
                cont = dict(d["continue"])
            else:
                break
    return titles


def fetch_wikitext(titles: list[str], refresh: bool) -> dict[str, str]:
    os.makedirs(CACHE, exist_ok=True)
    store_path = os.path.join(CACHE, "wikitext.json")
    store: dict[str, str] = {}
    if os.path.exists(store_path) and not refresh:
        with open(store_path) as f:
            store = json.load(f)
    todo = [t for t in titles if t not in store]
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        d = api({
            "action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
            "titles": "|".join(batch), "redirects": "1",
        })
        for page in d.get("query", {}).get("pages", []):
            rev = page.get("revisions")
            if not rev:
                continue
            store[page["title"]] = rev[0]["slots"]["main"]["content"]
        print(f"  fetched {min(i + 50, len(todo))}/{len(todo)}")
        if i + 50 < len(todo):
            time.sleep(0.8)
    with open(store_path, "w") as f:
        json.dump(store, f)
    return store


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]+", " ", text)).strip()


def name_key(text: str) -> str:
    # strip "(lacrosse)" style disambiguation from the raw title — norm() eats the brackets
    # before this could match, which left "Shawn Evans (lacrosse)" as "shawn evans lacrosse"
    key = norm(re.sub(r"\([^)]*\)", " ", text or ""))
    return re.sub(r"\s+", " ", re.sub(r"\b(jr|sr|ii|iii|iv)\b", " ", key)).strip()


SHOOTS = re.compile(r"\|\s*shoots\s*=\s*(left|right|both|either)", re.I)
DOB = re.compile(r"\|\s*birth_date\s*=\s*\{\{\s*birth date(?: and age)?\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})", re.I)


def parse(wikitext: str) -> dict:
    out = {}
    m = SHOOTS.search(wikitext)
    if m:
        value = m.group(1).lower()
        if value in ("left", "right"):
            out["hand"] = value[0].upper()
    m = DOB.search(wikitext)
    if m:
        out["dob"] = f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    titles = titanic(list_infobox_pages() + list_category_pages() + list_search_pages())
    print(f"wikipedia: {len(titles)} candidate player articles")
    store = fetch_wikitext(titles, args.refresh)

    facts: dict[str, dict] = {}
    for title, text in store.items():
        parsed = parse(text)
        if parsed:
            facts[name_key(title)] = dict(parsed, title=title)
    print(f"  {len(facts)} articles carry shoots/birth date · "
          f"{sum(1 for f in facts.values() if 'hand' in f)} carry handedness")

    with open(DATA) as f:
        data = json.load(f)
    by_name: dict[str, list[dict]] = {}
    for p in data["players"]:
        by_name.setdefault(name_key(p["name"]), []).append(p)

    filled = dob_filled = ambiguous = 0
    for key, fact in facts.items():
        candidates = by_name.get(key, [])
        if len(candidates) > 1:
            ambiguous += 1
            continue
        if not candidates:
            continue
        player = candidates[0]
        # a shared name is not identity: when both sides carry a birth date it must agree
        if fact.get("dob") and player.get("dob") and fact["dob"] != player["dob"]:
            ambiguous += 1
            continue
        changed = False
        if fact.get("hand") and not player.get("hand"):
            player["hand"] = fact["hand"]
            filled += 1
            changed = True
        if fact.get("dob") and not player.get("dob"):
            player["dob"] = fact["dob"]
            dob_filled += 1
            changed = True
        if changed and args.verbose:
            print(f"  {player['name']:<26} hand={player.get('hand','-')} via {fact['title']}")

    print(f"\nhandedness filled {filled} · birth dates filled {dob_filled} · "
          f"ambiguous names skipped {ambiguous}")
    with_hand = sum(1 for p in data["players"] if p.get("hand"))
    print(f"players with handedness: {with_hand} of {len(data['players'])}")
    if not args.apply:
        print("dry run — pass --apply to write")
        return 0
    with open(DATA, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"wrote {DATA}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
