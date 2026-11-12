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
import hashlib, html as _html, json, re, sys, time, unicodedata, urllib.request, urllib.error, os
from datetime import date, timedelta

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
    ("Notre Dame Fighting Irish", "fightingirish.com", "ACC", "Notre Dame, IN", "Notre Dame", "#0C2340", "#C99700"),
    ("Johns Hopkins Blue Jays", "hopkinssports.com", "Big Ten", "Baltimore, MD", "Johns Hopkins", "#68ACE5", "#002D72"),
    ("Penn State Nittany Lions", "gopsusports.com", "Big Ten", "University Park, PA", "Penn State", "#041E42", "#FFFFFF"),
    ("North Carolina Tar Heels", "goheels.com", "ACC", "Chapel Hill, NC", "North Carolina", "#4B9CD3", "#13294B"),
    ("Yale Bulldogs", "yalebulldogs.com", "Ivy League", "New Haven, CT", "Yale", "#00356B", "#FFFFFF"),
    ("Princeton Tigers", "goprincetontigers.com", "Ivy League", "Princeton, NJ", "Princeton", "#E77500", "#000000"),
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
    ("Air Force Falcons", "goairforcefalcons.com", "ASUN", "USAF Academy, CO", "Air Force", "#003087", "#B1B3B3"),
    ("Albany Great Danes", "ualbanysports.com", "America East", "Albany, NY", "Albany", "#46166B", "#FFC72C"),
    ("Bellarmine Knights", "athletics.bellarmine.edu", "ASUN", "Louisville, KY", "Bellarmine", "#00205B", "#B31942"),
    ("Binghamton Bearcats", "binghamtonbearcats.com", "America East", "Vestal, NY", "Binghamton", "#005A43", "#FFFFFF"),
    ("Boston University Terriers", "goterriers.com", "Patriot", "Boston, MA", "Boston U", "#CC0000", "#FFFFFF"),
    ("Brown Bears", "brownbears.com", "Ivy League", "Providence, RI", "Brown", "#4E3629", "#FFFFFF"),
    ("Bryant Bulldogs", "bryantbulldogs.com", "America East", "Smithfield, RI", "Bryant", "#B3975A", "#000000"),
    ("Bucknell Bison", "bucknellbison.com", "Patriot", "Lewisburg, PA", "Bucknell", "#003865", "#FF7300"),
    ("Canisius Golden Griffins", "gogriffs.com", "MAAC", "Buffalo, NY", "Canisius", "#002144", "#C5A253"),
    ("Cleveland State Vikings", "csuvikings.com", "NEC", "Cleveland, OH", "Cleveland State", "#006747", "#FFFFFF"),
    ("Colgate Raiders", "colgateathletics.com", "Patriot", "Hamilton, NY", "Colgate", "#862633", "#FFFFFF"),
    ("Dartmouth Big Green", "dartmouthsports.com", "Ivy League", "Hanover, NH", "Dartmouth", "#00693E", "#FFFFFF"),
    ("Detroit Mercy Titans", "detroittitans.com", "NEC", "Detroit, MI", "Detroit Mercy", "#002C76", "#C8102E"),
    ("Fairfield Stags", "fairfieldstags.com", "CAA", "Fairfield, CT", "Fairfield", "#C8102E", "#FFFFFF"),
    ("Hampton Pirates", "hamptonpirates.com", "CAA", "Hampton, VA", "Hampton", "#003DA5", "#FFFFFF"),
    ("Hobart Statesmen", "hwsathletics.com", "Atlantic 10", "Geneva, NY", "Hobart", "#F47920", "#00447C"),
    ("Holy Cross Crusaders", "goholycross.com", "Patriot", "Worcester, MA", "Holy Cross", "#582C83", "#FFFFFF"),
    ("Iona Gaels", "ionagaels.com", "MAAC", "New Rochelle, NY", "Iona", "#661E2B", "#B39D69"),
    ("Jacksonville Dolphins", "judolphins.com", "ASUN", "Jacksonville, FL", "Jacksonville", "#006747", "#FFFFFF"),
    ("LIU Sharks", "liuathletics.com", "NEC", "Brookville, NY", "LIU", "#00A3E0", "#041E42"),
    ("Lafayette Leopards", "goleopards.com", "Patriot", "Easton, PA", "Lafayette", "#990033", "#FFFFFF"),
    ("Le Moyne Dolphins", "lemoynedolphins.com", "NEC", "Syracuse, NY", "Le Moyne", "#006747", "#FFC72C"),
    ("Lehigh Mountain Hawks", "lehighsports.com", "Patriot", "Bethlehem, PA", "Lehigh", "#6C2D2A", "#FFFFFF"),
    ("Manhattan Jaspers", "gojaspers.com", "MAAC", "Riverdale, NY", "Manhattan", "#046A38", "#FFFFFF"),
    ("Marist Red Foxes", "goredfoxes.com", "MAAC", "Poughkeepsie, NY", "Marist", "#C8102E", "#FFFFFF"),
    ("Marquette Golden Eagles", "gomarquette.com", "Big East", "Milwaukee, WI", "Marquette", "#003366", "#FFCC00"),
    ("Mercer Bears", "mercerbears.com", "ASUN", "Macon, GA", "Mercer", "#E04E00", "#000000"),
    ("Mercyhurst Lakers", "hurstathletics.com", "NEC", "Erie, PA", "Mercyhurst", "#1C4037", "#C5A253"),
    ("Merrimack Warriors", "merrimackathletics.com", "MAAC", "North Andover, MA", "Merrimack", "#003057", "#B3A369"),
    ("Monmouth Hawks", "monmouthhawks.com", "CAA", "West Long Branch, NJ", "Monmouth", "#0F1D41", "#FFFFFF"),
    ("Mount St. Mary's Mountaineers", "mountathletics.com", "MAAC", "Emmitsburg, MD", "Mount St. Mary's", "#002855", "#FFFFFF"),
    ("NJIT Highlanders", "njithighlanders.com", "America East", "Newark, NJ", "NJIT", "#D22630", "#002D72"),
    ("Providence Friars", "friars.com", "Big East", "Providence, RI", "Providence", "#231F20", "#FFFFFF"),
    ("Queens Royals", "queensathletics.com", "ASUN", "Charlotte, NC", "Queens", "#00539B", "#FFFFFF"),
    ("Quinnipiac Bobcats", "gobobcats.com", "MAAC", "Hamden, CT", "Quinnipiac", "#003366", "#FFB81C"),
    ("Robert Morris Colonials", "rmucolonials.com", "NEC", "Moon Township, PA", "Robert Morris", "#002E62", "#C8102E"),
    ("Sacred Heart Pioneers", "sacredheartpioneers.com", "MAAC", "Fairfield, CT", "Sacred Heart", "#C8102E", "#FFFFFF"),
    ("Saint Joseph's Hawks", "sjuhawks.com", "Atlantic 10", "Philadelphia, PA", "Saint Joseph's", "#9E1B32", "#FFFFFF"),
    ("Siena Saints", "sienasaints.com", "MAAC", "Loudonville, NY", "Siena", "#006747", "#FFFFFF"),
    ("St. Bonaventure Bonnies", "gobonnies.com", "Atlantic 10", "Olean, NY", "St. Bonaventure", "#4E3629", "#FFFFFF"),
    ("St. John's Red Storm", "redstormsports.com", "Big East", "Queens, NY", "St. John's", "#C8102E", "#FFFFFF"),
    ("Stony Brook Seawolves", "stonybrookathletics.com", "CAA", "Stony Brook, NY", "Stony Brook", "#990000", "#FFFFFF"),
    ("UMBC Retrievers", "umbcretrievers.com", "America East", "Baltimore, MD", "UMBC", "#000000", "#FDB515"),
    ("UMass Lowell River Hawks", "goriverhawks.com", "America East", "Lowell, MA", "UMass Lowell", "#00559B", "#FFFFFF"),
    ("Vermont Catamounts", "uvmathletics.com", "America East", "Burlington, VT", "Vermont", "#005710", "#FFD100"),
    ("Wagner Seahawks", "wagnerathletics.com", "NEC", "Staten Island, NY", "Wagner", "#003726", "#FFFFFF"),
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
                    # the feed prints penalty time as MM:SS; everything else stores minutes
                    row["pen"] = round((int(m.group(1)) * 60 + int(m.group(2))) / 60, 1)
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
        photos, team_logo = {}, None
        try:
            rh = get(f"https://{site}/sports/mens-lacrosse/roster/{SEASONS[0]}")
            roster = parse_roster_page(rh)
            photos = parse_roster_photos(rh)
            og = re.search(r'property="og:image" content="([^"]+)"', rh)
            if og:
                team_logo = og.group(1)
        except Exception as e:
            print(f"  ! {name} roster: {e}")
        if team_logo:
            team["logoRemote"] = team_logo
        time.sleep(0.35)

        if not ok:
            print(f"  x {name}: no stats table, skipped")
            continue

        cur = stats_by_season.get(SEASONS[0], {})
        players_here = []

        # every season's stat page, not just this year's roster: otherwise a player who
        # graduated in 2023 never enters the database and his seasons vanish with him
        all_names = set(roster)
        for st in stats_by_season.values():
            all_names |= set(st)

        def any_row(nk):
            for season in SEASONS:
                row = stats_by_season.get(season, {}).get(nk)
                if row:
                    return row
            return None

        for nk in all_names:
            bio = roster.get(nk, {})
            s0 = cur.get(nk)
            first = any_row(nk)
            if not first and not bio:
                continue
            # skip roster-only players who never recorded a stat line (deep bench / redshirts)
            if not first and bio and bio.get("position") != "G":
                continue
            pending_goalie = bool(not s0 and bio and bio.get("position") == "G")
            name_disp = (s0 or first or bio)["name"]
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
                "photoRemote": photos.get(nk),
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
    """-> (skater rows, goalie rows, career lines) from a NetFront team page.

    Team pages carry one season of detail plus a career aggregate per player
    (the league's own total across every season it has on record)."""
    skaters, goalies = [], []
    career = {}
    for tb in tables(html):
        heads = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip()
                 for x in re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S)]
        low = [h.lower() for h in heads]
        if "seasons" in low:
            # career aggregate table: Rank, Player, Seasons, GP, G, A, PTS, PIM
            c_idx = {
                "name": find_col(heads, "player", "goalie"),
                "seasons": find_col(heads, "seasons"),
                "gp": find_col(heads, "gp"), "g": find_col(heads, "g"),
                "a": find_col(heads, "a"), "pts": find_col(heads, "pts"),
                "pim": find_col(heads, "pim"), "w": find_col(heads, "w"),
                "l": find_col(heads, "l"),
            }
            is_goal_c = "goalie" in low
            for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
                c = cells(tr)
                if c_idx["name"] is None or c_idx["name"] >= len(c):
                    continue
                nm = c[c_idx["name"]].strip()
                if not nm:
                    continue
                get = lambda k: int(num(c[c_idx[k]])) if c_idx[k] is not None and c_idx[k] < len(c) else 0
                career[(norm_name(nm), "G" if is_goal_c else "F")] = {
                    "gp": get("gp"), "g": get("g"), "a": get("a"), "pts": get("pts"),
                    "pen": get("pim"), "seasons": get("seasons"),
                    "w": get("w"), "l": get("l"),
                }
            continue
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
    return skaters, goalies, career


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
        league_players = {}   # (norm_name, pos) -> player, merged across teams
        for link in team_links:
            tslug = link.rstrip("/").split("/")[-1]
            tid = f"t-{tslug}"
            try:
                th = get(link)
            except Exception:
                continue
            skaters, goalies, career = parse_netfront_team(th)
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
            # fold this team's rows into the league-level record: a player carded
            # by two teams is one person with seasons on both, not two profiles
            for key, p in merged.items():
                rec = league_players.setdefault(
                    key, {"name": p["name"], "position": p["position"], "seasons": [], "team_gp": {}, "career": None}
                )
                rec["seasons"].extend(p["seasons"])
                if p["position"] == "G":
                    rec["position"] = "G"
                for s in p["seasons"]:
                    rec["team_gp"][s["teamId"]] = rec["team_gp"].get(s["teamId"], 0) + s["gp"]
                cl = career.get(key)
                if cl and (rec["career"] is None or cl["gp"] >= rec["career"]["gp"]):
                    rec["career"] = cl

        for (nm, pos), p in league_players.items():
            if not p["team_gp"]:
                continue
            tid = max(p["team_gp"], key=lambda t: p["team_gp"][t])
            players.append({
                "id": f"p-nf-{slug}-{slugify(p['name'])}",
                "slug": slugify(p["name"]), "firstName": p["name"].split(" ")[0],
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
                "careerLine": p["career"],
                "games": [],
            })
            n_players += 1
        print(f"  + {short:14s} {len(team_links):3d} teams, {n_players:5d} players")
    return leagues, teams, players





