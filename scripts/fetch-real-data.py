#!/usr/bin/env python3
"""
Build a REAL dataset for LAXDB from public sources.

  • NCAA D1 men's lacrosse — per-school cumulative statistics + rosters
    (Sidearm-powered athletics sites), 2026 and 2025 seasons.
  • NCAA.com individual stat categories — goalie lines (save %, GAA, saves)
    because school cumulative pages omit the goaltending table.
  • Premier Lacrosse League — public stats API, 2023-2026 seasons + headshots.

Output: src/data/dataset.json  (same schema the app already consumes)

Usage:  python3 scripts/fetch-real-data.py [--no-photos]
"""
import hashlib, json, re, sys, time, unicodedata, urllib.request, urllib.error, os
from datetime import date

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEASONS = ["2026", "2025", "2024", "2023", "2022"]
PHOTOS = "--no-photos" not in sys.argv

# --------------------------------------------------------------------------- #
# Fetch helpers
# --------------------------------------------------------------------------- #
CACHE_DIR = os.path.join(ROOT, "scripts", ".cache")
USE_CACHE = "--refresh" not in sys.argv


def get(url, headers=None, tries=3, timeout=40):
    """Fetch with an on-disk cache so rebuilds don't re-hit 30 schools."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    key = hashlib.sha1(url.encode()).hexdigest()[:20]
    path = os.path.join(CACHE_DIR, key + ".txt")
    if USE_CACHE and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read()
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"}
    if headers:
        h.update(headers)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read().decode("utf-8", "ignore")
            with open(path, "w", encoding="utf-8") as f:
                f.write(body)
            return body
        except Exception as e:
            last = e
            time.sleep(1.2 * (i + 1))
    raise last


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")


def _dedupe(s):
    """'Hunter Chauvette Hunter Chauvette' -> 'Hunter Chauvette' (linked name printed twice)."""
    parts = s.split()
    n = len(parts)
    if n and n % 2 == 0 and parts[: n // 2] == parts[n // 2:]:
        return " ".join(parts[: n // 2])
    return s


def title_name(raw):
    s = (raw or "").replace("\u2019", "'").replace("\xa0", " ").strip()
    if "," in s:
        last, first = [p.strip() for p in s.split(",", 1)]
        # some stat tables print "Last, First, Last, First" (mobile + desktop cells)
        if last.lower() == first.lower():
            s = last
        else:
            s = f"{first} {last}"
    s = _dedupe(re.sub(r"\s+", " ", s)).strip()
    # O'neil -> O'Neil, Van-buren -> Van-Buren
    s = re.sub(r"(['\-])([a-z])", lambda m: m.group(1) + m.group(2).upper(), s)
    return s


def smart_case(raw):
    """'CONNOR O'TOOLE' -> 'Connor O'Toole'; fixes Mc/Mac prefixes too."""
    s = (raw or "").strip()
    if not s:
        return s
    letters = [c for c in s if c.isalpha()]
    if letters and sum(1 for c in letters if c.isupper()) / len(letters) > 0.8:
        s = s.title()
    s = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), s)
    s = re.sub(r"\bMac([a-z])", lambda m: "Mac" + m.group(1).upper(), s)
    s = re.sub(r"(['\-])([a-z])", lambda m: m.group(1) + m.group(2).upper(), s)
    return s


def norm_name(raw):
    """'Johnson, Leo' -> 'leo johnson'; strips suffixes and punctuation."""
    s = title_name(raw)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\.?$", "", s, flags=re.I).strip()
    s = re.sub(r"[^A-Za-z' \-]", " ", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def num(v, cast=float):
    if v is None:
        return 0
    s = str(v).strip().replace(",", "")
    if s in ("", "-", "—", "N/A"):
        return 0
    try:
        return cast(s)
    except ValueError:
        m = re.search(r"-?\d+(\.\d+)?", s)
        return cast(m.group(0)) if m else 0

# --------------------------------------------------------------------------- #
# School registry: name, site, conference, colors
# --------------------------------------------------------------------------- #
SCHOOLS = [
    ("Maryland Terrapins", "umterps.com", "Big Ten", "College Park, MD", "Maryland", "#E03A3E", "#FFD520"),
    ("Syracuse Orange", "cuse.com", "ACC", "Syracuse, NY", "Syracuse", "#F76900", "#000E54"),
    ("Duke Blue Devils", "goduke.com", "ACC", "Durham, NC", "Duke", "#003087", "#FFFFFF"),
    ("Virginia Cavaliers", "virginiasports.com", "ACC", "Charlottesville, VA", "Virginia", "#232D4B", "#E57200"),
    ("Notre Dame Fighting Irish", "und.com", "ACC", "Notre Dame, IN", "Notre Dame", "#0C2340", "#C99700"),
    ("Johns Hopkins Blue Jays", "hopkinssports.com", "Big Ten", "Baltimore, MD", "Johns Hopkins", "#68ACE5", "#002D72"),
    ("Penn State Nittany Lions", "gopsusports.com", "Big Ten", "University Park, PA", "Penn State", "#041E42", "#FFFFFF"),
    ("North Carolina Tar Heels", "goheels.com", "ACC", "Chapel Hill, NC", "North Carolina", "#4B9CD3", "#13294B"),
    ("Yale Bulldogs", "yalebulldogs.com", "Ivy League", "New Haven, CT", "Yale", "#00356B", "#FFFFFF"),
    ("Princeton Tigers", "goprinceton.com", "Ivy League", "Princeton, NJ", "Princeton", "#E77500", "#000000"),
    ("Cornell Big Red", "cornellbigred.com", "Ivy League", "Ithaca, NY", "Cornell", "#B31B1B", "#FFFFFF"),
    ("Denver Pioneers", "denverpioneers.com", "Big East", "Denver, CO", "Denver", "#8B2332", "#C8A951"),
    ("Georgetown Hoyas", "guhoyas.com", "Big East", "Washington, DC", "Georgetown", "#041E42", "#8D817B"),
    ("Rutgers Scarlet Knights", "scarletknights.com", "Big Ten", "Piscataway, NJ", "Rutgers", "#CC0033", "#FFFFFF"),
    ("Ohio State Buckeyes", "ohiostatebuckeyes.com", "Big Ten", "Columbus, OH", "Ohio State", "#BB0000", "#666666"),
    ("Michigan Wolverines", "mgoblue.com", "Big Ten", "Ann Arbor, MI", "Michigan", "#00274C", "#FFCB05"),
    ("Army Black Knights", "goarmywestpoint.com", "Patriot", "West Point, NY", "Army", "#D4BF91", "#000000"),
    ("Navy Midshipmen", "navysports.com", "Patriot", "Annapolis, MD", "Navy", "#00205B", "#C5B783"),
    ("Towson Tigers", "towsontigers.com", "CAA", "Towson, MD", "Towson", "#FFBB00", "#000000"),
    ("Loyola Greyhounds", "loyolagreyhounds.com", "Patriot", "Baltimore, MD", "Loyola", "#006B3F", "#A0A0A0"),
    ("Richmond Spiders", "richmondspiders.com", "Atlantic 10", "Richmond, VA", "Richmond", "#990000", "#004B8D"),
    ("Utah Utes", "utahutes.com", "ASUN", "Salt Lake City, UT", "Utah", "#CC0000", "#FFFFFF"),
    ("Villanova Wildcats", "villanova.com", "Big East", "Villanova, PA", "Villanova", "#00205B", "#13B5EA"),
    ("Penn Quakers", "pennathletics.com", "Ivy League", "Philadelphia, PA", "Penn", "#990000", "#011F5B"),
    ("Harvard Crimson", "goharvardcrimson.com", "Ivy League", "Cambridge, MA", "Harvard", "#A51C30", "#FFFFFF"),
    ("Drexel Dragons", "drexeldragons.com", "CAA", "Philadelphia, PA", "Drexel", "#07294D", "#FFC600"),
    ("Delaware Blue Hens", "bluehens.com", "CAA", "Newark, DE", "Delaware", "#00539F", "#FFD200"),
    ("Hofstra Pride", "gohofstra.com", "CAA", "Hempstead, NY", "Hofstra", "#003591", "#FFC72C"),
    ("Massachusetts Minutemen", "umassathletics.com", "Atlantic 10", "Amherst, MA", "UMass", "#881C1C", "#000000"),
    ("High Point Panthers", "highpointpanthers.com", "Big South", "High Point, NC", "High Point", "#6F2C91", "#FFFFFF"),
]

DENY_NAMES = {
    "player", "players", "total", "totals", "team", "teams", "opponent", "opponents",
    "points", "goals", "assists", "saves", "scoring", "faceoffs", "penalties", "man-up",
    "clearing", "cumulative", "name", "high", "date", "rank",
}

POS_MAP = {
    "A": "A", "ATT": "A", "ATTACK": "A", "A/M": "M", "M": "M", "MID": "M", "MIDFIELD": "M",
    "MF": "M", "DM": "M", "D": "D", "DEF": "D", "DEFENSE": "D", "LSM": "LSM", "G": "G",
    "GK": "G", "GOALIE": "G", "FO": "FO", "FOS": "FO", "FO/M": "FO",
}
POS_NAME = {"A": "Attack", "M": "Midfield", "D": "Defense", "G": "Goalie", "FO": "Faceoff", "LSM": "LSM"}
YEAR_TO_CLASS = {"fr.": 2029, "fr": 2029, "so.": 2028, "so": 2028, "jr.": 2027, "jr": 2027,
                 "sr.": 2026, "sr": 2026, "gr.": 2026, "gr": 2026, "r-fr.": 2029,
                 "r-so.": 2028, "r-jr.": 2027, "r-sr.": 2026, "5th": 2026}

# --------------------------------------------------------------------------- #
# Sidearm HTML parsing
# --------------------------------------------------------------------------- #
def cells(row_html, tag="td"):
    out = []
    for c in re.findall(rf"<{tag}[^>]*>(.*?)</{tag}>", row_html, re.S):
        txt = re.sub(r"<[^>]+>", " ", c)
        txt = (txt.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'")
                  .replace("&quot;", '"'))
        out.append(re.sub(r"\s+", " ", txt).strip())
    return out


def tables(html):
    return re.findall(r"<table[^>]*>(.*?)</table>", html, re.S)


def first_text(cell_html):
    """Text of the first link in a cell, else the whole cell. Avoids the
    mobile+desktop duplicate markup that some stat tables emit."""
    m = re.search(r"<a[^>]*>(.*?)</a>", cell_html, re.S)
    t = m.group(1) if m else cell_html
    t = re.sub(r"<[^>]+>", " ", t)
    t = t.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"')
    return re.sub(r"\s+", " ", t).strip()


def header_index(headers, *names):
    for n in names:
        for i, h in enumerate(headers):
            if h.strip().lower().replace(".", "") == n:
                return i
    for n in names:
        for i, h in enumerate(headers):
            if n in h.strip().lower():
                return i
    return None


def parse_height(v):
    m = re.search(r"(\d)\s*['\-\s]\s*(\d{1,2})", str(v))
    if m:
        return int(m.group(1)) * 12 + int(m.group(2))
    m = re.search(r"(\d{3})", str(v))
    return int(m.group(1)) if m else 0


def parse_stats_page(html):
    """Skater cumulative table -> {name_key: row dict}."""
    out = {}
    for t in tables(html):
        heads = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h)).strip()
                 for h in re.findall(r"<th[^>]*>(.*?)</th>", t, re.S)]
        low = [h.lower() for h in heads]
        if not any("player" in h or h == "name" for h in low):
            continue
        if not any(h in ("g", "goals") for h in low):
            continue
        idx = {
            "player": header_index(heads, "player", "name"),
            "gp_gs": header_index(heads, "gp - gs", "gp-gs", "gp"),
            "g": header_index(heads, "g", "goals"),
            "a": header_index(heads, "a", "ast", "assists"),
            "pts": header_index(heads, "pts", "points"),
            "sh": header_index(heads, "sh", "shots"),
            "sog": header_index(heads, "sog"),
            "gb": header_index(heads, "gb", "ground balls"),
            "to": header_index(heads, "to", "turnovers"),
            "ct": header_index(heads, "ct", "caused turnovers"),
            "fo": header_index(heads, "fo", "faceoffs"),
            "fo_pct": header_index(heads, "fo%", "faceoff pct"),
            "pen": header_index(heads, "pn-pim", "pim"),
        }
        if idx["player"] is None:
            continue
        for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
            c = cells(r)
            if len(c) < 5 or idx["player"] >= len(c):
                continue
            tds = re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)
            name = first_text(tds[idx["player"]]) if idx["player"] < len(tds) else c[idx["player"]]
            if not name or norm_name(name) in DENY_NAMES:
                continue
            if name.isupper() and " " not in name:
                continue
            gs = 0
            gp = 0
            if idx["gp_gs"] is not None:
                raw = c[idx["gp_gs"]] if idx["gp_gs"] < len(c) else ""
                m = re.match(r"(\d+)\s*-\s*(\d+)", raw)
                if m:
                    gp, gs = int(m.group(1)), int(m.group(2))
                else:
                    gp = int(num(raw))
            row = {
                "name": title_name(name),
                "gp": gp, "gs": gs,
                "g": int(num(c[idx["g"]])) if idx["g"] is not None and idx["g"] < len(c) else 0,
                "a": int(num(c[idx["a"]])) if idx["a"] is not None and idx["a"] < len(c) else 0,
                "pts": int(num(c[idx["pts"]])) if idx["pts"] is not None and idx["pts"] < len(c) else 0,
                "sh": int(num(c[idx["sh"]])) if idx["sh"] is not None and idx["sh"] < len(c) else 0,
                "gb": int(num(c[idx["gb"]])) if idx["gb"] is not None and idx["gb"] < len(c) else 0,
                "to": int(num(c[idx["to"]])) if idx["to"] is not None and idx["to"] < len(c) else 0,
                "ct": int(num(c[idx["ct"]])) if idx["ct"] is not None and idx["ct"] < len(c) else 0,
            }
            # faceoffs are published as "won-lost" in one cell
            row["foW"] = row["foA"] = 0
            if idx["fo"] is not None and idx["fo"] < len(c):
                m = re.match(r"(\d+)\s*-\s*(\d+)", c[idx["fo"]])
                if m:
                    row["foW"], lost = int(m.group(1)), int(m.group(2))
                    row["foA"] = row["foW"] + lost
            row["pen"] = 0
            if idx["pen"] is not None and idx["pen"] < len(c):
                m = re.search(r"(\d+):(\d{2})", c[idx["pen"]])
                if m:
                    row["pen"] = int(m.group(1)) * 60 + int(m.group(2))
            if not row["pts"]:
                row["pts"] = row["g"] + row["a"]
            out[norm_name(row["name"])] = row
    return out


def parse_roster_page(html):
    """Roster table -> {name_key: bio dict}."""
    out = {}
    for t in tables(html):
        heads = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h)).strip()
                 for h in re.findall(r"<th[^>]*>(.*?)</th>", t, re.S)]
        low = [h.lower() for h in heads]
        if not any("pos" in h for h in low) or not any("name" in h for h in low):
            continue
        idx = {
            "num": header_index(heads, "#", "no", "number"),
            "name": header_index(heads, "full name", "name", "player"),
            "pos": header_index(heads, "pos", "position"),
            "ht": header_index(heads, "ht", "height"),
            "wt": header_index(heads, "wt", "weight"),
            "year": header_index(heads, "year", "class", "yr"),
            "home": header_index(heads, "hometown", "hometown / high school"),
        }
        for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
            c = cells(r)
            if idx["name"] is None or idx["name"] >= len(c):
                continue
            tds = re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)
            name = first_text(tds[idx["name"]]) if idx["name"] < len(tds) else c[idx["name"]]
            if not name or name.lower() in ("full name", "name", "player"):
                continue
            home = c[idx["home"]] if idx["home"] is not None and idx["home"] < len(c) else ""
            city, state, hs = "", "", ""
            if home:
                parts = [p.strip() for p in home.split("/")]
                loc = parts[0]
                hs = parts[1] if len(parts) > 1 else ""
                if "," in loc:
                    city, state = [p.strip() for p in loc.rsplit(",", 1)]
                else:
                    city = loc
            pos_raw = c[idx["pos"]] if idx["pos"] is not None and idx["pos"] < len(c) else ""
            pos = POS_MAP.get(pos_raw.upper().strip(), "M")
            yr = (c[idx["year"]] if idx["year"] is not None and idx["year"] < len(c) else "").lower().strip()
            out[norm_name(name)] = {
                "name": title_name(name),
                "position": pos,
                "heightIn": parse_height(c[idx["ht"]]) if idx["ht"] is not None and idx["ht"] < len(c) else 0,
                "weightLb": int(num(c[idx["wt"]])) if idx["wt"] is not None and idx["wt"] < len(c) else 0,
                "classYear": YEAR_TO_CLASS.get(yr),
                "city": city, "state": state, "hs": hs,
                "jersey": int(num(c[idx["num"]])) if idx["num"] is not None and idx["num"] < len(c) else 0,
            }
    return out

# --------------------------------------------------------------------------- #
# NCAA.com goalie categories
# --------------------------------------------------------------------------- #
NCAA_CATS = {"svp": 224, "gaa": 225, "saves": 586}


def fetch_ncaa_goalies():
    rows = {}
    for key, cid in NCAA_CATS.items():
        try:
            html = get(f"https://www.ncaa.com/stats/lacrosse-men/d1/current/individual/{cid}")
        except Exception as e:
            print(f"  ! NCAA {key} failed: {e}")
            continue
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
            c = cells(tr)
            if len(c) < 8 or not c[0].strip().isdigit():
                continue
            name, team = c[1].strip(), c[2].strip()
            k = (norm_name(name), team.lower())
            r = rows.setdefault(k, {"name": title_name(name), "team": team, "gp": int(num(c[5]))})
            if key == "svp":
                r.update(min_played=int(num(c[6])), ga=int(num(c[8])), sv=int(num(c[9])),
                         svp=num(c[10].replace(".", "")) if "." in c[10] else num(c[10]))
            elif key == "gaa":
                r.update(min_played=int(num(c[6])), ga=int(num(c[8])), gaa=num(c[9]))
            else:
                r.update(saves=int(num(c[6])))
        time.sleep(0.4)
    return rows


def match_goalies(goalies, players):
    """Attach NCAA goalie lines to roster players by normalized name."""
    by_name = {}
    for p in players:
        by_name.setdefault(norm_name(p["name"]), []).append(p)
    matched = 0
    for (nk, team), g in goalies.items():
        cands = by_name.get(nk, [])
        if not cands:
            continue
        p = cands[0]
        cur = next((s for s in p["seasons"] if s["season"] == "2026"), None)
        if not cur:
            continue
        cur.update(min=g.get("min_played", 0), ga=g.get("ga", 0), sv=g.get("sv", g.get("saves", 0)), w=0, l=0)
        if not cur["gp"]:
            cur["gp"] = g.get("gp", 0)
        p["position"] = "G"
        p["positionName"] = "Goalie"
        matched += 1
    return matched

# --------------------------------------------------------------------------- #
# Build college dataset
# --------------------------------------------------------------------------- #
def build_college():
    leagues, teams, players = [], [], []
    league = {
        "id": "ncaa-d1", "name": "NCAA Division I", "short": "D1", "level": "College",
        "type": "field", "country": "USA", "tier": 1, "strength": 1.0,
    }
    leagues.append(league)

    for name, site, conf, city, short, c1, c2 in SCHOOLS:
        slug = slugify(name)
        tid = f"t-{slug}"
        team = {
            "id": tid, "name": name, "shortName": short, "slug": slug,
            "leagueId": "ncaa-d1", "city": city, "cityName": city.rsplit(",", 1)[0],
            "region": city.rsplit(",", 1)[-1].strip(),
            "conference": conf, "colors": [c1, c2],
        }
        stats_by_season = {}
        roster = {}
        ok = False
        for season in SEASONS:
            try:
                sh = get(f"https://{site}/sports/mens-lacrosse/stats/{season}")
                st = parse_stats_page(sh)
                if st:
                    stats_by_season[season] = st
                    ok = True
            except Exception as e:
                print(f"  ! {name} stats {season}: {e}")
            time.sleep(0.35)
        try:
            rh = get(f"https://{site}/sports/mens-lacrosse/roster/{SEASONS[0]}")
            roster = parse_roster_page(rh)
        except Exception as e:
            print(f"  ! {name} roster: {e}")
        time.sleep(0.35)

        if not ok:
            print(f"  x {name}: no stats table, skipped")
            continue

        cur = stats_by_season.get(SEASONS[0], {})
        players_here = []
        all_names = set(cur) | set(roster)
        for nk in all_names:
            bio = roster.get(nk, {})
            s0 = cur.get(nk)
            if not s0 and not bio:
                continue
            # skip roster-only players who never recorded a stat line (deep bench / redshirts)
            if not s0 and bio and bio.get("position") != "G":
                continue
            pending_goalie = bool(not s0 and bio and bio.get("position") == "G")
            name_disp = (s0 or bio)["name"]
            pid = f"p-ncaa-{slugify(name_disp)}-{slug[:10]}"
            seasons = {}
            for season in SEASONS:
                row = stats_by_season.get(season, {}).get(nk)
                if not row:
                    continue
                seasons[season] = {
                    "season": season, "teamId": tid, "leagueId": "ncaa-d1", "type": "regular",
                    "gp": row["gp"], "gs": row["gs"], "g": row["g"], "a": row["a"],
                    "pts": row["pts"], "sh": row["sh"], "gb": row["gb"], "to": row["to"],
                    "ct": row["ct"], "foW": row.get("foW", 0), "foA": row.get("foA", 0),
                    "pen": row.get("pen", 0), "min": 0, "ga": 0, "sv": 0, "w": 0, "l": 0,
                }
            if not seasons and pending_goalie:
                # goalie line arrives from NCAA.com; keep the player so it can attach
                seasons[SEASONS[0]] = {
                    "season": SEASONS[0], "teamId": tid, "leagueId": "ncaa-d1", "type": "regular",
                    "gp": 0, "gs": 0, "g": 0, "a": 0, "pts": 0, "sh": 0, "gb": 0, "to": 0,
                    "ct": 0, "foW": 0, "foA": 0, "pen": 0, "min": 0, "ga": 0, "sv": 0, "w": 0, "l": 0,
                }
            home = f"{bio.get('city','')}, {bio.get('state','')}".strip(", ") if bio else ""
            players_here.append({
                "id": pid, "slug": slugify(name_disp),
                "firstName": name_disp.split(" ")[0], "lastName": " ".join(name_disp.split(" ")[1:]),
                "name": name_disp,
                "position": bio.get("position", "M"),
                "positionName": POS_NAME.get(bio.get("position", "M"), "Midfield"),
                "hand": "",
                "heightIn": bio.get("heightIn", 0), "weightLb": bio.get("weightLb", 0),
                "dob": "",
                "birthplace": {"city": bio.get("city", ""), "state": bio.get("state", ""), "country": "USA"},
                "classYear": bio.get("classYear"),
                "gradYear": bio.get("classYear") or 2026,
                "highSchool": bio.get("hs", ""),
                "teamId": tid, "leagueId": "ncaa-d1", "jersey": bio.get("jersey", 0),
                "status": "Active",
                "commit": None, "draft": None, "rankings": [], "awards": [],
                "scouting": {"report": "", "author": "", "date": "", "grades": {}},
                "bio": "", "strengths": [],
                "seasons": [seasons[k] for k in sorted(seasons)],
                "games": [],
                "pendingGoalie": pending_goalie,
            })

        if players_here:
            teams.append(team)
            players.extend(players_here)
            print(f"  + {name}: {len(players_here)} players, {len(cur)} stat lines")

    return leagues, teams, players

# --------------------------------------------------------------------------- #
# PLL
# --------------------------------------------------------------------------- #
PLL_TEAM_COLORS = {
    "archers": ("#00A3AD", "#000000"), "whipsnakes": ("#1D2A57", "#C8A951"),
    "redwoods": ("#1B5E20", "#C8A951"), "waterdogs": ("#0A3D62", "#F5C518"),
    "atlas": ("#00205B", "#E63946"), "outlaws": ("#111111", "#F47B20"),
    "cannons": ("#012169", "#C8102E"), "chaos": ("#7A1FA2", "#000000"),
    "bulls": ("#C8102E", "#000000"), "chrome": ("#00573F", "#C8A951"),
}

PLL_HEADERS = {
    "accept": "application/json",
    "referer": "https://stats.premierlacrosseleague.com/players",
    "origin": "https://stats.premierlacrosseleague.com",
}


def fetch_pll_years(years):
    by_id = {}
    teams = {}
    for year in years:
        url = f"https://stats.premierlacrosseleague.com/api/v4/players/season-stats?year={year}&seasonSegment=regular"
        try:
            data = json.loads(get(url, PLL_HEADERS))["data"]["items"]
        except Exception as e:
            print(f"  ! PLL {year}: {e}")
            continue
        print(f"  + PLL {year}: {len(data)} players")
        for it in data:
            oid = it["officialId"]
            t = it["team"]
            ts = slugify(t.get("fullName") or t.get("officialId") or "team")
            if ts in ("player-pool", "playerpool"):
                continue
            tid = f"t-pll-{ts}"
            if tid not in teams:
                colors = PLL_TEAM_COLORS.get(ts, ("#1D1D1F", "#C8A951"))
                teams[tid] = {
                    "id": tid, "name": f"{(t.get('location') or '').strip()} {t['fullName']}".strip(), "shortName": t["fullName"],
                    "slug": f"pll-{ts}", "leagueId": "pll", "city": f"{t['location']}, USA",
                    "cityName": t["location"], "region": "", "conference": "PLL",
                    "colors": list(colors),
                }
            p = by_id.setdefault(oid, {
                "id": f"p-pll-{oid}", "slug": it["slug"], "firstName": it["firstName"],
                "lastName": it["lastName"], "name": f"{it['firstName']} {it['lastName']}",
                "position": it["position"] if it["position"] in POS_NAME else "M",
                "positionName": it["positionName"], "hand": "",
                "heightIn": 0, "weightLb": 0, "dob": "", "birthplace": {"city": "", "state": "", "country": "USA"},
                "classYear": None, "gradYear": 2026, "highSchool": "",
                "teamId": tid, "leagueId": "pll", "jersey": it.get("jerseyNum", 0),
                "status": "Active", "commit": None, "draft": None,
                "rankings": [], "awards": [],
                "scouting": {"report": "", "author": "", "date": "", "grades": {}},
                "bio": "", "strengths": [],
                "seasons": [], "games": [],
                "photo": it.get("profileUrl", ""),
                "experience": it.get("experience", 0),
            })
            # newest season wins for team identity
            if year == str(max(int(y) for y in years)):
                p["teamId"] = tid
            st = it.get("stats", {})
            if int(st.get("gamesPlayed", 0)) <= 0:
                continue
            ga = int(st.get("goalsAgainst", 0))
            gaa = float(st.get("GAA") or 0)
            minutes = int(round(ga * 60 / gaa)) if (ga and gaa) else int(round((st.get("tof") or 0) / 60))
            p["seasons"].append({
                "season": str(year), "teamId": tid, "leagueId": "pll", "type": "regular",
                "gp": int(st.get("gamesPlayed", 0)), "gs": int(st.get("gamesPlayed", 0)),
                "g": int(st.get("goals", 0)), "a": int(st.get("assists", 0)),
                "pts": int(st.get("points", 0)), "sh": int(st.get("shots", 0)),
                "gb": int(st.get("groundBalls", 0)), "to": int(st.get("turnovers", 0)),
                "ct": int(st.get("causedTurnovers", 0)),
                "foW": int(st.get("faceoffsWon", 0)), "foA": int(st.get("faceoffs", 0)),
                "pen": int(st.get("numPenalties", 0)),
                "min": minutes, "ga": ga, "sv": int(st.get("saves", 0)),
                "w": int(st.get("goalieWins", 0)), "l": int(st.get("goalieLosses", 0)),
            })
    for p in by_id.values():
        p["seasons"].sort(key=lambda s: s["season"])
        if p["seasons"]:
            p["teamId"] = p["seasons"][-1]["teamId"]
        else:
            p["teamId"] = ""
    return teams, list(by_id.values())


# --------------------------------------------------------------------------- #
# MCLA — college club lacrosse (mcla.us), full roster stats per team
# --------------------------------------------------------------------------- #
MCLA_EL = {"fr": 2029, "fr.": 2029, "so": 2028, "so.": 2028, "jr": 2027, "jr.": 2027,
           "sr": 2026, "sr.": 2026, "gr": 2026, "gr.": 2026, "5th": 2026}

MCLA_PALETTE = [
    ("#0B3D91", "#C8A951"), ("#7A0019", "#F2A900"), ("#00573F", "#FFFFFF"),
    ("#1D2A57", "#5AC8FA"), ("#6F2C91", "#FFC72C"), ("#8B2332", "#C5B783"),
    ("#00274C", "#FFCB05"), ("#041E42", "#E03A3E"), ("#00356B", "#7AB800"),
    ("#A6192E", "#111111"), ("#004B23", "#F2A900"), ("#0C2340", "#00A3AD"),
]


def mcla_colors(name):
    h = sum(ord(c) * (i + 7) for i, c in enumerate(name))
    return MCLA_PALETTE[h % len(MCLA_PALETTE)]


def parse_mcla_teams(html):
    """[(conference, slug, year)] from the MCLA teams directory."""
    out, seen = [], set()
    for tb in tables(html):
        heads = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip()
                 for x in re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S)]
        conf = heads[0] if heads else "MCLA"
        for slug, year in re.findall(r'href="/teams/([a-z0-9\-]+)/(\d{4})"', tb):
            key = (slug, year)
            if key in seen:
                continue
            seen.add(key)
            out.append((conf, slug, year))
    return out


def find_col(heads, *names):
    for n in names:
        for i, h in enumerate(heads):
            if h.lower().strip() == n:
                return i
    return None


def parse_mcla_stats(html, tid):
    """Skater and goalie tables -> list of stat rows."""
    rows = []
    for tb in tables(html):
        heads = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip()
                 for x in re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S)]
        low = [h.lower() for h in heads]
        if "player" not in low:
            continue
        is_goal = "ga" in low and "s" in low
        idx = {k: find_col(heads, k) for k in
               ("#", "player", "el", "gp", "g", "a", "po", "sh", "gb", "pn", "cto", "ga", "s", "s%", "fo-w", "fo-l")}
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
            c = cells(tr)
            if idx["player"] is None or idx["player"] >= len(c):
                continue
            name = c[idx["player"]].strip()
            if not name or norm_name(name) in DENY_NAMES:
                continue
            # MCLA prints the position as a prefix inside the player cell ("LSM Colton Storfer")
            pos_hint = None
            toks = name.split()
            if len(toks) > 1 and toks[0].upper().rstrip(".") in POS_MAP:
                pos_hint = POS_MAP[toks[0].upper().rstrip(".")]
                name = " ".join(toks[1:])
            el = (c[idx["el"]].lower().strip() if idx["el"] is not None and idx["el"] < len(c) else "")
            row = {
                "name": title_name(name),
                "jersey": int(num(c[idx["#"]])) if idx["#"] is not None and idx["#"] < len(c) else 0,
                "classYear": MCLA_EL.get(el),
                "gp": int(num(c[idx["gp"]])) if idx["gp"] is not None and idx["gp"] < len(c) else 0,
                "g": int(num(c[idx["g"]])) if idx["g"] is not None and idx["g"] < len(c) else 0,
                "a": int(num(c[idx["a"]])) if idx["a"] is not None and idx["a"] < len(c) else 0,
                "gb": int(num(c[idx["gb"]])) if idx["gb"] is not None and idx["gb"] < len(c) else 0,
                "ct": int(num(c[idx["cto"]])) if idx["cto"] is not None and idx["cto"] < len(c) else 0,
                "pen": int(num(c[idx["pn"]])) if idx["pn"] is not None and idx["pn"] < len(c) else 0,
                "sh": int(num(c[idx["sh"]])) if idx["sh"] is not None and idx["sh"] < len(c) else 0,
                "foW": int(num(c[idx["fo-w"]])) if idx["fo-w"] is not None and idx["fo-w"] < len(c) else 0,
                "foA": 0,
            }
            if idx["fo-l"] is not None and idx["fo-l"] < len(c):
                row["foA"] = row["foW"] + int(num(c[idx["fo-l"]]))
            if is_goal:
                row["position"] = "G"
                row["ga"] = int(num(c[idx["ga"]])) if idx["ga"] is not None and idx["ga"] < len(c) else 0
                row["sv"] = int(num(c[idx["s"]])) if idx["s"] is not None and idx["s"] < len(c) else 0
                row["min"] = 0
                row["to"] = 0
            else:
                row["position"] = pos_hint or "F"
                row["ga"] = row["sv"] = row["min"] = row["to"] = 0
            row["pts"] = row["g"] + row["a"]
            rows.append(row)
    return rows


def build_mcla(seasons=("2026", "2025")):
    index = get("https://mcla.us/teams")
    teams_list = parse_mcla_teams(index)
    print(f"  MCLA teams listed: {len(teams_list)}")
    leagues = [{
        "id": "mcla", "name": "MCLA", "short": "MCLA", "level": "College Club",
        "type": "field", "country": "USA", "tier": 3, "strength": 0.8,
    }]
    teams, players = [], []
    by_team = {}
    for conf, slug, year in teams_list:
        tid = f"t-mcla-{slug}"
        stats = {}
        pretty = slug.replace("-", " ").title()
        for season in seasons:
            try:
                h = get(f"https://mcla.us/teams/{slug}/{season}/stats")
                rows = parse_mcla_stats(h, tid)
                if rows:
                    stats[season] = rows
                m = re.search(r"<title>\d{4} Stats \| ([^|<]+)\|", h)
                if m:
                    pretty = m.group(1).strip()
            except Exception:
                pass
            time.sleep(0.15)
        if not stats:
            continue
        team = {
            "id": tid, "name": pretty, "shortName": " ".join(pretty.split(" ")[:-1]) or pretty,
            "slug": f"mcla-{slug}",
            "leagueId": "mcla", "city": "", "cityName": "", "region": "",
            "conference": conf, "colors": list(mcla_colors(pretty)),
        }
        teams.append(team)
        # merge seasons by player name
        merged = {}
        for season, rows in stats.items():
            for row in rows:
                key = norm_name(row["name"])
                p = merged.setdefault(key, {
                    "name": row["name"], "jersey": row["jersey"], "classYear": row["classYear"],
                    "position": row["position"], "seasons": [],
                })
                if row["classYear"] and not p["classYear"]:
                    p["classYear"] = row["classYear"]
                if row["position"] == "G":
                    p["position"] = "G"
                p["seasons"].append({
                    "season": season, "teamId": tid, "leagueId": "mcla", "type": "regular",
                    "gp": row["gp"], "gs": row["gp"] if row["position"] == "G" else row["gp"],
                    "g": row["g"], "a": row["a"], "pts": row["pts"], "sh": row["sh"],
                    "gb": row["gb"], "to": row["to"], "ct": row["ct"],
                    "foW": row["foW"], "foA": row["foA"], "pen": row["pen"],
                    "min": row["min"], "ga": row["ga"], "sv": row["sv"], "w": 0, "l": 0,
                })
        for key, p in merged.items():
            pos = p["position"]
            pid = f"p-mcla-{slugify(p['name'])}-{slug[:10]}"
            players.append({
                "id": pid, "slug": slugify(p["name"]), "firstName": p["name"].split(" ")[0],
                "lastName": " ".join(p["name"].split(" ")[1:]), "name": p["name"],
                "position": pos,
                "positionName": {"G": "Goalie", "F": "Field player"}.get(pos, POS_NAME.get(pos, "Field player")),
                "hand": "", "heightIn": 0, "weightLb": 0, "dob": "",
                "birthplace": {"city": "", "state": "", "country": "USA"},
                "classYear": p["classYear"], "gradYear": p["classYear"] or 2026,
                "highSchool": "", "teamId": tid, "leagueId": "mcla",
                "jersey": p["jersey"], "status": "Active",
                "commit": None, "draft": None, "rankings": [], "awards": [],
                "scouting": {"report": "", "author": "", "date": "", "grades": {}},
                "bio": "", "strengths": [],
                "seasons": sorted(p["seasons"], key=lambda s: s["season"]),
                "games": [],
            })
    print(f"  MCLA: {len(teams)} teams, {len(players)} players")
    return leagues, teams, players



# --------------------------------------------------------------------------- #
# Canadian box lacrosse pyramid (stats.netfrontsports.com)
# Jr A / Jr B / Jr B tiers / Jr C / Senior A / Senior B / NLL — server-rendered
# --------------------------------------------------------------------------- #
NETFRONT_LEAGUES = [
    # (slug, display name, short, level, tier)
    ("nll", "National Lacrosse League", "NLL", "Professional", 1),
    ("msl", "Major Series Lacrosse", "MSL", "Senior A", 1),
    ("wla", "Western Lacrosse Association", "WLA", "Senior A", 1),
    ("osl", "Ontario Series Lacrosse", "OSL", "Senior B", 2),
    ("wcsla", "West Coast Senior Lacrosse Association", "WCSLA", "Senior B", 2),
    ("rmll-senior-b", "RMLL Senior B", "RMLL Sr B", "Senior B", 2),
    ("bcjall", "BC Junior A Lacrosse League", "BCJALL", "Junior A", 1),
    ("ojll", "Ontario Junior Lacrosse League", "OJLL", "Junior A", 1),
    ("rmll-junior-a", "RMLL Junior A", "RMLL Jr A", "Junior A", 1),
    ("ojbll", "Ontario Junior B Lacrosse League", "OJBLL", "Junior B", 2),
    ("pnwjll", "Pacific Northwest Junior Lacrosse League", "PNWJLL", "Junior B", 2),
    ("tojll", "Tier II Ontario Junior Lacrosse League", "TOJLL", "Junior B", 2),
    ("wcjll", "West Coast Junior Lacrosse League", "WCJLL", "Junior B", 2),
    ("rmll-junior-b-tier-1", "RMLL Junior B Tier I", "RMLL Jr B T1", "Junior B", 2),
    ("rmll-junior-b-tier-2", "RMLL Junior B Tier II", "RMLL Jr B T2", "Junior C", 3),
    ("ojcll", "Ontario Junior C Lacrosse League", "OJCL", "Junior C", 3),
]

NETFRONT_MIN_SEASON = 2021
NETFRONT_BASE = "https://stats.netfrontsports.com"

LEVEL_STRENGTH = {
    "Professional": 1.2, "Senior A": 1.05, "Senior B": 0.92,
    "Junior A": 0.9, "Junior B": 0.8, "Junior C": 0.7,
}


def parse_netfront_team(html):
    """-> (skater season rows, goalie season rows) from a NetFront team page."""
    skaters, goalies = [], []
    for tb in tables(html):
        heads = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip()
                 for x in re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S)]
        low = [h.lower() for h in heads]
        if not ("season" in low and "phase" in low):
            continue
        is_goal = "goalie" in low
        idx = {
            "season": find_col(heads, "season"), "phase": find_col(heads, "phase"),
            "name": find_col(heads, "player", "goalie"),
            "gp": find_col(heads, "gp"), "g": find_col(heads, "g"), "a": find_col(heads, "a"),
            "pts": find_col(heads, "pts"), "pim": find_col(heads, "pim"),
            "w": find_col(heads, "w"), "l": find_col(heads, "l"),
            "gaa": find_col(heads, "gaa"), "svp": find_col(heads, "sv%", "sv pct"),
            "so": find_col(heads, "so"),
        }
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
            c = cells(tr)
            if idx["name"] is None or idx["name"] >= len(c):
                continue
            name = c[idx["name"]].strip()
            if not name or norm_name(name) in DENY_NAMES:
                continue
            try:
                season = int(str(c[idx["season"]]).strip()[:4])
            except Exception:
                continue
            if season < NETFRONT_MIN_SEASON:
                continue
            if "post" in c[idx["phase"]].lower() or "playoff" in c[idx["phase"]].lower():
                continue
            row = {"season": str(season), "name": smart_case(title_name(name)),
                   "gp": int(num(c[idx["gp"]])) if idx["gp"] is not None and idx["gp"] < len(c) else 0}
            if is_goal:
                row.update(
                    w=int(num(c[idx["w"]])) if idx["w"] is not None and idx["w"] < len(c) else 0,
                    l=int(num(c[idx["l"]])) if idx["l"] is not None and idx["l"] < len(c) else 0,
                    gaa=num(c[idx["gaa"]]) if idx["gaa"] is not None and idx["gaa"] < len(c) else 0,
                    svp=(num(c[idx["svp"]]) / 100 if idx["svp"] is not None and idx["svp"] < len(c) and num(c[idx["svp"]]) > 1
                         else (num(c[idx["svp"]]) if idx["svp"] is not None and idx["svp"] < len(c) else 0)),
                )
                goalies.append(row)
            else:
                row.update(
                    g=int(num(c[idx["g"]])) if idx["g"] is not None and idx["g"] < len(c) else 0,
                    a=int(num(c[idx["a"]])) if idx["a"] is not None and idx["a"] < len(c) else 0,
                    pts=int(num(c[idx["pts"]])) if idx["pts"] is not None and idx["pts"] < len(c) else 0,
                    pim=int(num(c[idx["pim"]])) if idx["pim"] is not None and idx["pim"] < len(c) else 0,
                )
                row["pts"] = row["pts"] or row["g"] + row["a"]
                skaters.append(row)
    return skaters, goalies


def build_netfront():
    leagues, teams, players = [], [], []
    for slug, name, short, level, tier in NETFRONT_LEAGUES:
        lid = f"nf-{slug}"
        try:
            h = get(f"{NETFRONT_BASE}/league/{slug}/")
        except Exception as e:
            print(f"  ! {short}: league page {e}")
            continue
        team_links = sorted(set(re.findall(r'href="(https://stats\.netfrontsports\.com/team/[^"]+)"', h)))
        if not team_links:
            print(f"  x {short}: no teams")
            continue
        leagues.append({
            "id": lid, "name": name, "short": short, "level": level, "type": "box",
            "country": "CAN" if slug != "nll" else "USA/CAN", "tier": tier,
            "strength": LEVEL_STRENGTH.get(level, 0.8),
        })
        n_players = 0
        for link in team_links:
            tslug = link.rstrip("/").split("/")[-1]
            tid = f"t-{tslug}"
            try:
                th = get(link)
            except Exception:
                continue
            skaters, goalies = parse_netfront_team(th)
            if not skaters and not goalies:
                continue
            m = re.search(r"<title>([^<|]+)", th)
            pretty = (m.group(1).strip() if m else tslug.replace("-", " ").title())
            pretty = re.sub(r"\s+Lacrosse Stats.*$", "", pretty).strip()
            teams.append({
                "id": tid, "name": pretty, "shortName": pretty, "slug": tslug,
                "leagueId": lid, "city": "", "cityName": "", "region": "",
                "conference": name, "colors": list(mcla_colors(pretty)),
            })
            merged = {}
            for row in skaters:
                p = merged.setdefault((norm_name(row["name"]), "F"), {"name": row["name"], "position": "F", "seasons": []})
                p["seasons"].append({
                    "season": row["season"], "teamId": tid, "leagueId": lid, "type": "regular",
                    "gp": row["gp"], "gs": row["gp"], "g": row["g"], "a": row["a"], "pts": row["pts"],
                    "sh": 0, "gb": 0, "to": 0, "ct": 0, "foW": 0, "foA": 0, "pen": row["pim"],
                    "min": 0, "ga": 0, "sv": 0, "w": 0, "l": 0,
                })
            for row in goalies:
                p = merged.setdefault((norm_name(row["name"]), "G"), {"name": row["name"], "position": "G", "seasons": []})
                p["position"] = "G"
                p["seasons"].append({
                    "season": row["season"], "teamId": tid, "leagueId": lid, "type": "regular",
                    "gp": row["gp"], "gs": row["gp"], "g": 0, "a": 0, "pts": 0,
                    "sh": 0, "gb": 0, "to": 0, "ct": 0, "foW": 0, "foA": 0, "pen": 0,
                    "min": 0, "ga": 0, "sv": 0, "w": row["w"], "l": row["l"],
                    "gaa": row["gaa"] or None, "svp": row["svp"] or None,
                })
            for key, p in merged.items():
                pid = f"p-nf-{tslug}-{slugify(p['name'])}"
                players.append({
                    "id": pid, "slug": slugify(p["name"]), "firstName": p["name"].split(" ")[0],
                    "lastName": " ".join(p["name"].split(" ")[1:]), "name": p["name"],
                    "position": p["position"],
                    "positionName": "Goalie" if p["position"] == "G" else "Runner",
                    "hand": "", "heightIn": 0, "weightLb": 0, "dob": "",
                    "birthplace": {"city": "", "state": "", "country": "CAN"},
                    "classYear": None, "gradYear": 2026, "highSchool": "",
                    "teamId": tid, "leagueId": lid, "jersey": 0, "status": "Active",
                    "commit": None, "draft": None, "rankings": [], "awards": [],
                    "scouting": {"report": "", "author": "", "date": "", "grades": {}},
                    "bio": "", "strengths": [],
                    "seasons": sorted(p["seasons"], key=lambda s: s["season"]),
                    "games": [],
                })
                n_players += 1
        print(f"  + {short:14s} {len(team_links):3d} teams, {n_players:5d} players")
    return leagues, teams, players


# --------------------------------------------------------------------------- #
# Photos
# --------------------------------------------------------------------------- #
def download_photos(players):
    dest = os.path.join(ROOT, "public", "players", "pll")
    os.makedirs(dest, exist_ok=True)
    saved = 0
    try:
        from PIL import Image
        have_pil = True
    except ImportError:
        have_pil = False
    for p in players:
        url = p.get("photo") or ""
        if not url:
            continue
        path = os.path.join(dest, f"{p['slug']}.webp")
        if os.path.exists(path):
            p["photo"] = f"./players/pll/{p['slug']}.webp"
            saved += 1
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://premierlacrosseleague.com/"})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
            tmp = path + ".raw"
            with open(tmp, "wb") as f:
                f.write(raw)
            if have_pil:
                im = Image.open(tmp).convert("RGB")
                im.thumbnail((320, 320))
                im.save(path, "WEBP", quality=82, method=4)
                os.remove(tmp)
            else:
                os.replace(tmp, path)
            p["photo"] = f"./players/pll/{p['slug']}.webp"
            saved += 1
        except Exception:
            p["photo"] = ""
        time.sleep(0.05)
    print(f"  + photos: {saved}")
    return saved

# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    print("College (NCAA D1)…")
    leagues, teams, players = build_college()

    print("Goalie lines (NCAA.com)…")
    goalies = fetch_ncaa_goalies()
    matched = match_goalies(goalies, players)
    print(f"  + goalies matched: {matched} of {len(goalies)}")

    print("MCLA…")
    mcla_leagues, mcla_teams, mcla_players = build_mcla()
    leagues.extend(mcla_leagues)
    teams.extend(mcla_teams)
    players.extend(mcla_players)

    print("Box lacrosse pyramid (NetFront)…")
    nf_leagues, nf_teams, nf_players = build_netfront()
    leagues.extend(nf_leagues)
    teams.extend(nf_teams)
    players.extend(nf_players)

    print("PLL…")
    pll_teams, pll_players = fetch_pll_years([2021, 2022, 2023, 2024, 2025, 2026])
    if pll_players and PHOTOS:
        download_photos(pll_players)
    leagues.append({
        "id": "pll", "name": "Premier Lacrosse League", "short": "PLL", "level": "Professional",
        "type": "field", "country": "USA", "tier": 1, "strength": 1.24,
    })
    teams.extend(pll_teams.values())
    players.extend([p for p in pll_players if p["seasons"] and p["teamId"]])

    # collapse players with no seasons at all
    players = [p for p in players if p["seasons"]]
    players = [
        p for p in players
        if not p.pop("pendingGoalie", False)
        or any(s["gp"] > 0 or s["sv"] > 0 for s in p["seasons"])
    ]

    # team city/region cleanup for colleges
    for t in teams:
        if t["leagueId"] == "ncaa-d1" and ("," in t["city"]):
            city, _, region = t["city"].partition(",")
            t["cityName"], t["region"] = city.strip(), region.strip()

    used_teams = {p["teamId"] for p in players}
    teams = [t for t in teams if t["id"] in used_teams]
    teams.sort(key=lambda t: (t["leagueId"], t["name"]))
    players.sort(key=lambda p: (p["leagueId"], p["name"]))

    # make profile URLs unique across schools / leagues
    seen = {}
    for p in players:
        base = p["slug"] or slugify(p["name"])
        slug, n = base, 1
        while slug in seen:
            n += 1
            slug = f"{base}-{n}"
        seen[slug] = 1
        p["slug"] = slug

    dataset = {
        "meta": {
            "generated": date.today().isoformat(),
            "dataset": "Real data — NCAA Division I, MCLA, PLL, and the Canadian box pyramid (Jr A to Sr A, NLL)",
            "season": "2026",
            "sources": [
                "NCAA.com individual statistics (goaltending)",
                "School athletics cumulative statistics and rosters (Sidearm)",
                "Premier Lacrosse League stats API",
                "MCLA team statistics (mcla.us)",
                "Canadian box leagues incl. Jr A/B/C, Senior A/B and the NLL (stats.netfrontsports.com)",
            ],
        },
        "leagues": leagues,
        "teams": teams,
        "players": players,
    }
    out = os.path.join(ROOT, "public", "data.json")
    with open(out, "w") as f:
        json.dump(dataset, f, separators=(",", ":"))
    size = os.path.getsize(out) / 1024
    print(f"\nwrote {out}: {len(players)} players, {len(teams)} teams, {len(leagues)} leagues, {size:.0f} KB")
    from collections import Counter
    print("by league:", Counter(p["leagueId"] for p in players))
    print("seasons:", sum(len(p["seasons"]) for p in players))


if __name__ == "__main__":
    main()
