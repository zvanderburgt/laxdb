#!/usr/bin/env python3
"""
Headshots for D1 players who do not have one yet.

The importer only understands the older Sidearm roster markup (aria-label + a
images.sidearmdev.com crop). The 2025-era template instead puts the headshot in a
background-image on a `data-player-id` list item, which is why the newly added
programs came in without photos. This reads both shapes and patches data.json.

Usage: python3 scripts/fetch-headshots.py [--limit N] [--dry]
"""
import html as _html
import importlib.util, io, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
DRY = "--dry" in sys.argv
LIMIT = None
for i, a in enumerate(sys.argv):
    if a == "--limit":
        LIMIT = int(sys.argv[i + 1])

spec = importlib.util.spec_from_file_location("imp", os.path.join(ROOT, "scripts", "fetch-real-data.py"))
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)

from PIL import Image


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("content-type", "")


def norm(name):
    return re.sub(r"[^a-z]", "", (name or "").lower())


def parse_roster(html):
    """name -> headshot url, for both the old and the current Sidearm cards."""
    out = {}

    # current template: background-image on a data-player-id card, name in the bio link
    for m in re.finditer(r'<li class="sidearm-list-card-item"[^>]*data-player-id="(\d+)"(.{0,9000}?)</li>', html, re.S):
        seg = m.group(2)
        img = re.search(r"background-image:url\('([^']+)'\)", seg)
        name = re.search(r'title="([^"]+?) - View Full Bio"', seg)
        if img and name:
            out[norm(_html.unescape(name.group(1)))] = _html.unescape(img.group(1))

    # older template
    for m in re.finditer(r'aria-label="([^"]+?) jersey number', html):
        name = _html.unescape(m.group(1)).strip()
        seg = html[m.start(): m.start() + 2600]
        hit = re.search(r'(https://images\.sidearmdev\.com/crop\?url=[^"\s]+)', seg)
        if hit:
            url = _html.unescape(hit.group(1)).replace("width=100", "width=220").replace("height=100", "height=220")
            out[norm(name)] = url

    return out


def save(data, rel_path, size=(224, 224), bias=0.18):
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return False
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = int((h - side) * bias)
    img = img.crop((left, top, left + side, top + side)).resize(size, Image.LANCZOS)
    path = os.path.join(ROOT, "public", rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "WEBP", quality=84, method=6)
    return True


def main():
    payload = json.load(open(DATA))
    domains = {row[0]: row[1] for row in imp.SCHOOLS}
    teams = {t["id"]: t for t in payload["teams"] if t["leagueId"] == "ncaa-d1"}

    todo = {}
    for p in payload["players"]:
        if p["leagueId"] != "ncaa-d1" or p.get("photo"):
            continue
        if p["teamId"] not in teams:
            continue
        todo.setdefault(p["teamId"], []).append(p)

    print(f"{sum(len(v) for v in todo.values())} D1 players without a headshot across {len(todo)} teams")
    added = 0
    for n, (team_id, players) in enumerate(todo.items()):
        if LIMIT and n >= LIMIT:
            break
        team = teams[team_id]
        domain = domains.get(team["name"])
        if not domain:
            continue
        photos = {}
        for path in ("/sports/mens-lacrosse/roster/2026", "/sports/mens-lacrosse/roster"):
            try:
                raw, ctype = get("https://" + domain + path)
            except Exception:
                continue
            if "html" not in ctype:
                continue
            found = parse_roster(raw.decode("utf-8", "ignore"))
            photos.update(found)
            if len(found) > 20:
                break
        if not photos:
            print(f"  ! {team['shortName']}: no photos on the roster page")
            continue

        took = 0
        # a placeholder silhouette is reused for everyone without a photo
        reused = {}
        for u in photos.values():
            reused[u] = reused.get(u, 0) + 1
        for u, n_ in list(reused.items()):
            if n_ > 2:
                photos = {k: v for k, v in photos.items() if v != u}

        for p in players:
            url = photos.get(norm(p["name"])) or photos.get(norm(p["firstName"][:1] + p["lastName"]))
            if not url:
                continue
            # some rosters print a root-relative path; resolve it against the school's site
            if url.startswith("/"):
                url = "https://" + domain + url
            elif url.startswith("//"):
                url = "https:" + url
            fname = re.sub(r"[^a-z0-9-]", "", p["id"].lower())
            rel = f"players/ncaa/{fname}.webp"
            if DRY:
                took += 1
                continue
            try:
                blob, ctype = get(url)
            except Exception:
                continue
            if "image" not in ctype:
                continue
            if save(blob, rel):
                p["photo"] = rel
                took += 1
        added += took
        print(f"  + {team['shortName']}: {took}/{len(players)}")

    if not DRY and added:
        with open(DATA, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
    print(f"{'would add' if DRY else 'added'} {added} headshots")


if __name__ == "__main__":
    main()