# --------------------------------------------------------------------------- #
# Assets: team logos and player headshots
# --------------------------------------------------------------------------- #
ASSET_DIR = os.path.join(ROOT, "public")


def fetch_bytes(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def save_image(data, rel_path, size=(224, 224), bias=0.3):
    """Square-crop then downscale to webp: schools serve 3:4 portraits and a
    non-square asset renders stretched or spills out of a square avatar."""
    try:
        from PIL import Image
        import io as _io
        im = Image.open(_io.BytesIO(data)).convert("RGBA")
        w, h = im.size
        side = min(w, h)
        left = (w - side) // 2
        top = int((h - side) * bias)          # bias upward — faces sit high in portraits
        im = im.crop((left, top, left + side, top + side))
        im = im.resize(size, Image.LANCZOS)
        out = os.path.join(ASSET_DIR, rel_path)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        im.save(out, "WEBP", quality=82, method=4)
        return True
    except Exception:
        return False


def grab(url, rel_path, size=(224, 224)):
    """Download once; skip when the file is already on disk."""
    out = os.path.join(ASSET_DIR, rel_path)
    if os.path.exists(out) and os.path.getsize(out) > 200:
        return True
    try:
        return save_image(fetch_bytes(url), rel_path, size)
    except Exception:
        return False


def parse_roster_photos(html):
    """Sidearm prints the headshot in the player card, keyed by its aria-label."""
    out = {}
    for m in re.finditer(r'aria-label="([^"]+?) jersey number', html):
        name = _html.unescape(m.group(1)).strip()
        seg = html[m.start(): m.start() + 2600]
        hit = re.search(r'(https://images\.sidearmdev\.com/crop\?url=[^"\s]+)', seg)
        if hit:
            url = _html.unescape(hit.group(1)).replace("width=100", "width=220").replace("height=100", "height=220")
            out[norm_name(name)] = url
    return out

# --------------------------------------------------------------------------- #
# Game logs — every D1 box score on the school sites
# --------------------------------------------------------------------------- #
BOX_GAMES_PER_PLAYER = 24


def parse_boxscore(html, roster, label=""):
    """One box score -> (game meta, {player_key: line}) for the side whose names match us.

    The same page carries both teams; we pick the player table with the most name
    matches against our roster rather than trusting table order."""
    title_m = re.search(r"<title>([^<]*)", html)
    title = _html.unescape(title_m.group(1)) if title_m else ""
    meta = re.search(r"Lacrosse\s+(vs|at)\s+(.+?)\s+on\s+(\d{1,2}/\d{1,2}/\d{4})", title)
    if not meta:
        return None, {}
    venue, opponent, day = meta.group(1), meta.group(2).strip(), meta.group(3)
    try:
        mm, dd, yy = day.split("/")
        date_iso = f"{yy}-{mm.zfill(2)}-{dd.zfill(2)}"
    except Exception:
        return None, {}

    skaters, goalies, totals = [], [], {}
    for tb in tables(html):
        heads = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip().lower()
                 for x in re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S)]
        if not heads:
            continue
        if "player" in heads and "g" in heads and "a" in heads:
            skaters.append((heads, tb))
        elif "player" in heads and ("sv" in heads or "saves" in heads):
            goalies.append((heads, tb))
        elif "team" in heads and "total" in heads:
            for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
                c = cells(tr)
                if len(c) >= 2 and c[0] and c[-1].strip().isdigit():
                    totals[c[0]] = int(c[-1])

    best = None
    for heads, tb in skaters:
        rows, hits = [], 0
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
            c = cells(tr)
            i_name = find_col(heads, "player")
            if i_name is None or i_name >= len(c):
                continue
            name = title_name(c[i_name])
            if not name or name.lower() in ("player", "totals"):
                continue
            key = norm_name(name)
            line = {
                "g": int(num(c[find_col(heads, "g")])) if find_col(heads, "g") is not None else 0,
                "a": int(num(c[find_col(heads, "a")])) if find_col(heads, "a") is not None else 0,
                "gb": int(num(c[find_col(heads, "gb")])) if find_col(heads, "gb") is not None else 0,
                "ct": int(num(c[find_col(heads, "ct")])) if find_col(heads, "ct") is not None else 0,
                "foW": 0, "foA": 0,
            }
            i_fo = find_col(heads, "fo")
            if i_fo is not None and i_fo < len(c):
                fo = re.match(r"(\d+)\s*-\s*(\d+)", c[i_fo])
                if fo:
                    line["foW"], lost = int(fo.group(1)), int(fo.group(2))
                    line["foA"] = line["foW"] + lost
            if key in roster:
                hits += 1
            rows.append((key, line))
        if best is None or hits > best[0]:
            best = (hits, rows)
    if not best:
        return None, {}

    lines = {k: v for k, v in best[1]}
    for heads, tb in goalies:
        i_name = find_col(heads, "player")
        i_sv = find_col(heads, "sv", "saves")
        i_ga = find_col(heads, "ga", "goals allowed")
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
            c = cells(tr)
            if i_name is None or i_name >= len(c):
                continue
            key = norm_name(title_name(c[i_name]))
            if key not in roster:
                continue
            line = lines.setdefault(key, {"g": 0, "a": 0, "gb": 0, "ct": 0, "foW": 0, "foA": 0})
            line["sv"] = int(num(c[i_sv])) if i_sv is not None and i_sv < len(c) else 0
            line["ga"] = int(num(c[i_ga])) if i_ga is not None and i_ga < len(c) else 0

    our_label = next((k for k in totals if label and label.lower() in k.lower()), None)
    if our_label is None and totals:
        our_label = next(iter(totals))
    our_total = totals.get(our_label, 0) if our_label else 0
    opp_total = max((v for k, v in totals.items() if k != our_label), default=0)
    result = "—"
    if our_total and opp_total:
        result = "W" if our_total > opp_total else ("L" if our_total < opp_total else "T")
    return {"date": date_iso, "opponent": opponent, "result": result, "venue": venue}, lines


