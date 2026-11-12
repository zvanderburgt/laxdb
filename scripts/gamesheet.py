"""GameSheet Stats API client (gamesheetstats.com).

The public stats site is a Next.js app over an open JSON API. The HTML pages are
behind a bot check, but `/api/*` is not — and the responses carry everything the
site renders: player bios (birthdate, hometown, height, weight, jersey), photos,
team logos and per-season stat lines.

  from gamesheet import GameSheet
  gs = GameSheet()
  leagues = gs.leagues()                 # id -> {title, active_season}
  seasons = gs.seasons(league_id)        # [{id, title, sport, start, end}]
  rows = gs.players(season_id)           # every player in that season

Every response is cached under scripts/.cache/gs so a re-run costs nothing.
Politeness: one request at a time with a delay, and a normal browser UA.
"""
from __future__ import annotations

import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, ".cache", "gs")
BASE = "https://gamesheetstats.com"
LEAGUE_ID_LIMIT = 600  # ids observed 1..~470

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE + "/",
}


def norm(text: str) -> str:
    """Loose comparison key: case, accents, punctuation and suffixes removed."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("★", " ").lower()
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_height(value: str) -> int:
    """"5'11\\"" / "5’10”" / "6-2" -> inches."""
    if not value:
        return 0
    m = re.search(r"(\d)\s*['’\u2032\-\s]\s*(\d{1,2})?", str(value))
    if not m:
        return 0
    feet = int(m.group(1))
    inches = int(m.group(2) or 0)
    return feet * 12 + inches


def parse_weight(value: str) -> int:
    m = re.search(r"(\d{2,3})", str(value or ""))
    return int(m.group(1)) if m else 0


class GameSheet:
    def __init__(self, cache_dir: str = CACHE, delay: float = 0.15, refresh: bool = False):
        self.cache_dir = cache_dir
        self.delay = delay
        self.refresh = refresh
        os.makedirs(cache_dir, exist_ok=True)
        self._last = 0.0

    # ---------------------------------------------------------------- plumbing
    def _get(self, path: str, retries: int = 3) -> dict | None:
        url = BASE + path
        for attempt in range(retries):
            since = time.time() - self._last
            if since < self.delay:
                time.sleep(self.delay - since)
            self._last = time.time()
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=45) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                if e.code in (429, 502, 503, 504):
                    time.sleep(2 * (attempt + 1))
                    continue
                return None
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
                time.sleep(1 + attempt)
        return None

    def _cached(self, name: str, loader):
        path = os.path.join(self.cache_dir, name + ".json")
        if os.path.exists(path) and not self.refresh:
            with open(path) as f:
                return json.load(f)
        value = loader()
        if value is not None:
            with open(path, "w") as f:
                json.dump(value, f)
        return value

    # ------------------------------------------------------------------- reads
    def league(self, league_id: int) -> dict | None:
        def load():
            payload = self._get(f"/api/leagues/{league_id}")
            data = (payload or {}).get("data") or []
            return data[0] if data else None

        return self._cached(f"league-{league_id}", load)

    def leagues(self, limit: int = LEAGUE_ID_LIMIT) -> dict[int, dict]:
        """Scan the id space once. GameSheet has no league index endpoint."""
        index: dict[int, dict] = {}
        for league_id in range(1, limit + 1):
            row = self.league(league_id)
            if row and row.get("title"):
                index[league_id] = row
        return index

    def seasons(self, league_id: int) -> list[dict]:
        def load():
            payload = self._get(f"/api/leagues/{league_id}/seasons")
            return (payload or {}).get("data") or []

        return self._cached(f"seasons-{league_id}", load) or []

    def season_info(self, season_id: int) -> dict | None:
        def load():
            payload = self._get(f"/api/season-info/{season_id}")
            data = (payload or {}).get("data") or []
            return data[0] if data else None

        return self._cached(f"season-info-{season_id}", load)

    def players(self, season_id: int, limit: int = 5000) -> list[dict]:
        """Every player in a season. `limit` is required — default is 20."""

        def load():
            payload = self._get(f"/api/players/standings/{season_id}?limit={limit}")
            return (payload or {}).get("data") or []

        return self._cached(f"players-{season_id}", load) or []

    # ------------------------------------------------------------------ assets
    def download(self, url: str, dest: str) -> bool:
        """Fetch an image (CDN hosts differ from the API host and are open)."""
        if not url or os.path.exists(dest):
            return os.path.exists(dest)
        # Cloudflare Images needs a variant on the path; the API hands back the bare
        # image id and "/public" is the default one that serves
        if "imagedelivery.net" in url and url.count("/") <= 5:
            url = url.rstrip("/") + "/public"
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=45) as r:
                body = r.read()
            if len(body) < 512:
                return False
            with open(dest, "wb") as f:
                f.write(body)
            return True
        except Exception:  # noqa: BLE001
            return False


def team_titles(row: dict) -> list[str]:
    return [t.get("title") or "" for t in (row.get("teams") or [])]


def full_name(row: dict) -> str:
    return f"{row.get('firstName','')} {row.get('lastName','')}".strip()


if __name__ == "__main__":
    gs = GameSheet()
    leagues = gs.leagues()
    print(f"{len(leagues)} leagues indexed")
    for lid, row in list(leagues.items())[:5]:
        print(" ", lid, row.get("title"))
