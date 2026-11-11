#!/usr/bin/env python3
"""
Minimal CDP driver: launch headless Chrome, evaluate JS in a page, read results.
No Playwright/Selenium — just the DevTools protocol over a websocket.

Used by the digitalshift crawler (scripts/crawl-junior.py) to talk to the league
platform from inside an allowed origin, and to scrape rendered pages when the
API is unavailable.

CLI:
  python3 scripts/cdp.py "https://example.com" "document.title"
  python3 scripts/cdp.py --json "https://example.com" "Array.from(document.querySelectorAll('tr')).length"
"""
import asyncio, json, os, subprocess, sys, time, urllib.request

CHROME = "/opt/hermes/tools/chromium-1208/chrome-linux64/chrome"
PORT = int(os.environ.get("CDP_PORT", "9333"))
PROFILE = f"/tmp/laxdb-chrome-{PORT}"

_proc = None


def launch():
    global _proc
    if _proc and _proc.poll() is None:
        return
    os.makedirs(PROFILE, exist_ok=True)
    args = [
        CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
        f"--user-data-dir={PROFILE}", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
        "--window-size=1440,1000", "about:blank",
    ]
    _proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1).read()
            return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("chrome did not start")


class Page:
    """One tab, a persistent websocket, and eval()."""

    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def send(self, method, **params):
        self.n += 1
        mid = self.n
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    async def eval(self, expr, timeout=30):
        r = await self.send(
            "Runtime.evaluate", expression=expr, returnByValue=True,
            awaitPromise=True, timeout=timeout * 1000,
        )
        if r.get("exceptionDetails"):
            raise RuntimeError(str(r["exceptionDetails"].get("exception", {}).get("description"))[:300])
        return r.get("result", {}).get("value")

    async def goto(self, url, wait=2.0):
        await self.send("Page.enable")
        await self.send("Page.navigate", url=url)
        await asyncio.sleep(wait)
        return await self.eval("document.readyState")


async def open_page(url=None, wait=2.0):
    import websockets

    launch()
    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))
    page = next((t for t in targets if t.get("type") == "page"), None)
    if page is None:
        targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/new?about:blank"))
        page = targets
    ws = await websockets.connect(page["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024)
    p = Page(ws)
    if url:
        await p.goto(url, wait)
    return p


def run_sync(url, expr, wait=2.0):
    async def _():
        p = await open_page(url, wait)
        try:
            return await p.eval(expr)
        finally:
            await p.ws.close()
    return asyncio.run(_())


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--json"]
    url, expr = args[0], args[1]
    wait = float(args[2]) if len(args) > 2 else 2.0
    result = run_sync(url, expr, wait)
    if isinstance(result, (dict, list)):
        print(json.dumps(result, indent=1)[:4000])
    else:
        print(result)
