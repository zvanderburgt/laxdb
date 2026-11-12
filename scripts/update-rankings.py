#!/usr/bin/env python3
"""
Refresh only the D1 polls inside public/data.json.

A full import refetches every school, roster and box score; the polls change on their own
schedule, so this merges just `rankings.json` (plus movement from `rankings-history.json`)
into the existing dataset in a couple of seconds.

Usage:
  python3 scripts/fetch-rankings.py     # browser fetch -> public/rankings.json
  python3 scripts/update-rankings.py    # merge into public/data.json
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
POLLS = os.path.join(ROOT, "public", "rankings.json")
HISTORY = os.path.join(ROOT, "public", "rankings-history.json")


def norm_team(raw):
    s = re.sub(r"[^a-z0-9]+", "", (raw or "").lower())
    for suffix in ("university", "college", "mens", "womens", "lacrosse"):
        s = s.replace(suffix, "")
    return s


def main():
    if not os.path.exists(POLLS):
        sys.exit("no public/rankings.json — run scripts/fetch-rankings.py first")
    payload = json.load(open(POLLS))
    polls = payload.get("polls") or []
    if not polls:
        sys.exit("rankings.json has no polls")

    data = json.load(open(DATA))
    teams = [t for t in data["teams"] if t["leagueId"] == "ncaa-d1"]
    by_key = {norm_team(t["name"]): t for t in teams}

    history = json.load(open(HISTORY)) if os.path.exists(HISTORY) else []
    previous = {}
    for poll in polls:
        earlier = [h for h in history if h.get("key") == poll["key"]
                   and h.get("fetched", "") < poll.get("fetched", "")]
        if earlier:
            latest = max(earlier, key=lambda h: h.get("fetched", ""))
            previous[poll["key"]] = {
                norm_team(r.get("team", "")): r.get("rank") for r in latest.get("rows", [])
            }

    out = []
    for poll in polls:
        rows = []
        for r in poll.get("rows", []):
            key = norm_team(r.get("team", ""))
            team = by_key.get(key) or next((t for k, t in by_key.items() if k.startswith(key)), None)
            rows.append({
                "rank": r["rank"],
                "name": r.get("team", ""),
                "record": r.get("record", ""),
                "extra": r.get("extra", ""),
                "teamId": team["id"] if team else None,
                "prev": previous.get(poll["key"], {}).get(key),
            })
        out.append({
            "key": poll["key"],
            "source": poll.get("source", poll["key"]),
            "fetched": poll.get("fetched", ""),
            "rows": rows,
        })
        moves = sum(1 for r in rows if r.get("prev") not in (None, r["rank"]))
        print(f"  {poll['key']}: {len(rows)} rows, {moves} moved")

    league = next((l for l in data["leagues"] if l["id"] == "ncaa-d1"), None)
    if not league:
        sys.exit("no ncaa-d1 league in data.json")
    league["polls"] = out

    # team pages read pollRanks
    for t in teams:
        t.pop("pollRanks", None)
    for poll in out:
        for row in poll["rows"]:
            if row["teamId"]:
                team = next((t for t in teams if t["id"] == row["teamId"]), None)
                if team:
                    team.setdefault("pollRanks", {})[poll["key"]] = row["rank"]

    with open(DATA, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"updated {DATA} with {len(out)} polls")


if __name__ == "__main__":
    main()
