#!/usr/bin/env python3
"""Re-run the duplicate merge on the shipped dataset, without a re-import.

Merging normally happens inside `fetch-real-data.py`, but the evidence improves
after the fact: GameSheet fills in dates of birth, and `fetch-franchises.py` learns
which club names are the same club. Re-importing to pick that up would reset every
logo and headshot, so this applies the *same* rules to `public/data.json` in place.

  python3 scripts/merge-now.py            # merge and report
  python3 scripts/merge-now.py --dry-run  # report only
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
IMPORTER = os.path.join(ROOT, "scripts", "fetch-real-data.py")


def load_importer():
    spec = importlib.util.spec_from_file_location("laxdb_importer", IMPORTER)
    module = importlib.util.module_from_spec(spec)
    sys.argv = [IMPORTER]          # keep --refresh / --no-photos flags out of scope
    spec.loader.exec_module(module)
    return module


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    importer = load_importer()
    with open(DATA) as f:
        data = json.load(f)

    before = len(data["players"])
    merged = importer.merge_players(data["players"], data["teams"])
    data["players"] = merged

    # Re-assign slugs exactly like the importer: most substantial profile first, so a
    # merge frees the plain slug for the person it kept instead of stranding "-2".
    data["players"].sort(
        key=lambda p: (bool(p.get("photo")), len(p.get("seasons") or [])), reverse=True
    )
    seen: dict[str, int] = {}
    for player in data["players"]:
        base = player.get("slug") or importer.slugify(player["name"])
        base = base.removesuffix("-2") if base.endswith("-2") and base[:-2] not in seen else base
        slug, n = base, 1
        while slug in seen:
            n += 1
            slug = f"{base}-{n}"
        seen[slug] = 1
        player["slug"] = slug

    print(f"players {before} -> {len(data['players'])} ({before - len(data['players'])} folded)")
    if args.dry_run:
        return 0

    with open(DATA, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