def build_boxscores(teams, players):
    """Attach game logs to D1 players from the box score linked on every schedule row."""
    tid_by_domain = {dom: f"t-{slugify(name)}" for name, dom, *_ in SCHOOLS}
    rosters = {}
    for p in players:
        if p["leagueId"] != "ncaa-d1":
            continue
        rosters.setdefault(p["teamId"], {})[norm_name(p["name"])] = p

    seen = set()
    games_added, matched = 0, 0
    for name, dom, *_ in SCHOOLS:
        tid = tid_by_domain.get(dom)
        if not tid:
            continue
        try:
            sch = get(f"https://{dom}/sports/mens-lacrosse/schedule/{SEASONS[0]}")
        except Exception:
            continue
        links = sorted(set(re.findall(r'href="([^"]*/boxscore/\d+)"', sch)))
        for link in links:
            url = link if link.startswith("http") else f"https://{dom}{link}"
            key = f"{tid}|{url}"
            if key in seen:
                continue
            seen.add(key)
            try:
                html = get(url)
            except Exception:
                continue
            roster = rosters.get(tid, {})
            short = name.split()[0]
            meta, lines = parse_boxscore(html, roster, short)
            if meta:
                for nk, line in lines.items():
                    p = roster.get(nk)
                    if not p:
                        continue
                    gkey = f"{p['id']}|{meta['date']}"
                    if gkey in seen:
                        continue
                    seen.add(gkey)
                    p["games"].append({
                        "date": meta["date"], "opponent": meta["opponent"], "result": meta["result"],
                        "g": line.get("g", 0), "a": line.get("a", 0),
                        "gb": line.get("gb", 0), "ct": line.get("ct", 0),
                        "sv": line.get("sv"), "ga": line.get("ga"),
                        "foW": line.get("foW", 0), "foA": line.get("foA", 0),
                    })
                    games_added += 1

    for p in players:
        if p["games"]:
            p["games"].sort(key=lambda g: g["date"])
            p["games"] = p["games"][-BOX_GAMES_PER_PLAYER:]
    with_games = sum(1 for p in players if p["games"])
    print(f"  + box scores: {games_added} player-games across {with_games} players")
    return games_added


# --------------------------------------------------------------------------- #
# Standings and support staff
# --------------------------------------------------------------------------- #
ESPN_LACROSSE = "https://site.api.espn.com/apis/site/v2/sports/lacrosse/mens-college-lacrosse/scoreboard?dates="
D1_SEASON_START = date(2026, 2, 1)
D1_SEASON_END = date(2026, 5, 31)


def norm_team(raw):
    return re.sub(r"[^a-z0-9]", "", (raw or "").lower())


def win_pct(w, l, t=0):
    n = w + l + t
    return round((w + 0.5 * t) / n, 3) if n else 0.0


def standings_pll(teams):
    """PLL publishes a full standings payload behind the stats API."""
    by_slug = {t["slug"].replace("pll-", ""): t["id"] for t in teams if t["leagueId"] == "pll"}
    rows = {}
    for year in ("2026",):
        url = (f"https://stats.premierlacrosseleague.com/api/v4/standings"
               f"?year={year}&seasonSegment=regular")
        try:
            raw = get(url, headers=PLL_HEADERS)
            items = json.loads(raw).get("data", {}).get("items", [])
        except Exception as e:
            print(f"  ! PLL standings: {e}")
            continue
        for it in items:
            slug = slugify(it.get("fullName") or "")
            tid = by_slug.get(slug)
            if not tid:
                continue
            rows[tid] = {
                "teamId": tid, "w": it.get("wins", 0), "l": it.get("losses", 0),
                "t": it.get("ties", 0), "gf": it.get("scores", 0), "ga": it.get("scoresAgainst", 0),
                "confW": it.get("conferenceWins"), "confL": it.get("conferenceLosses"),
                "group": "League", "logo": it.get("urlLogo"),
            }
    print(f"  + PLL: {len(rows)} teams")
    return rows


MCLA_CONFERENCES = {
    "alc": "ALC", "clc": "CLC", "lsa": "LSA", "pncll": "PNCLL", "rmlc": "RMLC",
    "selc": "SELC", "slc": "SLC", "umlc": "UMLC", "wcll": "WCLL",
}
MCLA_ACRONYMS = {"ALC", "CLC", "LSA", "PNCLL", "RMLC", "SELC", "SLC", "UMLC", "WCLL", "D1", "D2", "D3"}


def clean_group(conf, raw):
    """'UMLC EAST' / 'DI' / 'Atlantic Lacrosse Conference Division I' -> 'ALC Division I'."""
    words = re.sub(r"[^A-Za-z0-9]+", " ", raw or "").split()
    up = [w.upper() for w in words]
    div = None
    for key, label in (
        (("DI", "D1", "DIVISION", "I"), "Division I"),
        (("DII", "D2"), "Division II"),
        (("DIII", "D3"), "Division III"),
    ):
        if any(w in key for w in up):
            if key[0] == "DIVISION":
                if "III" in up or "3" in up:
                    div = "Division III"
                elif "II" in up or "2" in up:
                    div = "Division II"
                else:
                    div = "Division I"
            else:
                div = label
            break
    region = next((w for w in ("Northwest", "North", "South", "East", "West", "Central")
                   if w.upper() in up), None)
    label = " ".join(x for x in (div, region) if x)
    return f"{conf} {label}".strip() if label else conf


