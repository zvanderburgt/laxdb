#!/usr/bin/env python3
"""Import a whole GameSheet season: every player, every stat line, every bio.

The enrichment pass (`fetch-gamesheet.py`) only fills fields on players we already have,
so a season whose players came from nowhere stays empty — OJLL 2026 held 125 of the
league's 452 players. But GameSheet's own standings payload is a complete season:
`/api/players/standings/<season>?limit=5000` returns one row per player with bio
(birthdate, height, weight, hometown, jersey, photoUrl, positions) *and* the stat line,
so a season can be imported without inventing anything.

Created players carry a real stat row, which is the condition for adding one — a roster
page alone never justifies a new player.

  python3 scripts/import-gamesheet-season.py                       # report, no writes
  python3 scripts/import-gamesheet-season.py --apply
  python3 scripts/import-gamesheet-season.py --apply --only nf-ojll
  python3 scripts/import-gamesheet-season.py --apply --photos      # headshots too

Identity rules, same as everywhere else in this repo: a printed name is never enough on
its own. A row attaches to an existing player when that player has the club anywhere in
his career, or the same date of birth, or is the only holder of the name. Ambiguous
rows are reported, not guessed.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import positions  # noqa: E402
from gamesheet import GameSheet, name_key, norm, parse_height, parse_weight  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
PHOTOS = os.path.join(ROOT, "public", "players", "gs")
CACHE = os.path.join(ROOT, "scripts", ".cache", "gs")

# our league id -> GameSheet season ids, newest last (the report prints them in order)
SEASONS = {
    "nf-ojll": [9708, 14861],      # 2025, 2026
}

# GameSheet club title (as printed) -> our team id, where the two disagree. The 2025
# season still calls the Kitchener club "Kitchener"; it renamed to Kodiaks for 2026, and
# Elora Hawks is filed under OJBLL because that is where the franchise played until 2025.
CLUB_ALIASES = {
    "kitchener": "t-ojll-kitchener-waterloo",
    "kitchener kodiaks": "t-ojll-kitchener-kodiaks",
    "elora hawks": "t-ojbll-elora-hawks",
}

SCHEMA_ROW = ("season", "teamId", "leagueId", "type", "gp", "gs", "g", "a", "pts", "sh",
              "gb", "to", "ct", "foW", "foA", "pen", "min", "ga", "sv", "w", "l")


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "player"



_DECOR = re.compile(r"[\u2605\u2606\u2600-\u27bf\u2b00-\u2bff\u25a0-\u25ff]")


def _case_word(word: str) -> str:
    low = word.lower()
    if low.startswith("mac") and len(word) >= 5:
        return "Mac" + word[3:].title()
    if low.startswith("mc") and len(word) >= 4:
        return "Mc" + word[2:].title()
    if len(word) > 2 and word[0] in "ODD" and word[1] == "'":
        return word[0] + "'" + word[2:].title()
    return word[:1].upper() + word[1:].lower()


def pretty_name(text: str) -> str:
    """GameSheet prints "LIAM ASTON ★" or "DERRIck (DJ) CROUGH(AP)" — strip the markers and case it.

    The star is a captain and the flag an affiliate, so neither belongs in a name; "(AP)"
    is GameSheet's own affiliate tag and goes too. All caps is cased with the Mc/Mac/O'
    fixes, because `.title()` alone renders "Mcmillan" and "MaCleod".
    """
    text = _DECOR.sub(" ", text or "")
    text = re.sub(r"\s*\(a\.?p\.?\)\s*", " ", text, flags=re.I)
    # "MaCleod" survives any casing decision, so repair it either way
    text = re.sub(r"\bMaC([A-Za-z])", lambda m: "Mac" + m.group(1).upper(), text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text or not text.isupper():
        return text
    out = []
    for chunk in re.findall(r"[A-Za-z']+|[^A-Za-z']+", text):
        out.append(_case_word(chunk) if chunk.isalpha() or "'" in chunk else chunk)
    text = "".join(out).strip()
    # "(DJ)" is an initialism, not a word
    return re.sub(r"\(([a-z]{1,3})\)", lambda m: "(" + m.group(1).upper() + ")", text)

def row_name(row: dict) -> str:
    return f'{row.get("firstName") or ""} {row.get("lastName") or ""}'.strip()


def stat_row(row: dict, season: str, team_id: str, league_id: str) -> dict:
    """One season row in the shape the rest of the pipeline expects."""
    st = row.get("stats") or {}
    out = {key: 0 for key in SCHEMA_ROW}
    out.update({"season": season, "teamId": team_id, "leagueId": league_id, "type": "regular"})
    out["gp"] = int(st.get("gp") or 0)
    out["g"] = int(st.get("g") or 0)
    out["a"] = int(st.get("a") or 0)
    out["pts"] = int(st.get("pts") or out["g"] + out["a"])
    out["sh"] = int(st.get("sog") or 0)
    out["pen"] = int(st.get("pim") or 0)
    # goalie columns, when the row is a goalie
    if (st.get("min") or st.get("ga") is not None) and "sa" in st:
        out["min"] = int(st.get("min") or 0)
        out["ga"] = int(st.get("ga") or 0)
        out["sv"] = int(st.get("saves") or 0)
    return out


def position_of(row: dict) -> str:
    codes = [positions.code(p) for p in (row.get("positions") or [])]
    codes = [c for c in codes if c]
    for want in ("G", "T", "D", "F", "R"):
        if want in codes:
            return want
    return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", help="limit to one of our league ids")
    ap.add_argument("--photos", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    data = json.load(open(DATA))
    players = data["players"]
    teams = {t["id"]: t for t in data["teams"]}
    by_name: dict[str, list[dict]] = defaultdict(list)
    for p in players:
        by_name[name_key(p["name"])].append(p)
    slugs = {p["slug"] for p in players}
    by_dob = {p["dob"]: p for p in players if p.get("dob")}

    gs = GameSheet(cache_dir=CACHE, refresh=args.refresh)
    filled = defaultdict(int)

    def team_for(club_title: str, abbrev: str, league_id: str) -> str:
        name = norm(club_title)
        for team in teams.values():
            if team["leagueId"] == league_id and norm(team["name"]) == name:
                return team["id"]
        alias = CLUB_ALIASES.get(name)
        if alias and alias in teams:
            return teams[alias]["id"]
        # a club we have never seen: create it, so its players have a home
        slug = f"{league_id.replace('nf-', '')}-{slugify(club_title)}"
        tid = f"t-{slug}"
        teams[tid] = {"id": tid, "name": club_title, "shortName": abbrev or club_title,
                      "slug": slug, "leagueId": league_id}
        data["teams"].append(teams[tid])
        filled["teams created"] += 1
        return tid

    for league_id, season_ids in SEASONS.items():
        if args.only and args.only != league_id:
            continue
        for season_id in season_ids:
            info = gs.season_info(season_id) or {}
            season = (info.get("start") or "")[:4] or str(season_id)
            rows = gs.players(season_id, limit=5000)
            stats_seen = matched = created = added = 0
            ambiguous = []
            for row in rows:
                clubs = row.get("teams") or []
                if not clubs:
                    continue
                club = clubs[0]
                team_id = team_for(club.get("title") or "", club.get("abbreviation") or "", league_id)
                dob = (row.get("birthdate") or "")[:10]
                name = row_name(row)
                cands = by_name.get(name_key(name), [])
                player = None
                if len(cands) == 1:
                    player = cands[0]
                elif len(cands) > 1:
                    same_dob = [p for p in cands if dob and p.get("dob") == dob]
                    on_club = [p for p in cands
                               if any(norm(teams.get(s["teamId"], {}).get("name", "")) == norm(club.get("title") or "")
                                      for s in p["seasons"])]
                    settled = same_dob or on_club
                    if len(settled) > 1:
                        # the holder who already carries a row for this very season is
                        # the same person: two players do not share one season on a club
                        have_row = [q for q in settled
                                    if any(x.get("leagueId") == league_id and x.get("season") == season
                                           for x in q["seasons"])]
                        if len(have_row) == 1:
                            settled = have_row
                    if len(settled) == 1:
                        player = settled[0]
                    else:
                        # several people share the name and neither the birth date nor the
                        # club picks one out. Report it; never mint a new player here.
                        ambiguous.append(f"{name} ({len(cands)} holders, {len(settled)} on evidence)")
                        continue
                elif dob and dob in by_dob:
                    player = by_dob[dob]
                stats_seen += 1
                if player is None:
                    if cands:
                        ambiguous.append(f"{name} (name held, no evidence)")
                        continue
                    if not (row.get("stats") or {}).get("gp"):
                        continue                      # no stat line: not a player to add
                    pid = f"p-gs-{row.get('id')}"
                    base = slugify(name)
                    slug, n = base, 2
                    while slug in slugs:
                        slug, n = f"{base}-{n}", n + 1
                    slugs.add(slug)
                    player = {
                        "id": pid, "slug": slug,
                        "firstName": pretty_name(row.get("firstName") or ""),
                        "lastName": pretty_name(row.get("lastName") or ""),
                        "name": pretty_name(name),
                        "position": position_of(row) or "R",
                        "positionName": positions.POS_LABEL.get(position_of(row) or "R", "Runner"),
                        "birthplace": {"city": "", "state": "", "country": "CAN"},
                        "teamId": team_id, "leagueId": league_id,
                        "status": "Active",
                        "scouting": {"report": "", "author": "", "date": "", "grades": {}},
                        "seasons": [],
                    }
                    players.append(player)
                    by_name[name_key(player["name"])].append(player)
                    created += 1
                else:
                    matched += 1
                # upsert the season row: a fuller line replaces a thinner one
                new_row = stat_row(row, season, team_id, league_id)
                existing = next((s for s in player["seasons"]
                                 if s.get("leagueId") == league_id and s.get("season") == season), None)
                if existing is None:
                    player["seasons"].append(new_row)
                    added += 1
                elif new_row["gp"] > existing.get("gp", 0):
                    existing.update(new_row)
                    added += 1
                # bios: fill only what is empty
                if not player.get("dob") and dob:
                    player["dob"] = dob
                    by_dob[dob] = player
                    filled["dob"] += 1
                if not player.get("heightIn") and parse_height(row.get("height") or ""):
                    player["heightIn"] = parse_height(row.get("height") or "")
                    filled["heightIn"] += 1
                if not player.get("weightLb") and parse_weight(row.get("weight") or ""):
                    player["weightLb"] = parse_weight(row.get("weight") or "")
                    filled["weightLb"] += 1
                city = (row.get("hometown") or "").strip()
                if city and not (player.get("birthplace") or {}).get("city"):
                    bp = dict(player.get("birthplace") or {"city": "", "state": "", "country": "CAN"})
                    bp["city"] = city
                    player["birthplace"] = bp
                    filled["hometown"] += 1
                if not player.get("jersey") and str(row.get("jersey") or "").strip().isdigit():
                    player["jersey"] = int(row["jersey"])
                    filled["jersey"] += 1
                if position_of(row) and player.get("position") in ("", "R"):
                    player["position"] = position_of(row)
                    player["positionName"] = positions.POS_LABEL.get(player["position"], "Runner")
                    filled["position"] += 1
                if args.photos and not player.get("photo") and row.get("photoUrl"):
                    try:
                        from PIL import Image
                        url = row["photoUrl"]
                        path = os.path.join(PHOTOS, f"{player['slug']}.webp")
                        os.makedirs(PHOTOS, exist_ok=True)
                        if not os.path.exists(path):
                            gs.download(url, path + ".src")
                            img = Image.open(path + ".src").convert("RGB")
                            w, h = img.size
                            side = min(w, h)
                            left = (w - side) // 2
                            top = int((h - side) * 0.30)
                            img.crop((left, top, left + side, top + side)).resize(
                                (224, 224), Image.LANCZOS).save(path, "WEBP", quality=84, method=6)
                            os.remove(path + ".src")
                        player["photo"] = f"players/gs/{player['slug']}.webp"
                        filled["photo"] += 1
                    except Exception as e:
                        print(f"      photo {player['name']}: {type(e).__name__}")
            print(f"  {league_id:<10}{season}  {len(rows):>4} rows  {matched:>4} matched"
                  f"  {created:>4} new players  {added:>4} season rows"
                  f"  {len(ambiguous):>3} ambiguous")
            for note in ambiguous[:6]:
                print(f"      ? {note}")

    print("\n" + (" · ".join(f"{k} +{v}" for k, v in sorted(filled.items()))
                  if filled else "nothing filled"))
    if args.apply:
        # one slug per person, across the whole dataset
        seen = set()
        for p in players:
            slug = p["slug"]
            if slug in seen:
                base, n = slug, 2
                while f"{base}-{n}" in seen:
                    n += 1
                p["slug"] = f"{base}-{n}"
            seen.add(p["slug"])
        with open(DATA, "w") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"wrote {DATA} ({len(players)} players, {len(data['teams'])} clubs)")
    else:
        print("dry run — pass --apply to write")
    return 0


if __name__ == "__main__":
    sys.exit(main())
