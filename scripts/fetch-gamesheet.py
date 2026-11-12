#!/usr/bin/env python3
"""Fill the gaps in our dataset from GameSheet Stats.

GameSheet carries what the box feeds we scrape do not: date of birth, hometown,
height, weight, jersey, player photos and team logos — for the same leagues.

Discovery: a season id resolves to its league, and the league lists every season,
so a handful of seed seasons covers a whole competition. Seeds come from the
league sites and search; ids are not guessable (they are not sequential per league).

  python3 scripts/fetch-gamesheet.py --discover        # resolve seeds -> leagues
  python3 scripts/fetch-gamesheet.py --apply           # enrich data.json + assets
  python3 scripts/fetch-gamesheet.py --apply --only nf-ojbll

Matching is conservative: a printed name *and* a club that appears on the
GameSheet row. Where the two feeds name the same club differently ("Elora Hawks"
vs "Elora Mohawks") the home town is accepted, but only when the name is unique.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

from gamesheet import GameSheet, full_name, norm, parse_height, parse_weight

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
PHOTOS = os.path.join(ROOT, "public", "players", "gs")
LOGOS = os.path.join(ROOT, "public", "logos")
LEAGUE_MAP = os.path.join(ROOT, "scripts", ".cache", "gs", "league-map.json")

# Any season id from a league is enough seed: the API resolves league + siblings.
# Collected from the leagues' own sites and site:gamesheetstats.com searches.
SEED_SEASONS = [
    5220,    # OJBLL 2024
    9115,    # OJBLL 2025
    14861,   # OJLL 2026
    710, 1718, 2962, 9708,  # OJLL earlier seasons
    6010, 9898, 14917,      # OJCL
    14397,                  # MSL
    6002, 9769, 14413,      # OSL
    9957, 14902, 14925,     # WCSLA / senior series
    3325,                   # PNWJLL
    9949, 15013, 15133,     # RMLL
    14049,                  # BCJALL area
    # resolved from site:gamesheetstats.com searches per league
    801, 1974, 3959, 6685, 6790, 9147,          # BC Junior A
    3957, 6917, 6919, 10358,                    # Pacific Northwest Junior
    6719, 7602, 8088, 11981, 12069,             # West Coast Junior
    8328, 13743,                                # RMLL
    5997, 6679, 10710, 14874,                   # Western Lacrosse Association
    1152, 4352, 6765, 10239, 10798, 13750, 15347,  # Tier II Ontario
    10221, 15822, 6614,          # BC Junior A (Coquitlam, Port Coquitlam)
    6144,                        # Akwesasne
]

# our league id -> substrings that identify it in a GameSheet league title
LEAGUE_HINTS = {
    "nf-ojll": ["ontario junior lacrosse league", "ontario junior a"],
    "nf-ojbll": ["ontario junior b"],
    "nf-ojcll": ["ontario junior c"],
    "nf-bcjall": ["bc junior a", "british columbia junior a"],
    "nf-rmll-junior-a": ["rmll junior a", "rmll - junior a"],
    "nf-rmll-junior-b-tier-1": ["rmll junior b tier 1", "rmll junior b tier i"],
    "nf-rmll-junior-b-tier-2": ["rmll junior b tier 2", "rmll junior b tier ii"],
    "nf-rmll-senior-b": ["rmll senior b"],
    "nf-msl": ["major series lacrosse"],
    "nf-osl": ["ontario series lacrosse"],
    "nf-wla": ["western lacrosse association"],
    "nf-wcsla": ["west coast senior", "senior series lacrosse"],
    "nf-tojll": ["tier ii ontario", "tier 2 ontario"],
    "nf-wcjll": ["west coast junior lacrosse"],
    "nf-pnwjll": ["pacific northwest junior"],
    "nf-nll": ["national lacrosse league"],
}


def load():
    with open(DATA) as f:
        return json.load(f)


def discover(gs: GameSheet) -> dict:
    """seed season -> league -> every season of that league."""
    leagues: dict[str, dict] = {}
    for seed in SEED_SEASONS:
        info = gs.season_info(seed)
        if not info:
            continue
        league = info.get("league") or {}
        lid = str(league.get("id") or info.get("leagueId") or "")
        if not lid:
            continue
        entry = leagues.setdefault(lid, {"id": lid, "title": league.get("title") or info.get("title", ""), "seasons": {}})
        entry["seasons"][str(info["id"])] = {
            "id": info["id"],
            "title": info.get("title", ""),
            "sport": info.get("sport"),
            "year": info.get("stats_year"),
            "start": info.get("start"),
        }
    for lid, entry in leagues.items():
        for season in gs.seasons(int(lid)):
            entry["seasons"][str(season["id"])] = {
                "id": season["id"],
                "title": season.get("title", ""),
                "sport": season.get("sport"),
                "year": season.get("stats_year"),
                "start": season.get("start"),
            }
    os.makedirs(os.path.dirname(LEAGUE_MAP), exist_ok=True)
    with open(LEAGUE_MAP, "w") as f:
        json.dump(leagues, f, indent=1)
    return leagues


def load_map(gs: GameSheet) -> dict:
    if os.path.exists(LEAGUE_MAP):
        with open(LEAGUE_MAP) as f:
            return json.load(f)
    return discover(gs)


def match_leagues(leagues: dict, data: dict) -> dict[str, list[dict]]:
    """our league id -> GameSheet league entries whose title matches a hint."""
    out: dict[str, list[dict]] = {}
    for our in (l["id"] for l in data["leagues"] if l["type"] == "box"):
        hints = LEAGUE_HINTS.get(our, [])
        if not hints:
            name = next((l["name"] for l in data["leagues"] if l["id"] == our), "")
            hints = [norm(name)]
        hits = [e for e in leagues.values() if any(norm(h) in norm(e.get("title", "")) for h in hints)]
        if hits:
            out[our] = hits
    return out


def enrich_rows(rows: list[dict], data: dict, stats: dict):
    """Match GameSheet rows to our players and return ({player_id: fields}, logos)."""
    by_name: dict[str, list[dict]] = {}
    team_by_id = {t["id"]: t for t in data["teams"]}
    for p in data["players"]:
        by_name.setdefault(norm(p["name"]), []).append(p)

    updates: dict[str, dict] = {}
    logos: dict[str, str] = {}
    for row in rows:
        candidates = by_name.get(norm(full_name(row))) or []
        if not candidates:
            stats["name_miss"] += 1
            continue

        # squash spaces as well as punctuation: our feed says "JRA Raiders", GameSheet
        # says "Jr. A Raiders", and neither contains the other verbatim
        club_keys = {norm(t.get("title", "")) for t in (row.get("teams") or []) if t.get("title")}
        club_squash = {k.replace(" ", "") for k in club_keys}
        picked = None
        for cand in candidates:
            team = team_by_id.get(cand["teamId"])
            if not team:
                continue
            names = {norm(team.get("shortName", "")), norm(team.get("name", ""))}
            if names & club_keys or {n.replace(" ", "") for n in names} & club_squash:
                picked = cand
                stats["club_exact"] += 1
                break
        if picked is None:
            towns = {k.split(" ")[0] for k in club_keys if k}
            near = [
                cand
                for cand in candidates
                if (team := team_by_id.get(cand["teamId"]))
                and norm(team.get("name", "")).split(" ")[0] in towns
            ]
            if len(near) == 1:
                picked = near[0]
                stats["club_town"] += 1
        if picked is None:
            stats["club_miss"] += 1
            continue

        fields: dict[str, object] = {}
        if (row.get("birthdate") or "") and not picked.get("dob"):
            fields["dob"] = row["birthdate"]
        hometown = (row.get("hometown") or "").strip()
        if hometown and not (picked.get("birthplace") or {}).get("city"):
            bp = dict(picked.get("birthplace") or {"city": "", "state": "", "country": ""})
            bp["city"] = hometown
            bp["country"] = bp.get("country") or "CAN"
            fields["birthplace"] = bp
        height = parse_height(row.get("height"))
        if height and not picked.get("heightIn"):
            fields["heightIn"] = height
        weight = parse_weight(row.get("weight"))
        if weight and not picked.get("weightLb"):
            fields["weightLb"] = weight
        jersey = parse_weight(row.get("jersey"))
        if jersey and not picked.get("jersey"):
            fields["jersey"] = jersey
        if row.get("photoUrl") and not picked.get("photo"):
            fields["photoUrl"] = row["photoUrl"]

        for t in row.get("teams") or []:
            if t.get("logo") and t.get("title"):
                logos.setdefault(norm(t["title"]), t["logo"])

        if fields:
            updates[picked["id"]] = fields
            stats["players"] += 1
            for key in fields:
                if key in stats["fields"]:
                    stats["fields"][key] += 1
            if "photoUrl" in fields:
                stats["photos"] += 1
    return updates, logos


def apply_updates(data: dict, updates: dict[str, dict], logos: dict[str, str], gs: GameSheet, stats: dict):
    from PIL import Image

    index = {p["id"]: p for p in data["players"]}
    for pid, fields in updates.items():
        player = index[pid]
        photo_url = fields.pop("photoUrl", None)
        for key, value in fields.items():
            player[key] = value
        if photo_url:
            tmp = os.path.join(PHOTOS, f"{player['slug']}.src")
            if gs.download(photo_url, tmp):
                try:
                    # same contract as every other headshot: square, 224px, webp
                    img = Image.open(tmp).convert("RGB")
                    side = min(img.size)
                    left = (img.width - side) // 2
                    top = int((img.height - side) * 0.3)
                    img.crop((left, top, left + side, top + side)).resize((224, 224), Image.LANCZOS).save(
                        os.path.join(PHOTOS, f"{player['slug']}.webp"), "WEBP", quality=84
                    )
                    os.remove(tmp)
                    player["photo"] = f"players/gs/{player['slug']}.webp"
                    stats["photos_saved"] += 1
                except Exception:  # noqa: BLE001
                    pass

    def find_logo(team: dict) -> str | None:
        """Exact name, else a unique club that shares the town ("Elora" -> "Elora Hawks")."""
        for key in (norm(team.get("name", "")), norm(team.get("shortName", ""))):
            if key and key in logos:
                return logos[key]
        town = norm(team.get("name", "")).split(" ")[0]
        if not town:
            return None
        near = [url for key, url in logos.items() if key.split(" ")[0] == town]
        return near[0] if len(near) == 1 else None

    for team in data["teams"]:
        if team.get("logo"):
            continue
        url = find_logo(team)
        if not url:
            continue
        dest = os.path.join(LOGOS, f"{team['slug']}.src")
        if not gs.download(url, dest):
            continue
        try:
            img = Image.open(dest).convert("RGBA")
            side = max(img.size)
            canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
            canvas.resize((120, 120), Image.LANCZOS).save(os.path.join(LOGOS, f"{team['slug']}.webp"), "WEBP", quality=86)
            os.remove(dest)
            team["logo"] = f"logos/{team['slug']}.webp"
            stats["logos_saved"] += 1
        except Exception:  # noqa: BLE001
            continue


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--discover", action="store_true", help="resolve seed seasons into leagues and seasons")
    ap.add_argument("--apply", action="store_true", help="write data.json and assets")
    ap.add_argument("--only", help="limit to one of our league ids")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    gs = GameSheet(refresh=args.refresh)
    data = load()
    leagues = discover(gs) if args.discover else load_map(gs)
    mapping = match_leagues(leagues, data)

    print(f"{len(leagues)} GameSheet leagues, {len(mapping)} of ours matched")
    for our_id, entries in sorted(mapping.items()):
        seasons = sum(len(e["seasons"]) for e in entries)
        names = ", ".join(e["title"][:44] for e in entries)
        print(f"  {our_id:<24} {seasons:>3} seasons  {names}")

    if not args.apply:
        return 0

    stats = {
        "players": 0, "photos": 0, "photos_saved": 0, "logos_saved": 0,
        "name_miss": 0, "club_exact": 0, "club_town": 0, "club_miss": 0,
        "fields": {"dob": 0, "birthplace": 0, "heightIn": 0, "weightLb": 0, "jersey": 0},
    }
    # every box-lacrosse league we discovered — a league whose clubs we don't hold
    # simply produces no club matches, so there is no need to map them by name
    for lid, entry in sorted(leagues.items(), key=lambda kv: kv[1]["title"]):
        if args.only and lid not in {str(e["id"]) for e in mapping.get(args.only, [])}:
            continue
        before = stats["players"]
        for season in entry["seasons"].values():
            if season.get("sport") not in (None, "boxla"):
                continue
            rows = gs.players(season["id"])
            if not rows:
                continue
            updates, logos = enrich_rows(rows, data, stats)
            apply_updates(data, updates, logos, gs, stats)
        if stats["players"] > before:
            print(f"  {entry['title'][:48]:<48} +{stats['players'] - before} players")

    with open(DATA, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(
        f"\nmatched {stats['players']} players · dob {stats['fields']['dob']} · hometown "
        f"{stats['fields']['birthplace']} · height {stats['fields']['heightIn']} · "
        f"weight {stats['fields']['weightLb']} · jersey {stats['fields']['jersey']} · "
        f"photos {stats['photos_saved']} · logos {stats['logos_saved']}\n"
        f"match quality: club exact {stats['club_exact']} / town {stats['club_town']} / "
        f"no club {stats['club_miss']} / name not held {stats['name_miss']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