def _wl(cell, div=False):
    """'7 - 0' -> (7, 0)."""
    nums = re.findall(r"\d+", cell or "")
    if len(nums) >= 2:
        return int(nums[0]), int(nums[1])
    return (int(nums[0]), 0) if nums else (0, 0)


def standings_mcla(teams):
    """mcla.us prints one table per conference (or two divisions side by side)."""
    by_slug = {t["slug"].replace("mcla-", ""): t["id"] for t in teams if t["leagueId"] == "mcla"}
    rows = {}
    pages = []
    for slug, short in MCLA_CONFERENCES.items():
        try:
            pages.append((short, get(f"https://mcla.us/standings/conference/{slug}")))
        except Exception as e:
            print(f"  ! MCLA {slug}: {e}")
    for conf, h in pages:
        for tb in tables(h):
            heads = [re.sub(r"\\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip()
                     for x in re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S)]
            groups = [x for x in heads if x.upper() not in ("#", "DIV", "ALL", "GF", "GA")]
            for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
                c = cells(tr)
                if len(c) < 6:
                    continue
                href = re.search(r'href="/teams/([^/"]+)/', tr)
                if not href:
                    continue
                tid = by_slug.get(href.group(1))
                if not tid:
                    continue
                logo = re.search(r'<img[^>]+src="([^"]+)"', tr)
                blocks = [(c[:6], groups[0] if groups else "")]
                if len(c) >= 11:
                    blocks.append((c[6:12], groups[1] if len(groups) > 1 else ""))
                for blk, group in blocks:
                    if len(blk) < 6:
                        continue
                    conf_w, conf_l = _wl(blk[2])
                    w, l = _wl(blk[3])
                    rows[tid] = {
                        "teamId": tid, "w": w, "l": l, "t": 0,
                        "gf": int(num(blk[4], int)), "ga": int(num(blk[5], int)),
                        "confW": conf_w, "confL": conf_l, "group": clean_group(conf, group),
                        "logo": logo.group(1) if logo else None,
                    }
    print(f"  + MCLA: {len(rows)} teams")
    return rows


def standings_d1(teams):
    """D1 publishes no table we can read, so the record comes from results.

    ESPN's scoreboard carries every final for the season; a team's record is the
    tally of those games. Games missing from ESPN mean an incomplete record, which
    is stated in the UI rather than hidden."""
    by_name = {norm_team(t["name"]): t["id"] for t in teams if t["leagueId"] == "ncaa-d1"}
    rows, unmatched, games = {}, set(), []
    day = D1_SEASON_START
    while day <= D1_SEASON_END:
        try:
            raw = get(ESPN_LACROSSE + day.strftime("%Y%m%d"))
            payload = json.loads(raw) if raw.strip().startswith("{") else {}
        except Exception:
            day += timedelta(days=1)
            continue
        for ev in payload.get("events", []):
            comp = (ev.get("competitions") or [{}])[0]
            if comp.get("status", {}).get("type", {}).get("name") != "STATUS_FINAL":
                continue
            cs = comp.get("competitors") or []
            if len(cs) != 2:
                continue
            g_date = (ev.get("date") or "")[:10]
            pair = []
            for me, opp in ((cs[0], cs[1]), (cs[1], cs[0])):
                name = me.get("team", {}).get("displayName", "")
                tid = by_name.get(norm_team(name))
                if not tid:
                    # opponents outside our roster set still need a rating, or the
                    # Elo graph is missing most of its edges
                    unmatched.add(name)
                    tid = "x-" + norm_team(name)
                try:
                    pair.append((tid, int(me.get("score", 0)), int(opp.get("score", 0)), g_date))
                except Exception:
                    continue
                if tid.startswith("x-"):
                    continue
                row = rows.setdefault(tid, {"teamId": tid, "w": 0, "l": 0, "t": 0,
                                            "gf": 0, "ga": 0, "confW": None, "confL": None,
                                            "group": "Division I"})
                try:
                    row["gf"] += int(me.get("score", 0))
                    row["ga"] += int(opp.get("score", 0))
                except Exception:
                    pass
                if me.get("winner"):
                    row["w"] += 1
                else:
                    row["l"] += 1
            if len(pair) == 2:
                games.append((g_date, pair[0][0], pair[1][0], pair[0][1], pair[1][1]))
        day += timedelta(days=1)
    print(f"  + D1: {len(rows)} teams from results ({len(unmatched)} ESPN names unmatched, {len(games)} games)")
    rows["__games__"] = games
    return rows


def compute_elo(games, k=24, start=1500):
    """Chronological Elo over a season's results, plus strength of schedule.

    Every team starts at 1500, so early-season ratings are noisy by definition —
    the UI says "this season" rather than implying a historical rating."""
    rating, opp_sum, cnt = {}, {}, {}
    for _date, a, b, sa, sb in sorted(games, key=lambda g: g[0]):
        ra, rb = rating.get(a, start), rating.get(b, start)
        exp_a = 1 / (1 + 10 ** ((rb - ra) / 400))
        score_a = 1.0 if sa > sb else 0.0
        rating[a] = ra + k * (score_a - exp_a)
        rating[b] = rb + k * ((1 - score_a) - (1 - exp_a))
        for me, opp_rating in ((a, rb), (b, ra)):
            opp_sum[me] = opp_sum.get(me, 0) + opp_rating
            cnt[me] = cnt.get(me, 0) + 1
    return {
        t: {"elo": round(rating[t]), "sos": round(opp_sum[t] / cnt[t]), "games": cnt[t]}
        for t in rating
    }


def staff_sidearm(teams):
    """Coaches tables on the school sites: name, title, email, phone."""
    domain = {name: dom for name, dom, *_ in SCHOOLS}
    found = 0
    for t in teams:
        if t["leagueId"] != "ncaa-d1":
            continue
        dom = domain.get(t["name"])
        if not dom:
            continue
        try:
            h = get(f"https://{dom}/sports/mens-lacrosse/coaches")
        except Exception:
            continue
        staff = []
        ROLE_WORDS = ("coach", "coordinator", "director", "manager", "trainer",
                      "assistant", "operations", "communications", "analyst", "advisor")
        for tb in tables(h):
            heads = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip().lower()
                     for x in re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S)]
            if "name" not in heads and "title" not in heads:
                continue
            for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
                ths = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip()
                       for x in re.findall(r"<th[^>]*>(.*?)</th>", tr, re.S)]
                if any(t.lower() in ("name", "title") for t in ths):
                    continue                      # column header row
                tds = cells(tr)
                if not tds:
                    continue
                role = next((t for t in tds if any(w in t.lower() for w in ROLE_WORDS)), "")
                name = ths[0] if ths else ""
                if not name:
                    cands = [t for t in tds if t and "@" not in t
                             and not re.search(r"\d{3}", t)
                             and not any(w in t.lower() for w in ROLE_WORDS)]
                    name = cands[0] if cands else ""
                if not name or not role:
                    continue
                staff.append({"name": name, "role": role})
        if staff:
            t["staff"] = staff
            found += 1
    print(f"  + staff (school sites): {found} teams")
    return found


def staff_mcla(teams):
    """MCLA team pages carry the head coach in the header card."""
    found = 0
    for t in teams:
        if t["leagueId"] != "mcla":
            continue
        slug = t["slug"].replace("mcla-", "")
        try:
            h = get(f"https://mcla.us/teams/{slug}/2026")
        except Exception:
            continue
        pairs = re.findall(r'<p class="label">([^<]+)</p>\s*<p class="value">([^<]*)</p>', h)
        staff = [{"name": v.strip(), "role": k.strip()} for k, v in pairs
                 if k.strip().lower() in ("head coach", "assistant coach", "coach")]
        if staff:
            t["staff"] = staff
            found += 1
    print(f"  + staff (MCLA): {found} teams")
    return found


