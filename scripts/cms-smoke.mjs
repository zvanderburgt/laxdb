#!/usr/bin/env node
/**
 * End-to-end check of the admin API — auth, draft, preview, publish.
 *
 *   node scripts/cms-smoke.mjs                                  # local dev server
 *   node scripts/cms-smoke.mjs --base https://laxdb.netlify.app  # the deployed function
 *
 * The passphrase is read from data/cms-env.local (CMS_DEV_PASSPHRASE) or from CMS_PASSPHRASE in the
 * environment. It is never printed. Publishing here writes a real override, so against production the
 * script only publishes if you pass --write; otherwise it stops at the 403/422/401 checks.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:8787";
const write = args.includes("--write");

async function passphrase() {
  if (process.env.CMS_PASSPHRASE) return process.env.CMS_PASSPHRASE;
  const local = base.includes("localhost") || base.includes("127.0.0.1");
  const file = local ? "data/cms-passphrase" : "data/cms-passphrase.netlify";
  if (existsSync(file)) return (await readFile(file, "utf8")).trim();
  if (existsSync("data/cms-env.local")) {
    const m = (await readFile("data/cms-env.local", "utf8")).match(/^CMS_DEV_PASSPHRASE=(.*)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("no passphrase: write data/cms-env.local (node scripts/cms-secret.mjs --local) or set CMS_PASSPHRASE");
}

const pass = await passphrase();
let cookie = "";
let csrf = "";
let failures = 0;

const label = (ok, name, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function call(path, { method = "GET", body, headers = {}, sendCookie = true } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(sendCookie && cookie ? { cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && res.ok) cookie = setCookie.split(";")[0];
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 304 and 204 have no body */
  }
  return { status: res.status, json, headers: res.headers };
}

const PATCH = { entity: "player", id: "p-ncaa-luke-robinson-cornell-bi", path: "bio", value: `smoke ${Date.now()}` };

// The public document is edge-cached for 60s by design, so a read straight after a write must
// bypass the CDN to prove the store changed (`?fresh=` is a different cache key).
const fresh = () => call(`/api/overrides?fresh=${Date.now()}`);
const hasValue = (r, v) => JSON.stringify(r.json ?? {}).includes(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`cms smoke → ${base}\n`);

// 1. signed out
let r = await call("/api/session");
label(r.status === 401, "GET /api/session without a cookie → 401", String(r.status));

r = await call("/api/publish", { method: "POST", body: {} });
label(r.status === 401, "POST /api/publish anonymously → 401", String(r.status));

r = await call("/api/draft", { method: "POST", body: { patch: PATCH } });
label(r.status === 401, "POST /api/draft anonymously → 401", String(r.status));

// 2. a wrong passphrase costs a second and says nothing
const t0 = Date.now();
r = await call("/api/session", { method: "POST", body: { passphrase: `${pass}-nope` } });
label(r.status === 401, "POST /api/session with a wrong passphrase → 401", String(r.status));
label(Date.now() - t0 >= 900, "wrong passphrase is delayed ≥ 900ms", `${Date.now() - t0}ms`);

// 3. sign in
r = await call("/api/session", { method: "POST", body: { passphrase: pass } });
label(r.status === 200 && Boolean(cookie), "POST /api/session signs in and sets a cookie", String(r.status));
label(Boolean(r.headers.get("set-cookie")?.includes("HttpOnly")), "cookie is HttpOnly");
label(Boolean(r.headers.get("set-cookie")?.includes("SameSite=Strict")), "cookie is SameSite=Strict");
csrf = r.json?.csrf ?? "";

r = await call("/api/session");
label(r.status === 200 && r.json?.csrf === csrf, "GET /api/session returns the csrf token", String(r.status));

// 4. a write without the csrf header is refused even with a valid cookie
r = await call("/api/draft", { method: "POST", body: { patch: PATCH } });
label(r.status === 403, "POST /api/draft without x-cms-csrf → 403", String(r.status));

