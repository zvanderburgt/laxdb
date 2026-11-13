#!/usr/bin/env python3
"""
Deploy dist/ to Netlify over the API (no interactive CLI prompts).

Auth: NETLIFY_AUTH_TOKEN in the environment, or the token the Netlify CLI
stores at ~/.netlify/config.json after `netlify login`.

Usage:
  python3 scripts/deploy-netlify.py                # deploy to the site in .netlify/state.json
  python3 scripts/deploy-netlify.py --draft        # same, but as a draft: returns a preview URL and
                                                   # leaves the live site on its current deploy
  python3 scripts/deploy-netlify.py --create laxdb # create (or reuse) a site named laxdb
"""
import io, json, os, subprocess, sys, time, urllib.request, zipfile

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


def deploy_via_cli(site_id, draft):
    """
    Site + functions in one deploy, through the Netlify CLI.

    A plain zip upload cannot carry a Functions v2 module: the API publishes a
    `netlify/functions/*.mjs` inside the zip as a static file (it lands at
    /netlify/functions/api.mjs and /api/* 404s, with available_functions still []). The CLI uploads
    the function properly, so it is the supported path whenever the API is part of the build.
    """
    cli = os.path.join(ROOT, "node_modules", ".bin", "netlify")
    fns = os.path.join(ROOT, "netlify", "functions-build")
    if not os.path.exists(cli) or not os.path.isdir(fns):
        return None
    cmd = [cli, "deploy", "--dir", "dist", "--functions", fns, "--site", site_id, "--json"]
    if not draft:
        cmd.append("--prod")
    env = dict(os.environ, NETLIFY_AUTH_TOKEN=TOKEN, NETLIFY_SITE_ID=site_id)
    print(f"deploying site + admin API with the Netlify CLI ({'draft' if draft else 'production'})…")
    proc = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True, timeout=900)
    out = proc.stdout or ""
    if proc.returncode != 0:
        print((proc.stderr or out)[-1500:])
        sys.exit("cli deploy failed")
    try:
        payload = json.loads(out[out.index("{"): out.rindex("}") + 1])
    except Exception:
        print(out[-1500:])
        sys.exit("could not read the cli deploy output")
    url = payload.get("deploy_url") or payload.get("url")
    print(f"deploy ready: {url}")
    print(f"  {'live site unchanged (draft)' if draft else 'published'}")
    return url


def smoke(url):
    """The API is the one part of a deploy that fails silently: check it answered."""
    probe = (url or "").rstrip("/") + "/api/session"
    req = urllib.request.Request(probe, headers={"User-Agent": "laxdb-deploy"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            code, body = r.status, r.read(200)
    except urllib.error.HTTPError as e:
        code, body = e.code, e.read(200)
    except Exception as e:
        print(f"  ! api smoke test could not reach {probe}: {e}")
        return False
    ok = code == 401
    print(f"  {'ok' if ok else '!'} GET /api/session → {code} (want 401) {body[:80].decode(errors='replace')}")
    return ok


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
    # --draft builds a deploy you can open and share without publishing it: it gets its
    # own deploy URL and the live site keeps serving the current production deploy.
    draft = "--draft" in sys.argv

    url = deploy_via_cli(site_id, draft)
    if url:
        if not smoke(url) and not draft:
            sys.exit("admin API missing from a production deploy — /api/* is not routed")
        return

    payload = zip_dist()
    print(f"uploading {len(payload)/1e6:.1f} MB zip…" + (" (draft)" if draft else ""))
    qs = "?draft=true" if draft else ""
    dep = api("POST", f"/sites/{site_id}/deploys{qs}", raw=payload, ctype="application/zip")
    if not dep.get("id"):
        sys.exit(f"deploy failed: {dep}")
    dep_id = dep["id"]
    for _ in range(90):
        d = api("GET", f"/sites/{site_id}/deploys/{dep_id}")
        state = d.get("state")
        if state in ("ready", "current"):
            url = (
                d.get("deploy_ssl_url")
                or d.get("deploy_url")
                or d.get("ssl_url")
                or d.get("url")
            )
            print(f"deploy {state}: {url}")
            print(f"  live site: {d.get('ssl_url') or d.get('url')}")
            os.makedirs(os.path.join(ROOT, ".netlify"), exist_ok=True)
            json.dump({"siteId": site_id}, open(os.path.join(ROOT, ".netlify", "state.json"), "w"))
            if not smoke(url) and not draft:
                sys.exit("admin API missing from a production deploy — /api/* is not routed")
            return
        if state == "error":
            sys.exit(f"deploy error: {d}")
        time.sleep(2)
    sys.exit("deploy timed out")


if __name__ == "__main__":
    main()
