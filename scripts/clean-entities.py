"""Decode HTML entities that upstream feeds left in names.

Feeds (PLL, MCLA, several school sites) hand back names like "Brennan O&#039;Neill"
or "Texas A&amp;M Aggies". React renders those literally, so the site showed
"Brennan O&#039;Neill" on the homepage card. The importer now unescapes on write;
this script repairs the JSON already on disk so we don't need a full re-import.

Run: python3 scripts/clean-entities.py
"""
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
ENTITY = re.compile(r"&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);")

FILES = [
    "data.json",
    "games.json",
    "scores.json",
    "rankings.json",
    "rankings-history.json",
    "history-results.json",
]


def walk(o):
    """Return (cleaned, changed) — only allocate a new string when it differs."""
    if isinstance(o, str):
        if ENTITY.search(o):
            return html.unescape(o), True
        return o, False
    if isinstance(o, list):
        changed = False
        out = []
        for v in o:
            nv, c = walk(v)
            changed = changed or c
            out.append(nv)
        return (out, True) if changed else (o, False)
    if isinstance(o, dict):
        changed = False
        out = {}
        for k, v in o.items():
            nv, c = walk(v)
            changed = changed or c
            out[k] = nv
        return (out, True) if changed else (o, False)
    return o, False


def main():
    total = 0
    for name in FILES:
        path = os.path.join(PUBLIC, name)
        if not os.path.exists(path):
            continue
        with open(path) as f:
            orig = f.read()
        data = json.loads(orig)
        cleaned, changed = walk(data)
        if not changed:
            print(f"  {name}: clean")
            continue
        hits = len(ENTITY.findall(orig))
        with open(path, "w") as f:
            json.dump(cleaned, f, separators=(",", ":"))
        print(f"  {name}: {hits} entity occurrences decoded")
        total += hits
    print(f"{total} decoded")


if __name__ == "__main__":
    sys.exit(main())
