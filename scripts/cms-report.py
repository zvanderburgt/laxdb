#!/usr/bin/env python3
"""
Health report for the editorial override layer and the assets it points at.

Three things go wrong quietly in this repo:

  1. an override whose entity no longer exists — a player merged into another record, a club
     renamed out of the dataset — so the correction is invisible and unreachable in the editor;
  2. a photo or logo path that the dataset references but the deploy does not carry (a re-import
     that reset `photo`, or a media upload that was never copied);
  3. an override that changes nothing, which hides a stale correction from the review sheet.

Reads the published document from the deploy (`--base`) or from `public/overrides.json`, and the
entities from `public/data.json`.

Usage:
  python3 scripts/cms-report.py
  python3 scripts/cms-report.py --base https://laxdb.netlify.app
"""
import argparse
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")


def load_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def fetch(url):
    req = urllib.request.Request(url, headers={"accept": "application/json", "cache-control": "no-cache"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", help="site to read the published document from (default: public/overrides.json)")
    args = ap.parse_args()

    data = load_json(os.path.join(PUBLIC, "data.json"))
    if args.base:
        doc = fetch(args.base.rstrip("/") + "/overrides.json")
        source = f"{args.base}/overrides.json"
    else:
        path = os.path.join(PUBLIC, "overrides.json")
        doc = load_json(path) if os.path.exists(path) else {"version": 0, "entities": {}}
        source = "public/overrides.json"

    ids = {
        "player": {p["id"] for p in data["players"]},
        "team": {t["id"] for t in data["teams"]},
        "league": {l["id"] for l in data["leagues"]},
        "site": {"site"},
    }

    print(f"dataset {len(data['players']):,} players · {len(data['teams'])} teams · built {data['meta'].get('generated', '?')}")
    print(f"overrides from {source} · version {doc.get('version', 0)}")

    entities = doc.get("entities") or {}
    orphans, empties = [], []
    for key, row in entities.items():
        kind, _, ident = key.partition(":")
        fields = row.get("fields") or {}
        if not fields:
            empties.append(key)
            continue
        if kind not in ids or ident not in ids[kind]:
            orphans.append((key, sorted(fields)))

    # assets the dataset points at that the deploy does not carry
    missing = []
    for p in data["players"]:
        rel = p.get("photo") or ""
        if rel and not os.path.exists(os.path.join(PUBLIC, rel)):
            missing.append(("player", p["slug"], rel))
    for t in data["teams"]:
        rel = (t.get("logo") or "").replace("/logos/", "logos/")
        if rel and not os.path.exists(os.path.join(PUBLIC, rel)):
            missing.append(("team", t["slug"], rel))

    print(f"\noverrides: {len(entities)} entities, {sum(len((r.get('fields') or {})) for r in entities.values())} fields")

    if orphans:
        print(f"\nORPHANED overrides ({len(orphans)}) — the entity is gone, so the correction cannot render:")
        for key, fields in orphans[:20]:
            print(f"  {key}: {', '.join(fields)}")
        if len(orphans) > 20:
            print(f"  … and {len(orphans) - 20} more")
    else:
        print("\norphaned overrides: none")

    if empties:
        print(f"\nEMPTY overrides ({len(empties)}) — no fields, safe to drop:")
        for key in empties[:10]:
            print(f"  {key}")

    if missing:
        print(f"\nMISSING assets ({len(missing)}) — referenced by the dataset, not on disk:")
        for kind, slug, rel in missing[:20]:
            print(f"  {kind} {slug}: {rel}")
        if len(missing) > 20:
            print(f"  … and {len(missing) - 20} more")
    else:
        print("\nmissing assets: none")

    return 1 if orphans else 0


if __name__ == "__main__":
    sys.exit(main())
