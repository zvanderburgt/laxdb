#!/usr/bin/env python3
"""Add the 2026 box rosters from saved GameSheet league pages.

The GameSheet API only *enriches* players we already hold, so anyone whose first season is
2026 is invisible to it. A saved league page carries the rendered standings table for every
club in that league, which is enough to add those players and their season line.

Pages live in data/gs-pages/*.html (saved with Ctrl+S from the league "Player Stats" page).
The parsed rows are cached to data/gs-rosters-<year>.json so the pipeline does not need the
HTML again.

  python3 scripts/import-gs-pages.py             # report only
  python3 scripts/import-gs-pages.py --apply     # write data.json
  python3 scripts/import-gs-pages.py --reparse   # re-read the HTML, ignore the cache
"""
from __future__ import annotations

import argparse
import glob
import html as htmllib
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
PAGES = os.path.join(ROOT, "data", "gs-pages")

# page title fragment -> our league id
LEAGUES = {
    "Ontario Junior B": "nf-ojbll",
    "Ontario Junior C": "nf-ojcll",
    "Ontario Junior Lacrosse League": "nf-ojll",
    "Ontario Series Lacrosse": "nf-osl",
}

POSITIONS = {
    "F": ("F", "Forward"), "A": ("A", "Attack"), "D": ("D", "Defense"),
    "T": ("T", "Transition"), "M": ("M", "Midfield"), "G": ("G", "Goalie"),
    "LSM": ("LSM", "LSM"), "FO": ("FO", "Faceoff"), "R": ("R", "Runner"),
}

# page column -> season field
STATS = {
    "GP": "gp", "G": "g", "A": "a", "PTS": "pts", "PIM": "pen",
    "SOG": "sh", "SHG": "shg", "PPG": "ppg", "PPA": "ppa",
}


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("'", "").replace("-", " ").replace("&", " and ")
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def name_key(text: str) -> str:
    key = re.sub(r"\([^)]*\)", " ", norm(text))
    return re.sub(r"\s+", " ", re.sub(r"\b(jr|sr|ii|iii|iv)\b", " ", key)).strip()


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", norm(text))).strip("-")


def clean_name(text: str) -> str:
    """Drop the feed's decorations: captain stars, (AP) affiliate tags."""
    name = re.sub(r"[★☆]", " ", text or "")
    name = re.sub(r"\([^)]*\)", " ", name)
    return re.sub(r"\s+", " ", name).strip()


def slug_suffix(text: str) -> str:
    """Club slug without the league prefix, matching how team slugs are shaped."""
    return slugify(text)


def parse_page(path: str) -> tuple[str, int, list[dict]]:
    raw = open(path, encoding="utf-8", errors="ignore").read()
    title = htmllib.unescape(re.search(r"<title>(.*?)</title>", raw, re.S).group(1))
    league = next((lid for frag, lid in LEAGUES.items() if frag in title), "")
    year = re.search(r"(20\d\d)", title)
    if not league or not year:
        return "", 0, []
    heads = [
        htmllib.unescape(re.sub(r"<[^>]+>", "", h)).strip().upper().replace(" ↓", "")
        for h in re.findall(r"<th[^>]*>(.*?)</th>", raw, re.S)
    ]
    index = {name: i for i, name in enumerate(heads)}
    body = raw[raw.find("<tbody"): raw.find("</tbody>") + 8]
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        cells = [
            htmllib.unescape(re.sub(r"<[^>]+>", " ", c)).strip()
            for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        ]
        if len(cells) < 10:
            continue

        def cell(name: str) -> str:
            i = index.get(name)
            return cells[i] if i is not None and i < len(cells) else ""

        rows.append({
            "name": cell("PLAYER"),
            "jersey": cell("#"),
            "pos": cell("POS"),
            "team": cell("TEAM"),
            "stats": {field: cell(col) for col, field in STATS.items()},
        })
    return league, int(year.group(1)), [r for r in rows if r["name"]]


