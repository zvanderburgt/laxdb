#!/usr/bin/env python3
"""
Fill in missing team logos for the D1 programs added in the 71-school expansion.

The importer only records a logo when the school's stats page already carries one in a
shape it recognises; several of the newer sites put the mark in an og:image tag or in a
header <img>. This walks those pages, saves a 120x120 webp and patches data.json in place,
so it never needs a full re-import.

Usage: python3 scripts/fetch-logos.py [--dry]
"""
import importlib.util, io, json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
DRY = "--dry" in sys.argv

spec = importlib.util.spec_from_file_location("imp", os.path.join(ROOT, "scripts", "fetch-real-data.py"))
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)
try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required for logo conversion")


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("content-type", "")


def candidates(html, base):
    """Logo URLs from the page, best first."""
    out = []

    for m in re.finditer(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', html, re.I):
        out.append(m.group(1))
    for m in re.finditer(r'<img[^>]+src=["\']([^"\']*(?:logo|mark|crest)[^"\']*)["\']', html, re.I):
        src = m.group(1)
        if any(bad in src.lower() for bad in ("sponsor", "advert", "partner", "learfield", "nike")):
            continue
        out.append(src)

    # rank: a primary school mark first, and never the NCAA/footer furniture
    def score(url):
        u = url.lower()
        s = 0
        if re.search(r"logo[_-]?main|primary[_-]?logo|logo[_-]primary", u):
            s += 10
        if "footer" in u:
            s -= 12
        if "wordmark" in u:
            s -= 4
        if "ncaa" in u:
            s -= 10
        if "sponsor" in u or "partner" in u:
            s -= 15
        if u.endswith(".png") or u.endswith(".jpg") or u.endswith(".webp"):
            s += 3          # Pillow cannot open SVG, so a raster is worth more
        return s

    out.sort(key=score, reverse=True)

    resolved = []
    for url in out:
        if url.startswith("//"):
            url = "https:" + url
        elif url.startswith("/"):
            url = base.rstrip("/") + url
        if url.startswith("http") and url not in resolved:
            resolved.append(url)
    return resolved


def save(data, rel_path, size=(120, 120)):
    try:
        img = Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception:
        return False
    # trim transparency then square-crop the mark
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    side = max(img.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    canvas = canvas.resize(size, Image.LANCZOS)
    path = os.path.join(ROOT, "public", rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    canvas.save(path, "WEBP", quality=86, method=6)
    return True



def rasterise(pairs, viewport=240):
    """Screenshot SVG marks in headless Chromium; Pillow cannot open them itself."""
    import asyncio, base64, sys as _sys

    _sys.path.insert(0, os.path.join(ROOT, "scripts"))
    import cdp

    async def _():
        out = []
        page = None
        try:
            page = await cdp.open_page()
            await page.send("Emulation.setDeviceMetricsOverride", width=viewport, height=viewport,
                            deviceScaleFactor=2, mobile=False)
            for team, url in pairs:
                try:
                    await page.send("Page.enable")
                    await page.send("Page.navigate", url=url)
                    await asyncio.sleep(0.8)
                    shot = await page.send("Page.captureScreenshot", format="png", omitBackground=True)
                    blob = base64.b64decode(shot["data"])
                    out.append((team, blob))
                except Exception as e:
                    print(f"  ! {team['name']}: {str(e)[:60]}")
        finally:
            if page is not None:
                await page.ws.close()
        return out

    return asyncio.run(_())


def main():
    payload = json.load(open(DATA))
    domains = {}
    for row in imp.SCHOOLS:
        name, domain = row[0], row[1]
        domains[name] = domain

    missing = [t for t in payload["teams"] if t["leagueId"] == "ncaa-d1" and not t.get("logo")]
    print(f"{len(missing)} D1 teams without a logo")
    added = 0
    svg_queue = []
    for team in missing:
        domain = domains.get(team["name"])
        if not domain:
            print(f"  ? {team['name']}: no domain on file")
            continue
        html = ""
        for path in ("/sports/mens-lacrosse/stats/2026", "/sports/mens-lacrosse", "/"):
            try:
                raw, ctype = get("https://" + domain + path)
                if "html" in ctype:
                    html = raw.decode("utf-8", "ignore")
                    break
            except Exception:
                continue
        if not html:
            print(f"  ! {team['name']}: page unreachable")
            continue

        urls = candidates(html, "https://" + domain)
        # Sidearm serves the same mark as .png more often than not; a raster is easier to
        # convert than an svg, so try the swap first.
        for url in list(urls):
            if url.lower().endswith(".svg"):
                urls.append(url[:-4] + ".png")

        for url in urls[:6]:
            try:
                blob, ctype = get(url)
            except Exception:
                continue
            if url.lower().endswith(".svg") or "svg" in ctype:
                svg_queue.append((team, url))
                break
            if "image" not in ctype and not url.lower().endswith((".png", ".jpg", ".svg", ".webp")):
                continue
            rel = f"logos/{team['slug']}.webp"
            if DRY:
                print(f"  · {team['name']} -> {url}")
                added += 1
                break
            if save(blob, rel):
                team["logo"] = rel
                added += 1
                print(f"  + {team['name']} <- {url.rsplit('/', 1)[-1]}")
                break

    if svg_queue and not DRY:
        print(f"rasterising {len(svg_queue)} svg marks…")
        for team, blob in rasterise(svg_queue):
            rel = f"logos/{team['slug']}.webp"
            if save(blob, rel):
                team["logo"] = rel
                added += 1

    if not DRY and added:
        with open(DATA, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
    print(f"{'would add' if DRY else 'added'} {added} logos")


if __name__ == "__main__":
    main()