def attach_standings(leagues, teams):
    by_id = {t["id"]: t for t in teams}
    collected = {}
    d1_rows = standings_d1(teams)
    d1_games = d1_rows.pop("__games__", [])
    collected.update(d1_rows)
    collected.update(standings_mcla(teams))
    collected.update(standings_pll(teams))

    ratings = compute_elo(d1_games)
    for tid, r in ratings.items():
        if tid in by_id:
            by_id[tid]["elo"] = r["elo"]
            by_id[tid]["sos"] = r["sos"]

    by_league = {}
    for tid, row in collected.items():
        t = by_id.get(tid)
        if not t:
            continue
        by_league.setdefault(t["leagueId"], []).append(row)

    for lg in leagues:
        rows = by_league.get(lg["id"])
        if not rows:
            continue
        rows.sort(key=lambda r: (-win_pct(r["w"], r["l"], r["t"]), -r["w"], r["ga"] - r["gf"]))
        groups = {r.get("group", "") for r in rows}
        bidx = {}
        for i, row in enumerate(rows, 1):
            row["rank"] = i
            row["pct"] = win_pct(row["w"], row["l"], row["t"])
            g = row.get("group", "")
            bidx[g] = bidx.get(g, 0) + 1
            row["groupRank"] = bidx[g]
        size = {g: n for g, n in bidx.items()}
        for row in rows:
            g = row.get("group", "")
            t = by_id[row["teamId"]]
            if row.get("logo") and not t.get("logoRemote"):
                t["logoRemote"] = row["logo"]
            t["record"] = {
                "w": row["w"], "l": row["l"], "t": row["t"], "pct": row["pct"],
                # inside a conference, the conference place is the one that means something
                "rank": row["groupRank"] if len(groups) > 1 else row["rank"],
                "teams": size.get(g, len(rows)) if len(groups) > 1 else len(rows),
                "overallRank": row["rank"], "overallTeams": len(rows),
                "group": g,
            }
        lg["standings"] = rows
        print(f"  · {lg['short']}: standings for {len(rows)} teams")

    for lg in leagues:
        rated = [t for t in teams if t["leagueId"] == lg["id"] and t.get("elo")]
        if not rated:
            continue
        rated.sort(key=lambda t: -t["elo"])
        lg["ratings"] = [
            {"teamId": t["id"], "elo": t["elo"], "sos": t.get("sos", 0), "rank": i}
            for i, t in enumerate(rated, 1)
        ]
        print(f"  · {lg['short']}: Elo for {len(rated)} teams")
    return leagues


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
                w, h = im.size
                side = min(w, h)
                left, top = (w - side) // 2, int((h - side) * 0.3)
                im = im.crop((left, top, left + side, top + side)).resize((224, 224), Image.LANCZOS)
                im.save(path, "WEBP", quality=84, method=4)
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

PLAYER_EMPTY_KEYS = (
    "bio", "strengths", "awards", "rankings", "commit", "draft", "highSchool",
    "hand", "dob", "classYear", "experience", "jersey", "heightIn", "weightLb",
    "photo", "photoRemote",
)


def strip_keys(obj, keys):
    """Drop empty informational keys — the app fills defaults at load."""
    for k in keys:
        if k in obj and obj[k] in ("", None, [], {}, 0):
            del obj[k]


def materialise_assets(teams, players):
    """Download team logos and player headshots once, store a relative path."""
    logos = photos = 0
    for t in teams:
        remote = t.pop("logoRemote", None)
        if not remote:
            continue
        if grab(remote, f"logos/{t['slug']}.webp", (120, 120)):
            t["logo"] = f"logos/{t['slug']}.webp"
            logos += 1
    for p in players:
        remote = p.pop("photoRemote", None)
        if not remote:
            continue
        fname = re.sub(r"[^a-z0-9-]", "", p["id"].lower())
        if grab(remote, f"players/ncaa/{fname}.webp", (224, 224)):
            p["photo"] = f"players/ncaa/{fname}.webp"
            photos += 1
    print(f"  + logos: {logos} teams · headshots: {photos} players")



def attach_poll(leagues, teams):
    """Merge the polls scraped by scripts/fetch-rankings.py (browser-rendered)."""
    path = os.path.join(ROOT, "public", "rankings.json")
    if not os.path.exists(path):
        return
    try:
        payload = json.load(open(path))
    except Exception as e:
        print(f"  ! poll: {e}")
        return
    polls = payload.get("polls") or []
    if not polls:
        return
    by_key = {norm_team(t["name"]): t for t in teams if t["leagueId"] == "ncaa-d1"}

    # movement: compare each poll with the previous snapshot in rankings-history.json
    previous = {}
    hist_path = os.path.join(ROOT, "public", "rankings-history.json")
    try:
        history = json.load(open(hist_path)) if os.path.exists(hist_path) else []
    except Exception:
        history = []
    for poll in polls:
        earlier = [h for h in history if h.get("key") == poll["key"] and h.get("fetched", "") < poll.get("fetched", "")]
        if earlier:
            latest = max(earlier, key=lambda h: h.get("fetched", ""))
            previous[poll["key"]] = {
                norm_team(r.get("team", "")): r.get("rank") for r in latest.get("rows", [])
            }

    out = []
    for poll in polls:
        rows, matched = [], 0
        for r in poll.get("rows", []):
            key = norm_team(r.get("team", ""))
            team = by_key.get(key) or next((t for k, t in by_key.items() if k.startswith(key)), None)
            if team:
                team.setdefault("pollRanks", {})[poll["key"]] = r["rank"]
                matched += 1
            prev_rank = previous.get(poll["key"], {}).get(key)
            rows.append({
                "rank": r["rank"], "name": r.get("team", ""), "record": r.get("record", ""),
                "extra": r.get("extra", ""), "teamId": team["id"] if team else None,
                "prev": prev_rank,
            })
        out.append({
            "key": poll["key"], "source": poll.get("source", poll["key"]),
            "fetched": poll.get("fetched", ""), "rows": rows,
        })
        moves = sum(1 for r in rows if r.get("prev") not in (None, r["rank"]))
        print(f"  + poll {poll['key']}: {len(rows)} ranked ({matched} matched, {moves} moved)")
    league = next((l for l in leagues if l["id"] == "ncaa-d1"), None)
    if league:
        league["polls"] = out



# --------------------------------------------------------------------------- #
# Records and history (Wikipedia: champions, titles by program, Tewaaraton)
# --------------------------------------------------------------------------- #
HISTORY_SOURCES = {
    "tournament": "https://en.wikipedia.org/wiki/NCAA_Division_I_men%27s_lacrosse_tournament",
    "tewaaraton": "https://en.wikipedia.org/wiki/Tewaaraton_Award",
}


def _wiki_tables(html):
    """-> [(headers, rows_of_cells)] with header text normalised."""
    out = []
    for tb in tables(html):
        heads = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip()
                 for x in re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S)]
        rows = []
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
            cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip()
                     for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            if cells:
                rows.append(cells)
        out.append((heads, rows))
    return out