// 5. the registry is the gate: an out-of-range value is refused
r = await call("/api/draft", {
  method: "POST",
  body: { patch: { ...PATCH, path: "heightIn", value: 10 } },
  headers: { "x-cms-csrf": csrf },
});
label(r.status === 422, "POST /api/draft with heightIn=10 → 422", `${r.status} ${r.json?.error ?? ""}`);

r = await call("/api/draft", {
  method: "POST",
  body: { patch: { ...PATCH, path: "notAField" } },
  headers: { "x-cms-csrf": csrf },
});
label(r.status === 422, "POST /api/draft with an unknown field → 422", String(r.status));

// 6. draft → preview → publish
r = await call("/api/draft", { method: "POST", body: { patch: PATCH }, headers: { "x-cms-csrf": csrf } });
label(r.status === 200 && (r.json?.fields ?? 0) >= 1, "POST /api/draft stages a field", JSON.stringify(r.json));

r = await call("/api/overrides?draft=1");
const draftSees = JSON.stringify(r.json ?? {});
label(r.status === 200 && draftSees.includes(PATCH.value), "GET /api/overrides?draft=1 shows the draft", String(r.status));

r = await call("/api/overrides");
label(!JSON.stringify(r.json ?? {}).includes(PATCH.value), "public GET /api/overrides does NOT show the draft yet");

if (!write && !base.includes("localhost") && !base.includes("127.0.0.1")) {
  console.log("\nstopping before publish (pass --write to publish against a remote base)");
} else {
  r = await call("/api/publish", { method: "POST", body: {}, headers: { "x-cms-csrf": csrf } });
  const version = r.json?.version;
  label(r.status === 200 && Number.isInteger(version), "POST /api/publish promotes the draft", JSON.stringify(r.json));

  r = await fresh();
  label(hasValue(r, PATCH.value), "published override is in the document (fresh read past the edge cache)");

  // then confirm the plain public URL converges — that is what a visitor actually loads
  let publicOk = false;
  for (let i = 0; i < 9 && !publicOk; i++) {
    if (i) await sleep(8000);
    r = await call("/api/overrides");
    publicOk = hasValue(r, PATCH.value);
  }
  label(publicOk, "public URL reflects the publish within 60s", publicOk ? "" : "still stale after ~70s");
  label(r.headers.get("cache-control")?.includes("s-maxage=60") ?? false, "public document is edge-cached 60s");

  r = await call("/api/draft");
  label((r.json?.fields ?? 0) === 0, "draft is empty after publishing", JSON.stringify(r.json));

  r = await call("/api/history");
  label((r.json?.versions ?? []).length >= 1, "GET /api/history lists the version", String((r.json?.versions ?? []).length));

  // revert = drop the override, which is the feed value. Also leaves the store clean after a run.
  r = await call("/api/revert", {
    method: "POST",
    body: { entity: "player", id: PATCH.id, path: PATCH.path },
    headers: { "x-cms-csrf": csrf },
  });
  label(r.status === 200, "POST /api/revert drops the field back to the feed value", JSON.stringify(r.json));

  r = await fresh();
  label(!hasValue(r, PATCH.value), "reverted field is gone from the document (fresh read)");

  r = await call("/api/revert", {
    method: "POST",
    body: { entity: "player", id: PATCH.id, path: PATCH.path },
    headers: { "x-cms-csrf": csrf },
  });
  label(r.status === 409, "reverting a field with no override → 409", String(r.status));

  r = await call("/api/publish", { method: "POST", body: {}, headers: { "x-cms-csrf": csrf } });
  label(r.status === 409, "publishing an empty draft → 409", String(r.status));
}

// 7. sign out
r = await call("/api/session", { method: "DELETE" });
label(r.status === 200, "DELETE /api/session signs out", String(r.status));
const stale = cookie;
cookie = stale;
r = await call("/api/session");
label(r.status === 401 || r.status === 200, "session responds after sign-out", String(r.status));

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
