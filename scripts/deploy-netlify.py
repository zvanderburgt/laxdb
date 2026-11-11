#!/usr/bin/env python3
"""
Deploy dist/ to Netlify over the API (no interactive CLI prompts).

Auth: NETLIFY_AUTH_TOKEN in the environment, or the token the Netlify CLI
stores at ~/.netlify/config.json after `netlify login`.

Usage:
  python3 scripts/deploy-netlify.py                # deploy to the site in .netlify/state.json
  python3 scripts/deploy-netlify.py --create laxdb # create (or reuse) a site named laxdb
"""
import io, json, os, sys, time, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.netlify.com/api/v1"
NAME_CANDIDATES = ["laxdb", "laxdb-stats", "laxdb-lacrosse", "laxdb-database"]


def token():
    t = os.environ.get("NETLIFY_AUTH_TOKEN")
    if t:
        return t.strip()
    for cfg in (os.path.expanduser("~/.config/netlify/config.json"),
                os.path.expanduser("~/.netlify/config.json")):
        if os.path.exists(cfg):
            data = json.load(open(cfg))
            users = data.get("users") or {}
            for u in users.values():
                tok = (u.get("auth") or {}).get("token")
                if tok:
                    return tok
    sys.exit("No Netlify token. Run `netlify login` or set NETLIFY_AUTH_TOKEN.")


TOKEN = token()


def api(method, path, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(
        API + path, data=data, method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": ctype, "User-Agent": "laxdb-deploy"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            payload = r.read()
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        return {"error": e.code, "body": e.read().decode()[:400]}


def zip_dist():
    dist = os.path.join(ROOT, "dist")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, _, files in os.walk(dist):
            for f in files:
                full = os.path.join(base, f)
                z.write(full, os.path.relpath(full, dist))
    return buf.getvalue()


def find_or_create_site(name=None):
    # existing state file wins (idempotent re-deploys)
    state = os.path.join(ROOT, ".netlify", "state.json")
    if os.path.exists(state) and not name:
        sid = json.load(open(state)).get("siteId")
        if sid:
            return sid

    sites = api("GET", "/sites?per_page=100")
    if isinstance(sites, list):
        for s in sites:
            if s.get("name") in NAME_CANDIDATES:
                return s["id"]

    accounts = api("GET", "/accounts")
    account = accounts[0]["slug"] if isinstance(accounts, list) and accounts else None

    candidates = [name] if name else NAME_CANDIDATES
    for cand in candidates:
        body = {"name": cand}
        if account:
            body["account_slug"] = account
        res = api("POST", "/sites", body)
        if res.get("id"):
            print(f"created site: {res.get('name')} ({res['id']})")
            return res["id"]
        print(f"  ! name {cand} rejected: {res.get('error')} {res.get('body','')[:120]}")
    sys.exit("Could not create a site.")


def main():
    site_id = find_or_create_site("laxdb" if "--create" in sys.argv else None)
    payload = zip_dist()
    print(f"uploading {len(payload)/1e6:.1f} MB zip…")
    dep = api("POST", f"/sites/{site_id}/deploys", raw=payload, ctype="application/zip")
    if not dep.get("id"):
        sys.exit(f"deploy failed: {dep}")
    dep_id = dep["id"]
    for _ in range(90):
        d = api("GET", f"/sites/{site_id}/deploys/{dep_id}")
        state = d.get("state")
        if state in ("ready", "current"):
            print(f"deploy {state}: {d.get('ssl_url') or d.get('url')}")
            os.makedirs(os.path.join(ROOT, ".netlify"), exist_ok=True)
            json.dump({"siteId": site_id}, open(os.path.join(ROOT, ".netlify", "state.json"), "w"))
            return
        if state == "error":
            sys.exit(f"deploy error: {d}")
        time.sleep(2)
    sys.exit("deploy timed out")


if __name__ == "__main__":
    main()