def build_history(teams):
    """Champions by year, titles by program, and Tewaaraton winners."""
    by_name = {norm_team(t["name"]): t["id"] for t in teams if t["leagueId"] == "ncaa-d1"}

    def team_id(name):
        key = norm_team(name)
        return by_name.get(key) or next((tid for k, tid in by_name.items() if k.startswith(key)), None)

    history = {"champions": [], "programs": [], "tewaaraton": [], "sources": []}

    # --- titles by program: "Team | Titles | Years won" -> year -> champion
    try:
        html = get(HISTORY_SOURCES["tournament"])
        history["sources"].append(HISTORY_SOURCES["tournament"])
        year_winner = {}
        for heads, rows in _wiki_tables(html):
            low = [h.lower() for h in heads]
            if not ("team" in low and "titles" in low):
                continue
            i_years = next((i for i, h in enumerate(low) if "years" in h), None)
            if i_years is None:
                continue
            for cells in rows:
                if len(cells) <= i_years or not re.fullmatch(r"\d+", cells[1] or ""):
                    continue
                program = cells[0].replace("\u00a0", " ").strip()
                if not program or program.lower() == "team":
                    continue
                years = [int(y) for y in re.findall(r"\b(19\d{2}|20\d{2})\b", cells[i_years])]
                history["programs"].append({
                    "team": program, "titles": int(cells[1]), "years": years,
                    "teamId": team_id(program),
                })
                for y in years:
                    year_winner.setdefault(y, program)
        # the page carries both an all-time table and an NCAA-only table; keep the
        # fuller total per program so the list doesn't list Syracuse twice
        best = {}
        for p in history["programs"]:
            key = norm_team(p["team"])
            if key not in best or p["titles"] > best[key]["titles"]:
                best[key] = p
        history["programs"] = sorted(best.values(), key=lambda p: -p["titles"])

        history["champions"] = [
            {"year": y, "team": w, "teamId": team_id(w)}
            for y, w in sorted(year_winner.items(), reverse=True)
        ]
        print(f"  + champions: {len(history['champions'])} seasons, {len(history['programs'])} programs")
    except Exception as e:
        print(f"  ! champions: {e}")

    # --- Tewaaraton winners
    try:
        html = get(HISTORY_SOURCES["tewaaraton"])
        history["sources"].append(HISTORY_SOURCES["tewaaraton"])
        for heads, rows in _wiki_tables(html):
            low = [h.lower() for h in heads]
            if "year" not in low or not any("men's winner" in h for h in low):
                continue
            i_year = low.index("year")
            i_winner = next(i for i, h in enumerate(low) if "men's winner" in h)
            i_school = next((i for i, h in enumerate(low) if h.strip() == "school"), None)
            i_pos = next((i for i, h in enumerate(low) if h.strip() == "position"), None)
            for cells in rows:
                if len(cells) <= max(i_year, i_winner) or not re.fullmatch(r"\d{4}", cells[i_year] or ""):
                    continue
                school = cells[i_school] if i_school is not None and i_school < len(cells) else ""
                pos = cells[i_pos] if i_pos is not None and i_pos < len(cells) else ""
                # 2020's row reads "No Awards Due to COVID-19" in the winner column
                if re.search(r"no award|covid|cancell?ed|not awarded", cells[i_winner] or "", re.I):
                    continue
                history["tewaaraton"].append({
                    "year": int(cells[i_year]),
                    "player": cells[i_winner].replace("\u00a0", " ").strip(),
                    "school": school, "position": pos,
                    "teamId": team_id(school) if school else None,
                })
            if history["tewaaraton"]:
                break
        history["tewaaraton"].sort(key=lambda r: -r["year"])
        print(f"  + Tewaaraton winners: {len(history['tewaaraton'])}")
    except Exception as e:
        print(f"  ! Tewaaraton: {e}")

    return history



# --------------------------------------------------------------------------- #
# Record book (Wikipedia) + USILA All-America teams (PDF)
# --------------------------------------------------------------------------- #
RECORDS_URL = "https://en.wikipedia.org/wiki/NCAA_Division_I_men%27s_lacrosse_records"

# D1 only: the D2/D3 sheets are laid out per position group with region, jersey and
# selection in one row, a different shape entirely (see docs/deferred-sources.md).
AA_PDFS = {
    ("D1", 2026): ("https://s3.amazonaws.com/sidearm.sites/usila.sidearmsports.com/documents/"
                   "2026/5/21/2026_USILA_Division_I_All_American_Teams_and_Award_Winners_Sheet1.pdf"),
    ("D1", 2025): ("https://s3.amazonaws.com/sidearm.sites/usila.sidearmsports.com/documents/"
                   "2025/5/22/USILADIAllAmericanTeamsAwards2025.pdf"),
    ("D1", 2024): ("https://s3.amazonaws.com/sidearm.sites/usila.sidearmsports.com/documents/"
                   "2024/5/23/updated2024_USILA_Division_I_All_Americans.pdf"),
    ("D1", 2023): ("http://collegelacrossenews.com/wp-content/uploads/2026/06/"
                   "2023_USILA_Division_I_All_Americans_Updated.pdf"),
}

AA_POS = ("ATT", "MID", "DEF", "GOAL", "GK", "FO", "SSDM", "LSM", "D", "A", "M", "G")
AA_CLASS = ("Freshman", "Sophomore", "Junior", "Senior", "Grad", "Graduate", "Redshirt")


def build_records():
    """Career and single-season leaderboards plus program win totals."""
    html = get(RECORDS_URL)
    sections = []
    heading = ""
    for chunk in re.finditer(r"(<h[23][^>]*>.*?</h[23]>)|(<table[^>]*>.*?</table>)", html, re.S):
        if chunk.group(1):
            heading = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", chunk.group(1))).strip()
            continue
        tb = chunk.group(2)
        heads = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip()
                 for x in re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S)][:9]
        if not heads or "Player" not in heads and "University" not in heads:
            continue
        rows = []
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
            cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip()
                     for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
            # Wikipedia leaves footnote markers in the figures: "10.89 [a]"
            cells = [re.sub(r"\s*\[[a-z0-9]{1,3}\]$", "", c) for c in cells]
            if len(cells) < 4:
                continue
            rows.append(dict(zip(heads, cells)))
        if len(rows) < 5:
            continue
        low = heading.lower()
        if "program" in low:
            key, scope, label = "program-wins", "program", "Program wins and titles"
        else:
            metric = ("points" if "point" in low else
                      "goals" if "goal" in low else
                      "assists" if "assist" in low else "other")
            per_game = "per game" in low
            # two tables share the heading "Assists per game"; the season one carries a
            # singular "Year" column, the career one "Years"
            season_table = ("one season" in low or "in one season" in low
                            or ("Year" in heads and "Years" not in heads))
            scope = "season" if season_table else "career"
            key = f"{scope}-{metric}{'-pg' if per_game else ''}"
            label = f"{'Single season' if scope == 'season' else 'Career'} {metric}"
            label += " per game" if per_game else ""
            label = label[0].upper() + label[1:]
        if any(s["key"] == key for s in sections):
            continue
        sections.append({"key": key, "scope": scope, "label": label, "columns": heads, "rows": rows})

    print(f"  + record book: {len(sections)} leaderboards, "
          f"{sum(len(s['rows']) for s in sections)} rows")
    return {"source": RECORDS_URL, "sections": sections}


def _aa_text(url):
    import io as _io
    from pypdf import PdfReader
    raw = fetch_bytes(url)
    reader = PdfReader(_io.BytesIO(raw))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


# the sheet's layout changed year to year; normalise the trailing tokens instead of the line
AA_TEAM = re.compile(
    r"^(First|Second|Third|Fourth|1st|2nd|3rd|4th)\s*Team(\s+All[\s-]*Americans?)?$"
    r"|^Honorable\s+Mention(\s+All[\s-]*Americans?)?$"
    r"|^Honorable\s+Mention\s+Team$",
    re.I,
)
AA_CLASSES = ("Freshman", "Sophomore", "Junior", "Senior", "Grad", "Graduate", "Soph", "Junior.", "R-Senior")
AA_POSITIONS = ("ATT", "MID", "DEF", "GOAL", "GK", "FO", "SSDM", "LSM", "D", "G", "A", "M")
AA_LEAD_POS = {
    "Attack": "ATT", "Midfield": "MID", "Defense": "DEF", "Defence": "DEF",
    "Goalie": "GOAL", "LSM": "LSM", "SSDM": "SSDM", "Faceoff": "FO", "FO": "FO",
}


# sheets print institutions, not team names: "Cornell University", "U.S. Military Academy"
SCHOOL_NOISE = ("university", "college", "institute", "academy", "of", "the", "at", "us", "usa")
SCHOOL_ALIAS = {
    "usmilitary": "army", "usnaval": "navy", "usairforce": "airforce",
    "militaryacademy": "army", "navalacademy": "navy", "airforceacademy": "airforce",
    "military": "army", "naval": "navy", "airforce": "airforce",
    "unc": "northcarolina", "uncch": "northcarolina", "pennstate": "pennstate",
    "umbc": "umbc", "liu": "liu", "njit": "njit", "vmi": "vmi",
}


