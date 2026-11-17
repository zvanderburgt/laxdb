"""HTTP transport shared by the importer scripts.

Why this module exists
----------------------
Bot walls fingerprint the **TLS handshake**, not the User-Agent header. A plain
`urllib` request with a perfect browser UA is still refused by Cloudflare with a
403 `Just a moment...`, while the same URL fetches fine from Chrome — the client
hello (cipher order, extensions, ALPN) gives it away.

`curl_cffi` reproduces Chromium's fingerprint from Python, which is enough for
every source we use:

    Tested 2026-11-17 from this host, urllib vs curl_cffi (chrome):
      gamesheetstats.com /api/*                 403 Turnstile  ->  200 JSON
      gamesheetstats.com /seasons/../teams/../roster   403     ->  200 HTML table
        (the rendered table carries SH = Left/Right handedness, DOB, HT, WT,
         BIRTHPLACE — the columns that used to require a page saved by hand)
      sidearm / netfront / mcla / usila / ncaa / espn / wikipedia   200 -> 200
      digitalshift, PLL                          unchanged (auth/URL, not transport)

So only the GameSheet client needs it; everything else keeps its own helper and
could adopt this module later without behaviour change.

The fallback matters: `curl_cffi` lives in `scripts/.pylibs` (installed with
`python3 -m pip install --target scripts/.pylibs curl_cffi`, gitignored) because
the system interpreter's site-packages is not writable. When the import fails —
a bare checkout, a different machine — every function here degrades to urllib,
so scripts keep working and only GameSheet loses access.
"""
from __future__ import annotations

import json as _json
import os
import ssl
import sys
import urllib.error
import urllib.request

_HERE = os.path.dirname(os.path.abspath(__file__))
_VENDOR = os.path.join(_HERE, ".pylibs")
if os.path.isdir(_VENDOR) and _VENDOR not in sys.path:
    sys.path.insert(0, _VENDOR)

try:  # optional: the fingerprinting transport
    from curl_cffi import requests as _cr

    HAVE_CURL_CFFI = True
except Exception:  # pragma: no cover - depends on the checkout
    _cr = None
    HAVE_CURL_CFFI = False

DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
IMPERSONATE = os.environ.get("LAXDB_IMPERSONATE", "chrome")


class HTTPStatusError(Exception):
    """Raised by `.raise_for_status()`; mirrors requests' shape."""

    def __init__(self, status: int, url: str):
        super().__init__(f"HTTP {status} for {url}")
        self.code = status  # urllib.error.HTTPError spells it `.code`


class Response:
    """The small slice of `requests.Response` the scripts actually use."""

    __slots__ = ("status_code", "content", "url", "headers")

    def __init__(self, status_code: int, content: bytes, url: str, headers=None):
        self.status_code = status_code
        self.content = content or b""
        self.url = url
        self.headers = headers or {}

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 400

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", "ignore")

    def json(self):
        return _json.loads(self.content)

    def raise_for_status(self) -> "Response":
        if self.status_code >= 400:
            raise HTTPStatusError(self.status_code, self.url)
        return self


_SSL_CTX = None


def _urllib_request(url, method="GET", headers=None, data=None, timeout=30) -> Response:
    """Fallback path: same return shape, no TLS impersonation."""
    global _SSL_CTX
    hdrs = {"User-Agent": DEFAULT_UA, "Accept": "*/*"}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, headers=hdrs, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return Response(r.status, r.read(), r.geturl(), dict(r.headers))
    except urllib.error.HTTPError as e:  # a real response, not a transport failure
        return Response(e.code, e.read() or b"", url, dict(e.headers or {}))


def fetch(url, method="GET", headers=None, data=None, timeout=30,
          impersonate=IMPERSONATE, session=None) -> Response:
    """GET/POST `url` with a Chrome TLS fingerprint; never raises on 4xx/5xx."""
    if session is not None:
        r = session.request(method, url, headers=headers, data=data, timeout=timeout)
        return Response(r.status_code, r.content, str(r.url), dict(r.headers or {}))
    if HAVE_CURL_CFFI:
        r = _cr.request(method, url, headers=headers, data=data, timeout=timeout,
                        impersonate=impersonate, allow_redirects=True)
        return Response(r.status_code, r.content, str(r.url), dict(r.headers or {}))
    return _urllib_request(url, method=method, headers=headers, data=data, timeout=timeout)


def get(url, **kw) -> Response:
    return fetch(url, method="GET", **kw)


def post(url, data=None, **kw) -> Response:
    if isinstance(data, (dict, list)):
        data = _json.dumps(data).encode()
        kw.setdefault("headers", {})
        kw["headers"] = {"Content-Type": "application/json", **kw["headers"]}
    return fetch(url, method="POST", data=data, **kw)


class Session:
    """Connection/cookie reuse. Warm it on a page before asking for a sibling URL.

    GameSheet player pages answer 403 to a cold request but 200 once the session
    has loaded a roster page and sends that page as `Referer`.
    """

    def __init__(self, impersonate=IMPERSONATE):
        self.impersonate = impersonate
        self._s = _cr.Session(impersonate=impersonate) if HAVE_CURL_CFFI else None

    def request(self, method, url, headers=None, data=None, timeout=30):
        if self._s is not None:
            return self._s.request(method, url, headers=headers, data=data,
                                   timeout=timeout, allow_redirects=True)
        return _urllib_request(url, method=method, headers=headers, data=data, timeout=timeout)

    def get(self, url, **kw) -> Response:
        kw.setdefault("timeout", 30)
        r = self.request("GET", url, **kw)
        return Response(r.status_code, r.content, str(r.url), dict(r.headers or {}))

    def post(self, url, data=None, **kw) -> Response:
        kw.setdefault("timeout", 30)
        if isinstance(data, (dict, list)):
            data = _json.dumps(data).encode()
            kw["headers"] = {"Content-Type": "application/json", **(kw.get("headers") or {})}
        r = self.request("POST", url, data=data, **kw)
        return Response(r.status_code, r.content, str(r.url), dict(r.headers or {}))


if __name__ == "__main__":  # tiny self-check: python3 scripts/netget.py <url>
    target = sys.argv[1] if len(sys.argv) > 1 else "https://gamesheetstats.com/api/leagues/300680"
    print("curl_cffi:", HAVE_CURL_CFFI, "| vendor dir:", _VENDOR)
    res = get(target, headers={"Accept": "*/*"})
    print(res.status_code, len(res.content), res.url)
    print(res.text[:200].replace("\n", " "))
