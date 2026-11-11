#!/usr/bin/env python3
"""
Poll rankings — the sources that need a real browser.

ncaa.com renders its rankings tables client-side and usila.org ships the coaches poll
inside a widget, so plain HTTP returns empty tables. This drives the bundled Chromium
through cdp.py, reads the rendered rows, and writes:

  public/rankings.json          latest rows per poll (what the site reads)
  public/rankings-history.json  append-only archive, one entry per poll per day

Inside Lacrosse is skipped: insidelacrosse.com sits behind a Cloudflare challenge.

Usage: python3 scripts/fetch-rankings.py [--only committee|rpi|usila]
"""
import asyncio, json, os, re, sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "rankings.json")
HISTORY = os.path.join(ROOT, "public", "rankings-history.json")

SOURCES = {
    "committee": {
        "label": "NCAA committee top 10",
        "url": "https://www.ncaa.com/rankings/lacrosse-men/d1/di-committees-top-10",
    },
    "rpi": {
        "label": "NCAA RPI",
        "url": "https://www.ncaa.com/rankings/lacrosse-men/d1/ncaa-mens-lacrosse-rpi",
    },
    "usila": {
        "label": "USILA coaches poll",
        "url": "https://usila.org/index.aspx",
    },
}

# Every extractor gets the table's nearest heading plus its raw rows.
EXTRACT = """
(() => {
  const out = [];
  for (const t of document.querySelectorAll('table')) {
    const rows = [...t.querySelectorAll('tr')].map(tr =>
      [...tr.querySelectorAll('th,td')].map(c => c.innerText.replace(/\\s+/g, ' ').trim())
    );
    if (rows.length < 8) continue;
    let heading = '', el = t;
    for (let i = 0; i < 6 && el; i++) {
      el = el.previousElementSibling;
      if (el && el.innerText && el.innerText.trim()) { heading = el.innerText.trim().slice(0, 80); break; }
    }
    out.push({ heading, rows });
  }
  return out;
})()
"""


def clean_team(raw):
    s = (raw or "").replace("\u00a0", " ").strip()
    s = re.sub(r"\s*\(\d+\)\s*$", "", s)          # first-place votes
    s = re.sub(r"^\d+\s+", "", s)                  # stray leading rank
    return s.strip()


def _dedupe(rows):
    seen, out = set(), []
    for r in sorted(rows, key=lambda x: x["rank"]):
        key = r["team"].lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def parse_committee(tables):
    rows = []
    for t in tables:
        for cells in t["rows"]:
            if len(cells) < 3:
                continue
            for i, c in enumerate(cells):
                if re.fullmatch(r"\d{1,2}", c or ""):
                    team = clean_team(cells[i + 1]) if i + 1 < len(cells) else ""
                    if not team or team.lower().startswith(("team", "rank")):
                        break
                    rows.append({
                        "rank": int(c), "team": team,
                        "record": cells[i + 2] if i + 2 < len(cells) else "", "extra": "",
                    })
                    break
    return _dedupe(rows)


def parse_rpi(tables):
    rows = []
    for t in tables:
        for cells in t["rows"]:
            if len(cells) < 3 or not re.fullmatch(r"\d{1,3}", cells[0] or ""):
                continue
            rows.append({
                "rank": int(cells[0]),
                "team": clean_team(cells[1]),
                "record": cells[2],
                "extra": cells[3] if len(cells) > 3 else "",
            })
    return _dedupe(rows)


def parse_usila(tables):
    """usila.org prints D1, D2 and D3 polls; keep only the Division I table."""
    rows = []
    for t in tables:
        if not re.search(r"division\s+i\b", t["heading"], re.I):
            continue
        for cells in t["rows"]:
            if len(cells) < 2:
                continue
            team = clean_team(cells[0])
            if not team or team.lower().startswith(("team", "rank", "others", "receiving")):
                continue
            if not re.fullmatch(r"\d{1,2}", cells[1] or ""):
                continue
            pts = cells[2] if len(cells) > 2 else ""
            rows.append({
                "rank": int(cells[1]), "team": team, "record": "",
                "extra": f"{pts} pts" if re.fullmatch(r"\d+", pts or "") else "",
            })
    return _dedupe(rows)


PARSERS = {"committee": parse_committee, "rpi": parse_rpi, "usila": parse_usila}


async def fetch(key, cfg):
    """-> (rows, edition label) for one poll."""
    page = await cdp.open_page()
    try:
        await page.goto(cfg["url"], wait=5)
        tables, rows = [], []
        for _ in range(8):
            tables = await page.eval(EXTRACT) or []
            rows = PARSERS[key](tables)
            if len(rows) >= 8:
                break
            await asyncio.sleep(1.5)
        label = cfg["label"]
        if key == "usila":
            heading = next(
                (t["heading"] for t in tables if re.search(r"division\s+i\b", t["heading"], re.I)), ""
            )
            if heading:
                label = f"{cfg['label']} · {heading.title()}"
        return rows, label
    finally:
        await page.ws.close()


async def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    polls = []
    for key, cfg in SOURCES.items():
        if only and key != only:
            continue
        try:
            rows, label = await fetch(key, cfg)
        except Exception as e:
            print(f"! {key}: {e}")
            continue
        if not rows:
            print(f"! {key}: no rows rendered")
            continue
        print(f"+ {key}: {len(rows)} teams · top {rows[0]['rank']}. {rows[0]['team']}")
        polls.append({"key": key, "source": label, "rows": rows})

    if not polls:
        print("nothing fetched — leaving existing files untouched")
        return 1

    today = date.today().isoformat()
    for p in polls:
        p["fetched"] = today

    with open(OUT, "w") as f:
        json.dump({"fetched": today, "polls": polls}, f, separators=(",", ":"))

    history = []
    if os.path.exists(HISTORY):
        try:
            history = json.load(open(HISTORY))
        except Exception:
            history = []
    for p in polls:
        history = [h for h in history if not (h.get("key") == p["key"] and h.get("fetched") == today)]
        history.append({"key": p["key"], "source": p["source"], "fetched": today, "rows": p["rows"]})
    history.sort(key=lambda h: (h.get("fetched", ""), h.get("key", "")))
    with open(HISTORY, "w") as f:
        json.dump(history, f, separators=(",", ":"))

    print(f"wrote {OUT} ({len(polls)} polls) and {HISTORY} ({len(history)} snapshots)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
