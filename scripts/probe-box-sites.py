#!/usr/bin/env python3
"""Recon: which box-league sites publish player bios?

For each league we hold with no bio source, try the league site and each club's roster
page, then count the markers a bio would leave behind. Prints one line per site so the
next step is obvious: scrape it, or write it off in docs/deferred-sources.md.
"""
from __future__ import annotations

import re
import urllib.request
from urllib.parse import urljoin

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0 Safari/537.36 LAXDB/1.0"}
MARKERS = ("hometown", "height", "weight", "born", "birthdate", "position")


def get(url: str, timeout: int = 20) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.getcode(), r.read().decode("utf-8", "ignore")
    except Exception as exc:  # noqa: BLE001
        return 0, f"{type(exc).__name__}: {exc}"


def markers(html: str) -> dict[str, int]:
    low = html.lower()
    return {m: low.count(m) for m in MARKERS}


def roster_links(html: str, base: str) -> list[str]:
    out = []
    for href in re.findall(r'href="([^"]+)"', html):
        if re.search(r"roster|team|player", href, re.I):
            url = urljoin(base, href)
            if url not in out:
                out.append(url)
    return out[:4]


SITES = {
    "BCJALL (BC Junior A)": "https://www.bcjall.com/",
    "WCJLL (West Coast Jr)": "https://www.wcjll.com/",
    "TOJLL (Thompson Okanagan)": "https://www.tojll.com/",
    "PNWJLL (Pacific NW Jr)": "https://www.pnwjll.com/",
    "RMLL (Rocky Mountain)": "https://www.rmll.ca/",
    "WLA (Western Lacrosse Assoc)": "https://www.wla.ca/",
}


def main():
    for label, url in SITES.items():
        code, html = get(url)
        if not code:
            print(f"{label:<30} {html[:60]}")
            continue
        m = markers(html)
        print(f"{label:<30} {code} {len(html):>7}b  markers={m}")
        for link in roster_links(html, url):
            c2, h2 = get(link)
            if not c2:
                continue
            m2 = markers(h2)
            if m2["hometown"] or m2["height"] or m2["weight"]:
                print(f"    {link[:78]:<80} {c2} {m2}")


if __name__ == "__main__":
    main()
