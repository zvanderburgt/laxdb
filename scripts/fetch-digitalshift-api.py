#!/usr/bin/env python3
"""Bios from the Digitalshift stats API instead of a rendered page.

`fetch-digitalshift.py` drives a headless browser through the same league platform
because its player API was believed to be closed. It is not: every site publishes its
tenant id in `window.config.client_service_id`, and

    POST https://web.api.digitalshift.ca/login  {"client_service_id": "<tenant>"}
    -> {"ticket": {"hash": "..."}}

    GET  https://web.api.digitalshift.ca/partials/stats/...  Authorization: ticket="<hash>"

needs no key and no browser. The partials come back as `{"content": "<html>"}`, and the
roster table inside carries the same columns the rendered page shows — `# | Name | POS |
Shoots | Height | Weight | Hometown | Minor Association | Sponsor | Collegiate Team` —
plus each player's `/stats#/player/<id>/bio` link.

The bio columns are a per-season switch on their side: the **current** season publishes
them, every older roster is `# | Name | POS` only. So this pass enriches today's rosters
(handedness, height, weight, hometown, jersey) and reports the rest as no-column, not as
a parse failure.

  python3 scripts/fetch-digitalshift-api.py                  # report, no writes
  python3 scripts/fetch-digitalshift-api.py --apply
  python3 scripts/fetch-digitalshift-api.py --only nf-bcjall --apply
  python3 scripts/fetch-digitalshift-api.py --refresh        # ignore the roster cache
  python3 scripts/fetch-digitalshift-api.py --photos         # also pull headshots

Leagues whose domain now 301s to canadianlacrosseleague.com (WCJLL, TOJLL, RMLL) are not
here: the redirect target hosts three unrelated leagues, so their tenant id is gone with
the old site. `wla.ca` is a parked domain. Tenant ids in the map below were read from
each site's `window.config`.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
import gzip
import html as H
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gamesheet import name_key, norm  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
CACHE = os.path.join(ROOT, "scripts", ".cache", "ds", "api")

API = "https://web.api.digitalshift.ca"

# our league id -> (site the tenant was read from, client_service_id, league id)
TENANTS = {
    "nf-bcjall": ("bcjall.com", "295901f9-454c-4158-bcca-2c643672df78", 23),
    "nf-pnwjll": ("pnwjll.com", "8722a4a1-16d5-4eaf-952b-5a2dbfa76906", 675),
    "nf-osl": ("ontarioserieslacrosse.com", "d8d5e08f-9747-40a7-a053-a28f42227e9d", 284),
}

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0"
_TICKETS: dict[str, str] = {}


def _request(url: str, payload: dict | None = None, ticket: str | None = None,
             timeout: int = 45) -> bytes:
    headers = {"Accept": "application/json", "User-Agent": UA,
               "X-Requested-With": "XMLHttpRequest"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if ticket:
        headers["Authorization"] = f'ticket="{ticket}"'
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode() if payload is not None else None,
        headers=headers, method="POST" if payload is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        return body


def ticket(csid: str) -> str:
    """Anonymous session for one tenant; one login per run, cached in memory."""
    if csid not in _TICKETS:
        body = json.loads(_request(f"{API}/login", {"client_service_id": csid}))
        _TICKETS[csid] = body["ticket"]["hash"]
    return _TICKETS[csid]


def partial(csid: str, path: str) -> str:
    """One API partial, unwrapped from its {"content": "..."} envelope."""
    body = json.loads(_request(f"{API}{path}", ticket=ticket(csid)))
    return body.get("content") or ""


def _cells(row_html: str) -> list[str]:
    out = []
    for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, re.S):
        text = H.unescape(re.sub(r"<[^>]+>", " ", cell))
        out.append(re.sub(r"\s+", " ", text).strip())
    return out


def parse_roster(content_html: str) -> list[dict]:
    """Every row of the roster table, keyed by its own header row.

    Header-driven on purpose: a current-season roster publishes nine columns and an
    archived one publishes three, and the same parser has to read both without
    inventing values for the columns that are missing.
    """
    table = re.search(r"<table.*?</table>", content_html, re.S)
    if not table:
        return []
    table = table.group(0)
    head_html = re.search(r"<thead.*?</thead>", table, re.S)
    heads = _cells(head_html.group(0)) if head_html else []
    heads = [re.sub(r"^[^A-Za-z#]+", "", h).strip() for h in heads]
    index = {}
    for i, h in enumerate(heads):
        key = h.lower()
        for want in ("#", "name", "pos", "shoots", "catches", "height", "weight",
                     "hometown", "minor", "sponsor", "collegiate"):
            if key.startswith(want):
                index.setdefault(want, i)
    rows = []
    body = re.search(r"<tbody.*?</tbody>", table, re.S)
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body.group(0) if body else table, re.S):
        cells = _cells(tr)
        if len(cells) < 2:
            continue

        def get(want: str) -> str:
            i = index.get(want)
            return cells[i] if i is not None and i < len(cells) else ""

        pid = re.search(r"#/player/(\d+)/", tr)
        if not get("name"):
            continue
        rows.append({
            "player_id": pid.group(1) if pid else "",
            "jersey": get("#"),
            "name": get("name"),
            "pos": get("pos"),
            # goalies publish their catch hand, which is the inverse of the throwing
            # hand — say so rather than inverting a field we would then have to trust
            "shoots": get("shoots") or ("CT " + get("catches") if get("catches") else ""),
            "height": get("height"),
            "weight": get("weight"),
            "hometown": get("hometown"),
            "minor": get("minor"),
            "collegiate": get("collegiate"),
        })
    return rows


def inches(text: str) -> int:
    m = re.search(r"(\d)\s*['’]\s*(\d{1,2})", text or "")
    if m:
        value = int(m.group(1)) * 12 + int(m.group(2))
        return value if 55 <= value <= 96 else 0
    return 0


def pounds(text: str) -> int:
    m = re.search(r"(\d{2,3})", text or "")
    if not m:
        return 0
    value = int(m.group(1))
    return value if 100 <= value <= 350 else 0


def hand_of(text: str) -> str:
    key = (text or "").strip().lower()
    if key.startswith("ct"):
        return ""          # catch hand — never stored as the throwing hand
    if key.startswith("l"):
        return "L"
    if key.startswith("r"):
        return "R"
    return ""


def seasons_and_teams(csid: str, league_id: int) -> list[dict]:
    """Every season of the league with its divisions and clubs, newest first.

    A season with no divisions yet (OSL 2026) is skipped rather than reported as an
    empty club list, and the split-season sites (PNWJLL lists `2026 Provincials`,
    `2026 Playoffs` and `2026 Season` separately) each keep their own team ids — the
    same club appears under a different id per season, which is why the roster has to
    be fetched per season and not once per club.
    """
    filters = json.loads(_request(f"{API}/partials/stats/filters?type=league&id={league_id}",
                                  ticket=ticket(csid)))
    out = []
    for season in filters.get("season", {}).get("options") or []:
        divisions = json.loads(_request(
            f"{API}/partials/stats/filters?type=season&id={season['id']}",
            ticket=ticket(csid))).get("division", {}).get("options") or []
        teams = []
        for div in divisions:
            found = json.loads(_request(
                f"{API}/partials/stats/filters?type=division&id={div['id']}",
                ticket=ticket(csid))).get("team", {}).get("options") or []
            for team in found:
                teams.append({"division": div.get("name", ""), "id": team["id"],
                              "name": team.get("name", "")})
        if teams:
            out.append({"season": season.get("name", ""), "teams": teams})
    return out


def collect(league_id: str, refresh: bool) -> dict[str, dict[str, list[dict]]]:
    """season -> club name -> roster rows, cached per league so a re-run is a disk read."""
    site, csid, tenant_league = TENANTS[league_id]
    path = os.path.join(CACHE, f"{league_id}.json")
    if os.path.exists(path) and not refresh:
        return json.load(open(path))["seasons"]
    seasons: dict[str, dict[str, list[dict]]] = {}
    n_seasons = 0
    for season in seasons_and_teams(csid, tenant_league):
        clubs: dict[str, list[dict]] = {}
        for team in season["teams"]:
            content = partial(csid, f"/partials/stats/team/roster?team_id={team['id']}")
            rows = parse_roster(content)
            if rows:
                clubs[team["name"]] = rows
        if clubs:
            seasons[season["season"]] = clubs
            n_seasons += 1
    os.makedirs(CACHE, exist_ok=True)
    json.dump({"site": site, "seasons": seasons}, open(path, "w"))
    return seasons


def photo_for(csid: str, player_id: str) -> str:
    """Headshot URL from the player partial, or '' — the roster table has no image."""
    content = partial(csid, f"/partials/stats/player?player_id={player_id}")
    m = re.search(r'class="photo"><img src="([^"]+)"', content)
    return H.unescape(m.group(1)) if m else ""


def fetch_bytes(url: str, timeout: int = 45) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def save_image(data: bytes, rel_path: str) -> bool:
    """Square webp, 30% from the top — the same crop every other asset writer uses.

    Digitalshift serves signed 140px thumbnails (any other size in the filename 403s), so a
    source smaller than 224 is kept at its own size rather than upscaled: the browser scales
    it, and a 1.6x resample would only soften it twice.
    """
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return False
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = int((h - side) * 0.30)
    target = 224 if side >= 224 else side
    img = img.crop((left, top, left + side, top + side)).resize((target, target), Image.LANCZOS)
    path = os.path.join(ROOT, "public", rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "WEBP", quality=84, method=6)
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", help="limit to one of our league ids")
    ap.add_argument("--refresh", action="store_true", help="ignore the roster cache")
    ap.add_argument("--photos", action="store_true", help="download headshots too")
    args = ap.parse_args()

    data = json.load(open(DATA))
    team_by_id = {t["id"]: t for t in data["teams"]}
    by_name: dict[str, list[dict]] = defaultdict(list)
    for p in data["players"]:
        by_name[name_key(p["name"])].append(p)

    filled = defaultdict(int)
    for league_id, (site, csid, _tenant) in TENANTS.items():
        if args.only and args.only != league_id:
            continue
        seasons = collect(league_id, args.refresh)
        names = list(seasons)                      # newest first, as the site lists them
        clubs_seen = set()
        rows_total = 0
        hits = 0
        bio_seasons = []
        photo_todo = []
        seen_photos: set[str] = set()
        for season, clubs in seasons.items():
            year = re.match(r"\d{4}", season)
            year = year.group(0) if year else ""
            with_bios = sum(1 for rows in clubs.values() if any(r["shoots"] or r["height"] for r in rows))
            if with_bios:
                bio_seasons.append(season)
            clubs_seen |= set(clubs)
            for club_name, rows in clubs.items():
                club = norm(club_name)
                rows_total += len(rows)
                for row in rows:
                    for p in by_name.get(name_key(row["name"]), []):
                        # identity: the club must already be in this player's career in
                        # this league, and in this season when the roster names one
                        on_league = [s for s in p["seasons"]
                                     if team_by_id.get(s["teamId"], {}).get("leagueId") == league_id
                                     and (not year or s.get("season") == year)]
                        if not on_league:
                            continue
                        held = set()
                        for s in on_league:
                            t = team_by_id.get(s["teamId"]) or {}
                            held |= {norm(t.get("name", "")), norm(t.get("shortName", ""))}
                        squashed = {n.replace(" ", "") for n in held}
                        if not (club in held or {club.replace(" ", "")} & squashed
                                or any(n and (n in club or club in n) for n in held)):
                            continue
                        hits += 1
                        if not p.get("heightIn") and inches(row["height"]):
                            p["heightIn"] = inches(row["height"])
                            filled["heightIn"] += 1
                        if not p.get("weightLb") and pounds(row["weight"]):
                            p["weightLb"] = pounds(row["weight"])
                            filled["weightLb"] += 1
                        city = (row["hometown"] or "").strip()
                        if city and not (p.get("birthplace") or {}).get("city"):
                            bp = dict(p.get("birthplace") or {"city": "", "state": "", "country": ""})
                            bp["city"] = city
                            bp["country"] = bp.get("country") or "CAN"
                            p["birthplace"] = bp
                            filled["birthplace"] += 1
                        if not p.get("hand") and hand_of(row["shoots"]):
                            p["hand"] = hand_of(row["shoots"])
                            filled["hand"] += 1
                        # seasons are walked newest first and the guard is "empty only",
                        # so the number stamped is the newest one we have for that player
                        if not p.get("jersey") and row["jersey"].isdigit():
                            p["jersey"] = int(row["jersey"])
                            filled["jersey"] += 1
                        if args.photos and not p.get("photo") and row["player_id"] \
                                and p["id"] not in seen_photos:
                            seen_photos.add(p["id"])
                            photo_todo.append((p, row["player_id"]))
                        break
        print(f"  {league_id:<14}{len(names):>3} seasons {len(clubs_seen):>3} clubs "
              f"{rows_total:>5} rows {len(bio_seasons):>3} with bios {hits:>5} matched")
        if bio_seasons:
            print(f"    bios on: {', '.join(bio_seasons)}")

        if photo_todo:
            for p, pid in photo_todo:
                try:
                    url = photo_for(csid, pid)
                    if not url:
                        continue
                    rel = f"players/ds/{p['slug']}.webp"
                    if save_image(fetch_bytes(url), rel):
                        p["photo"] = rel
                        filled["photo"] += 1
                except Exception as e:                      # one bad file never stops the pass
                    print(f"      photo {p['name']}: {type(e).__name__}")

    print("\n" + (" · ".join(f"{k} +{v}" for k, v in sorted(filled.items()))
                  if filled else "nothing filled"))
    if args.apply:
        with open(DATA, "w") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"wrote {DATA}")
    else:
        print("dry run — pass --apply to write")
    return 0


if __name__ == "__main__":
    sys.exit(main())
