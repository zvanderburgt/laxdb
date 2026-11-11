#!/usr/bin/env python3
"""
NCAA poll rankings — the one source that needs a real browser.

ncaa.com renders its rankings table client-side, so plain HTTP returns an empty
table and Inside Lacrosse 403s. This drives the bundled Chromium through cdp.py,
reads the rendered rows, and writes public/rankings.json for the importer to merge.

Usage: python3 scripts/fetch-rankings.py [--division d1]
"""
import asyncio, json, os, re, sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "rankings.json")
DIVISION = "d1"
if "--division" in sys.argv:
    DIVISION = sys.argv[sys.argv.index("--division") + 1]

URL = f"https://www.ncaa.com/rankings/lacrosse-men/{DIVISION}"

EXTRACT = """
(() => {
  const out = [];
  const seen = new Set();
  for (const table of document.querySelectorAll('table')) {
    for (const tr of table.querySelectorAll('tr')) {
      const c = [...tr.querySelectorAll('th,td')].map(x => x.innerText.trim());
      if (c.length < 3) continue;
      const rank = parseInt(c[0], 10);
      if (!Number.isFinite(rank)) continue;
      const key = rank + '|' + c[1];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ rank, team: c[1], record: c[2] || '' });
    }
  }
  return out;
})()
"""


async def main():
    page = await cdp.open_page()
    await page.goto(URL, wait=2.0)
    rows = []
    for _ in range(14):
        rows = await page.eval(EXTRACT) or []
        if len(rows) >= 5:
            break
        await asyncio.sleep(1.5)
    title = await page.eval("document.title")
    await page.ws.close()

    if not rows:
        print("! no ranking rows rendered — leaving the existing file untouched")
        return 1

    source = re.sub(r"^DI Men's Lacrosse Rankings\s*-\s*", "", title or "").strip()
    source = re.sub(r"\s*\|\s*NCAA\.com$", "", source)
    payload = {
        "source": source or "NCAA rankings",
        "division": DIVISION,
        "fetched": date.today().isoformat(),
        "rows": rows,
    }
    with open(OUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(rows)} ranked teams · {payload['source']}")
    print("  top:", ", ".join(f"{r['rank']}. {r['team']}" for r in rows[:4]))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