def school_key(raw):
    key = norm_team(raw)
    for noise in SCHOOL_NOISE:
        key = key.replace(noise, "")
    return SCHOOL_ALIAS.get(key, key)


def split_name_school(body, known):
    """PDF text collapses the columns, so split from the right against known schools.

    Program names carry mascots in our dataset ("Notre Dame Fighting Irish"), while the
    sheet prints "Notre Dame" or "Notre Dame University" — so compare the institution part
    with noise words removed, and accept a prefix of a known program.
    """
    tokens = body.split()
    # longest school first: "Owen Duffy North Carolina" must not split at "Carolina"
    for i in range(2, len(tokens)):
        candidate = " ".join(tokens[i:])
        key = school_key(candidate)
        if len(key) < 3:
            continue
        if key in known or any(school_key(k) == key or k.startswith(key) for k in known):
            # "Cornell University" reads better as "Cornell"
            display = " ".join(w for w in candidate.split()
                               if w.lower().strip(".,") not in SCHOOL_NOISE) or candidate
            display = {"Army": "Army", "Navy": "Navy", "Air Force": "Air Force"}.get(
                SCHOOL_ALIAS.get(key, key).title(), display
            )
            return " ".join(tokens[:i]), display
    if len(tokens) >= 3:
        return " ".join(tokens[:-1]), tokens[-1]
    return body, ""


def parse_aa_line(line, by_name):
    """-> (player dict) or None. Handles the three layouts USILA has used since 2023."""
    tokens = line.split()
    if len(tokens) < 3:
        return None
    pos = cls = None

    # layout A/B: position and class trail the name (order varies by year)
    if tokens[-1] in AA_POSITIONS and len(tokens) > 3:
        pos = tokens.pop()
        if tokens[-1].rstrip(".") in [c.rstrip(".") for c in AA_CLASSES]:
            cls = tokens.pop()
    elif tokens[-1] in AA_CLASSES:
        cls = tokens.pop()
        if tokens and tokens[-1] in AA_POSITIONS:
            pos = tokens.pop()

    # layout C (2023): the position leads and there is no class column
    if pos is None and tokens and tokens[0] in AA_LEAD_POS:
        pos = AA_LEAD_POS[tokens.pop(0)]

    if pos is None:
        return None
    body = " ".join(tokens)
    name, school = split_name_school(body, by_name)
    if not name or not school:
        return None
    return {"name": name, "school": school, "class": cls or "", "position": pos}


def build_all_americans(teams):
    """USILA All-America teams come as PDFs — one line per player."""
    by_name = {norm_team(t["name"]): t["id"] for t in teams if t["leagueId"] == "ncaa-d1"}

    def team_id(school):
        key = norm_team(school)
        return by_name.get(key) or next((tid for k, tid in by_name.items() if k.startswith(key)), None)

    out = []
    for (division, year), url in AA_PDFS.items():
        try:
            text = _aa_text(url)
        except Exception as e:
            print(f"  ! all-americans {division} {year}: {e}")
            continue
        groups, current = [], None
        for line in (l.strip() for l in text.splitlines()):
            if not line or line.startswith(str(year)) or line.lower().startswith(("player school", "award name")):
                continue
            # award-winner preamble ("Lt. Col. ... Outstanding Attackman – X – Sr – Attack – Duke")
            if re.search(r"Player of the Year|Outstanding|Award Name|Ensign|^Lt\.|^Lt\s|^\s*Co ", line, re.I):
                continue
            if AA_TEAM.match(line):
                label = re.sub(r"\s*All[\s-]*Americans?$", "", line, flags=re.I).strip()
                # sheets alternate between "First Team" and "1st Team"
                label = re.sub(r"^(First|Second|Third|Fourth)\b", lambda m: {
                    "First": "1st", "Second": "2nd", "Third": "3rd", "Fourth": "4th",
                }[m.group(1)], label, flags=re.I)
                current = {"team": label, "players": []}
                groups.append(current)
                continue
            parsed = parse_aa_line(line, by_name)
            if not parsed:
                continue
            if current is None:
                # the 2023 sheet opens straight into the first team, with no heading
                current = {"team": "1st Team", "players": []}
                groups.append(current)
            current["players"].append({**parsed, "teamId": team_id(parsed["school"])})
        groups = [g for g in groups if g["players"]]
        total = sum(len(g["players"]) for g in groups)
        print(f"  + all-americans {division} {year}: {total} players in {len(groups)} teams")
        out.append({"division": division, "year": year, "source": url, "teams": groups})

    return out



# --------------------------------------------------------------------------- #
# Duplicate players: one person, many teams
# --------------------------------------------------------------------------- #
POS_GROUP = {"A": "attack", "F": "attack", "M": "mid", "D": "def", "LSM": "def",
             "FO": "faceoff", "G": "goal"}

LEAGUE_RANK = {"pll": 9, "ncaa-d1": 8, "nfl": 7, "nf-nll": 7, "mcla": 6}


def name_key(name):
    return re.sub(r"[^a-z]", "", (name or "").lower())


def team_alias(a, b, team_names):
    """'UC Santa Barbara' and 'Santa Barbara' are the same program."""
    na, nb = team_names.get(a, ""), team_names.get(b, "")
    na, nb = re.sub(r"[^a-z]", "", na.lower()), re.sub(r"[^a-z]", "", nb.lower())
    if not na or not nb or na == nb:
        return na == nb and bool(na)
    return (na in nb or nb in na) and min(len(na), len(nb)) >= 6


def _years(p):
    return {int(s["season"]) for s in p.get("seasons", []) if str(s.get("season", "")).isdigit()}


BOX_FAMILIES = {"rmll", "ontario", "bc", "west"}
PRO_LEAGUES = {"pll", "nf-nll", "nf-msl"}


def league_family(lg):
    lg = lg or ""
    if lg.startswith("nf-rmll"):
        return "rmll"
    if lg in ("nf-ojbll", "nf-ojcll", "nf-ojll"):
        return "ontario"
    if lg == "nf-bcjall":
        return "bc"
    if lg in ("nf-wcjll", "nf-pnwjll", "nf-tojll"):
        return "west"
    if lg == "ncaa-d1":
        return "ncaa"
    return lg


def same_person(a, b, team_names, strict=False):
    """Merge only with evidence.

    Name alone is not evidence: "Aidan Smith" is two players at two MCLA schools in the
    same season, and the box feeds carry no birthplace to tell them apart. So:
      1. same program (or a naming variant of it) — duplicate rows
      2. same Canadian box ladder, one year apart — Junior B to Junior C, Jr A to Jr B
      3. pro box to pro field, one year apart — the genuine NLL/PLL/MSL crossovers
    Field to box and school to school across leagues stay separate.
    """
    gpa, gpb = POS_GROUP.get(a.get("position")), POS_GROUP.get(b.get("position"))

    # two records for the same club in the same season are two people with one name, not
    # one person on two rows — merging them double-counts a season
    rows_a = {(s["season"], s["teamId"]) for s in a.get("seasons", [])}
    rows_b = {(s["season"], s["teamId"]) for s in b.get("seasons", [])}
    if rows_a & rows_b:
        return False

    # a date of birth is proof either way: same person, or definitively not.
    # GameSheet supplies them for the box leagues, so this now has teeth.
    dob_a, dob_b = a.get("dob"), b.get("dob")
    if dob_a and dob_b and dob_a != dob_b:
        return False

    if a.get("teamId") == b.get("teamId") or team_alias(a.get("teamId"), b.get("teamId"), team_names):
        return True
    if strict:
        return False

    ya, yb = _years(a), _years(b)
    if not ya or not yb:
        return False

    la, lb = a.get("leagueId"), b.get("leagueId")
    if la == lb:
        return False                                     # same league, two schools: two people

    pro_pair = la in PRO_LEAGUES and lb in PRO_LEAGUES
    # college to the pros: the same person, a year or two apart
    college_pro = ("ncaa-d1" in (la, lb)) and bool(({la, lb} - {"ncaa-d1"}) & PRO_LEAGUES)
    gap = min(abs(x - y) for x in ya for y in yb)
    # a pro career runs for a decade; the box ladder is a one-year-at-a-time move
    if gap > (5 if pro_pair else 2 if college_pro else 1):
        return False
    # box prints the forward as "F" where field prints "A"/"M", so different groups are
    # normal for one pro. A goalie is still never the same person as an attackman.
    if gpa and gpb and gpa != gpb and not (pro_pair or college_pro):
        return False
    if (pro_pair or college_pro) and "goal" in (gpa, gpb) and gpa != gpb:
        return False

    fa, fb = league_family(la), league_family(lb)
    if fa == fb and fa in BOX_FAMILIES:
        return gpa == gpb                                # same province ladder, next rung
    if pro_pair or college_pro:
        # two teammates can share a name, so never fold two records on the same club
        return a.get("teamId") != b.get("teamId")

    ba, bb = a.get("birthplace") or {}, b.get("birthplace") or {}
    return bool(ba.get("city")) and ba == bb             # only NCAA carries this today