def build_rows(reparse: bool) -> dict:
    out = os.path.join(ROOT, "data", "gs-rosters-2026.json")
    if os.path.exists(out) and not reparse:
        with open(out) as f:
            return json.load(f)
    payload: dict[str, dict] = {}
    for path in sorted(glob.glob(os.path.join(PAGES, "*.html"))):
        league, year, rows = parse_page(path)
        if not rows:
            print(f"  ! {os.path.basename(path)}: no table parsed")
            continue
        key = f"{league}-{year}"
        payload[key] = {"league": league, "season": str(year), "rows": rows}
        print(f"  {os.path.basename(path):<22} {league:<10} {year}  {len(rows):>3} rows")
    with open(out, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    return payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--reparse", action="store_true")
    args = ap.parse_args()

    payload = build_rows(args.reparse)
    with open(DATA) as f:
        data = json.load(f)

    teams = {t["id"]: t for t in data["teams"]}
    by_team_name: dict[tuple[str, str], str] = {}
    by_team_squash: dict[tuple[str, str], str] = {}
    for t in data["teams"]:
        for alias in (t["name"], t["shortName"]):
            key = norm(alias)
            by_team_name[(t["leagueId"], key)] = t["id"]
            by_team_squash.setdefault((t["leagueId"], key.replace(" ", "")), t["id"])
    league_names = {l["id"]: l for l in data["leagues"]}
    # a club can change league between seasons (Elora Hawks play OJLL in 2026 after OJBLL),
    # so fall back to a club name that is unique across the box ladder rather than minting
    # a second "Elora Hawks" page
    box_by_name: dict[str, list[str]] = {}
    for t in data["teams"]:
        if t["leagueId"].startswith("nf-"):
            box_by_name.setdefault(norm(t["name"]), []).append(t["id"])

    by_player: dict[str, list[dict]] = {}
    for p in data["players"]:
        by_player.setdefault(name_key(p["name"]), []).append(p)
    used_slugs = {p["slug"] for p in data["players"]}
    max_id = max(int(re.sub(r"\D", "", p["id"]) or 0) for p in data["players"][:1]) if False else 0

    added_players = added_seasons = updated_rows = 0
    created_teams = skipped_team = 0
    for block in payload.values():
        league, season = block["league"], block["season"]
        for row in block["rows"]:
            club = norm(row["team"])
            if re.fullmatch(r"\d+\s*teams?", club or ""):
                continue                      # a placeholder for multi-club players
            team_id = by_team_name.get((league, club)) or by_team_squash.get(
                (league, club.replace(" ", ""))
            )
            if not team_id:
                team_id = next(
                    (tid for (lid, tname), tid in by_team_name.items()
                     if lid == league and (tname in club or club in tname)),
                    None,
                )
            if not team_id:
                across = box_by_name.get(club, [])
                if len(across) == 1:
                    team_id = across[0]
            if not team_id and club:
                # a club that only exists from 2026 on: create it so its roster lands
                team_id = f"t-{league.replace('nf-', '')}-{slug_suffix(row['team'])}"
                lg = league_names.get(league, {})
                data["teams"].append({
                    "id": team_id,
                    "name": row["team"],
                    "shortName": row["team"],
                    "slug": slug_suffix(row["team"]),
                    "leagueId": league,
                    "conference": lg.get("name", ""),
                    "colors": ["#5B6472", "#8A93A3"],
                })
                by_team_name[(league, club)] = team_id
                by_team_squash[(league, club.replace(" ", ""))] = team_id
                box_by_name.setdefault(club, []).append(team_id)
                created_teams += 1
            if not team_id:
                skipped_team += 1
                continue

            stats = {}
            for field, value in row["stats"].items():
                digits = re.sub(r"[^0-9]", "", value or "")
                if digits:
                    stats[field] = int(digits)
            stats.setdefault("gp", 0)
            if not stats["gp"]:
                continue

            season_row = {
                "season": season, "teamId": team_id, "leagueId": league, "type": "regular",
                "gp": stats.get("gp", 0), "gs": 0, "g": stats.get("g", 0), "a": stats.get("a", 0),
                "pts": stats.get("pts", 0), "sh": stats.get("sh", 0), "gb": 0, "to": 0,
                "ct": 0, "foW": 0, "foA": 0, "pen": stats.get("pen", 0), "min": 0,
                "ga": 0, "sv": 0, "w": 0, "l": 0,
            }

            candidates = by_player.get(name_key(row["name"]), [])
            match = next(
                (p for p in candidates if any(s["teamId"] == team_id for s in p["seasons"])),
                None,
            )
            if match:
                exists = next(
                    (s for s in match["seasons"] if s["season"] == season and s["teamId"] == team_id),
                    None,
                )
                if exists:
                    if not exists.get("gp") and stats["gp"]:
                        exists.update(season_row)
                        updated_rows += 1
                else:
                    match["seasons"].append(season_row)
                    match["seasons"].sort(key=lambda s: (s["season"], s["teamId"]))
                    added_seasons += 1
                continue

            # a player we do not hold at all: create the minimum the site renders
            slug = slugify(clean_name(row["name"]))
            base, n = slug, 1
            while slug in used_slugs:
                n += 1
                slug = f"{base}-{n}"
            used_slugs.add(slug)
            pos_code, pos_name = POSITIONS.get((row["pos"] or "").upper(), ("F", "Forward"))
            display = clean_name(row["name"])
            parts = display.split()
            player = {
                "id": f"p-{league}-{slug}",
                "slug": slug,
                "firstName": parts[0].title(),
                "lastName": " ".join(parts[1:]).title(),
                "name": display.title(),
                "position": pos_code,
                "positionName": pos_name,
                "birthplace": {"city": "", "state": "", "country": "CAN"},
                "teamId": team_id,
                "leagueId": league,
                "status": "Active",
                "scouting": {"report": "", "author": "", "date": "", "grades": {}},
                "seasons": [season_row],
            }
            jersey = re.sub(r"\D", "", row["jersey"] or "")
            if jersey:
                player["jersey"] = int(jersey)
            line = {"gp": 0, "g": 0, "a": 0, "pts": 0, "pen": 0, "seasons": 1}
            for key in ("gp", "g", "a", "pts", "pen"):
                line[key] = season_row[key]
            player["careerLine"] = line
            data["players"].append(player)
            by_player.setdefault(name_key(display), []).append(player)
            added_players += 1

    data["teams"].sort(key=lambda t: (t["leagueId"], t["name"]))
    print(f"\nnew players {added_players} · new season rows {added_seasons} · "
          f"rows filled {updated_rows} · new clubs {created_teams} · "
          f"unmatched rows {skipped_team}")
    if not args.apply:
        print("dry run — pass --apply to write")
        return 0
    with open(DATA, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"wrote {DATA} — {len(data['players'])} players")
    return 0


if __name__ == "__main__":
    sys.exit(main())
