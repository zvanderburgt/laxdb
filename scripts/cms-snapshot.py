#!/usr/bin/env python3
"""
Snapshot the published override document into public/overrides.json.

The site reads overrides from the function, and falls back to this file when the function cannot be
reached. So the snapshot is a copy of what visitors already get — taken from the live API, not from
any local state — and a failed fetch leaves the previous snapshot in place rather than deleting
editorial work.

Usage:
  python3 scripts/cms-snapshot.py                    # from the live site
  python3 scripts/cms-snapshot.py --url http://localhost:8787
  python3 scripts/cms-snapshot.py --check            # exit 1 if the snapshot is stale
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "overrides.json")
DEFAULT_URL = "https://laxdb.netlify.app"


def arg(flag, fallback):
    if flag in sys.argv:
        return sys.argv[sys.argv.index(flag) + 1].rstrip("/")
    return fallback


base = arg("--url", DEFAULT_URL)
url = f"{base}/api/overrides"
print(f"fetching {url}")

try:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "laxdb-cms-snapshot"}), timeout=30) as r:
        doc = json.loads(r.read())
except Exception as e:
    previous = ""
    if os.path.exists(OUT):
        previous = json.load(open(OUT)).get("version", "?")
    if "--check" in sys.argv:
        sys.exit(f"! snapshot check failed: {e}")
    print(f"! could not reach the API ({e}); keeping the existing snapshot (version {previous or 'none'})")
    sys.exit(0)

entities = doc.get("entities") or {}
fields = sum(len(e.get("fields") or {}) for e in entities.values())
body = {"version": doc.get("version", 0), "generated": doc.get("generated", ""), "entities": entities}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(body, f, separators=(",", ":"), sort_keys=True)
print(f"wrote public/overrides.json — version {body['version']}, {fields} field(s) in {len(entities)} entity(ies), {os.path.getsize(OUT)/1024:.1f} KB")