def combine_player(cluster, team_names):
    """Fold a cluster of records for one person into a single profile."""
    def score(p):
        yrs = _years(p)
        return (bool(p.get("photo")), len(p.get("seasons") or []), max(yrs) if yrs else 0)

    primary = max(cluster, key=score)

    seasons, seen, stat_keys = [], set(), {}
    for p in sorted(cluster, key=lambda x: -len(x.get("seasons") or [])):
        for s in p.get("seasons") or []:
            k = (str(s.get("season")), s.get("teamId"), s.get("leagueId"), s.get("type"))
            if k in seen:
                continue
            # some clubs are listed in two box leagues (Westshore in PNWJLL and WCJLL);
            # the same games arrive twice and would double every career total
            stats = (s.get("gp"), s.get("g"), s.get("a"), s.get("pts"))
            twin = (str(s.get("season")), s.get("teamId"), stats)
            if twin in stat_keys:
                continue
            stat_keys[twin] = 1
            seen.add(k)
            seasons.append(s)
    seasons.sort(key=lambda s: (str(s.get("season")), s.get("leagueId") or ""))

    # current team: newest season, then the strongest competition
    current = max(
        seasons,
        key=lambda s: (int(s["season"]) if str(s.get("season", "")).isdigit() else 0,
                       LEAGUE_RANK.get(s.get("leagueId", ""), 1)),
        default=None,
    )

    merged = dict(primary)
    merged["seasons"] = seasons
    if current:
        merged["teamId"] = current["teamId"]
        merged["leagueId"] = current["leagueId"]

    # keep the fullest name, and fill any gap from the other records
    merged["name"] = max((p.get("name") or "" for p in cluster), key=len) or primary.get("name")
    for p in cluster:
        for k, v in p.items():
            if k in ("seasons", "id", "slug", "teamId", "leagueId", "name"):
                continue
            if v and not merged.get(k):
                merged[k] = v
            elif isinstance(v, dict) and isinstance(merged.get(k), dict):
                for kk, vv in v.items():
                    if vv and not merged[k].get(kk):
                        merged[k][kk] = vv

    # photo: prefer one from the current team's league
    photos = [(p.get("photo"), p.get("leagueId")) for p in cluster if p.get("photo")]
    if photos:
        pick = next((ph for ph, lg in photos if lg == merged.get("leagueId")), photos[0][0])
        merged["photo"] = pick
    return merged


def merge_players(players, teams):
    """Collapse records that describe the same person across teams and leagues."""
    team_names = {t["id"]: t["name"] for t in teams}
    groups = {}
    for p in players:
        groups.setdefault(name_key(p["name"]), []).append(p)

    out, merged_rows = [], 0
    for key, group in groups.items():
        if len(group) == 1:
            out.append(group[0])
            continue
        strict = len(group) > 4          # common name: demand a program match
        clusters = []
        for p in group:
            for c in clusters:
                if any(same_person(p, q, team_names, strict) for q in c):
                    c.append(p)
                    break
            else:
                clusters.append([p])
        for c in clusters:
            if len(c) == 1:
                out.append(c[0])
            else:
                out.append(combine_player(c, team_names))
                merged_rows += len(c) - 1

    print(f"  + merged duplicates: {merged_rows} rows folded, {len(players)} -> {len(out)} players")
    return out


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

    print("Game logs…")
    build_boxscores(teams, players)

    print("Records and history…")
    dataset_history = build_history(teams)
    try:
        dataset_history["records"] = build_records()
    except Exception as e:
        print(f"  ! records: {e}")
    try:
        dataset_history["allAmericans"] = build_all_americans(teams)
    except Exception as e:
        print(f"  ! all-americans: {e}")

    print("Standings…")
    attach_standings(leagues, teams)

    print("Poll rankings…")
    attach_poll(leagues, teams)

    print("Support staff…")
    staff_sidearm(teams)
    staff_mcla(teams)

    used_teams = {p["teamId"] for p in players}
    teams = [t for t in teams if t["id"] in used_teams]
    teams.sort(key=lambda t: (t["leagueId"], t["name"]))
    players.sort(key=lambda p: (p["leagueId"], p["name"]))

    players = merge_players(players, teams)

    # make profile URLs unique across schools / leagues.
    # the plain slug goes to the most substantial profile: with two "Hunter Smith"s the
    # five-season pro should own /player/hunter-smith, not the two-season club player
    players.sort(key=lambda p: (bool(p.get("photo")), len(p.get("seasons") or [])), reverse=True)
    seen = {}
    for p in players:
        base = p["slug"] or slugify(p["name"])
        slug, n = base, 1
        while slug in seen:
            n += 1
            slug = f"{base}-{n}"
        seen[slug] = 1
        p["slug"] = slug

    materialise_assets(teams, players)

    for t in teams:
        strip_keys(t, ("city", "cityName", "region", "logo", "staff", "elo", "sos"))
    for p in players:
        strip_keys(p, PLAYER_EMPTY_KEYS)

    # game logs are ~1.3 MB and only needed when a profile's game log opens
    games_blob = {}
    for p in players:
        g = p.pop("games", None)
        if g:
            games_blob[p["id"]] = g

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
        "history": dataset_history,
    }
    # final sanity pass: no negative stat cells, and college points equal goals + assists
    for p in players:
        for s in p["seasons"]:
            for k in ("gp", "g", "a", "pts", "sh", "gb", "to", "ct", "foW", "foA", "pen", "min", "ga", "sv", "w", "l"):
                v = s.get(k)
                if isinstance(v, (int, float)) and v < 0:
                    s[k] = 0
            if s.get("leagueId") in ("ncaa-d1", "mcla"):
                s["pts"] = (s.get("g") or 0) + (s.get("a") or 0)

    # feeds sometimes hand back HTML-escaped names ("Brennan O&#039;Neill"); decode
    # them here so the site never renders a literal entity
    def _unescape_deep(o):
        if isinstance(o, str):
            return _html.unescape(o)
        if isinstance(o, list):
            return [_unescape_deep(x) for x in o]
        if isinstance(o, dict):
            return {k: _unescape_deep(v) for k, v in o.items()}
        return o

    dataset = _unescape_deep(dataset)
    games_blob = _unescape_deep(games_blob)

    out = os.path.join(ROOT, "public", "data.json")
    with open(out, "w") as f:
        json.dump(dataset, f, separators=(",", ":"))
    games_out = os.path.join(ROOT, "public", "games.json")
    with open(games_out, "w") as f:
        json.dump(games_blob, f, separators=(",", ":"))
    size = os.path.getsize(out) / 1024
    gsize = os.path.getsize(games_out) / 1024
    print(f"\nwrote {out}: {len(players)} players, {len(teams)} teams, {len(leagues)} leagues, {size:.0f} KB")
    print(f"wrote {games_out}: {len(games_blob)} players with game logs, {gsize:.0f} KB")
    from collections import Counter
    print("by league:", Counter(p["leagueId"] for p in players))
    print("seasons:", sum(len(p["seasons"]) for p in players))


if __name__ == "__main__":
    main()