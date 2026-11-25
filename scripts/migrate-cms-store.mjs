#!/usr/bin/env node
/**
 * Move the CMS's documents from Netlify Blobs into Postgres — one run, before the store switches.
 *
 *   node scripts/migrate-cms-store.mjs [--dry-run]
 *
 * Reads the deployed admin API (the published document is public; the draft and versions need the
 * passphrase file the CMS already keeps) and writes the same keys into `public.cms_store`. Writes go
 * through the Data API with the service key, so nothing is printed and no credential leaves the box.
 *
 * The published document is what visitors see: this script refuses to overwrite a non-empty
 * `overrides` row unless `--force` is passed, so a second run cannot quietly replace editorial work.
 */
import { readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const BASE = process.env.CMS_BASE ?? "https://laxdb.netlify.app";

function envFile() {
  const out = {};
  const p = process.env.SUPABASE_ENV_FILE ?? "data/supabase-env.txt";
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const env = { ...envFile(), ...process.env };
if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("SUPABASE_* missing");
const API = env.SUPABASE_URL.replace(/\/$/, "");

function passphrase() {
  if (process.env.CMS_PASSPHRASE) return process.env.CMS_PASSPHRASE;
  for (const f of ["data/cms-passphrase.netlify", "data/cms-passphrase"]) {
    if (existsSync(f)) return readFileSync(f, "utf8").trim();
  }
  throw new Error("no passphrase file — pass CMS_PASSPHRASE in the environment");
}

async function write(key, value) {
  if (dryRun) {
    console.log(`  would write ${key} (${value.length} B)`);
    return;
  }
  const res = await fetch(`${API}/rest/v1/cms_store?on_conflict=store,key`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ store: "cms", key, value }]),
  });
  if (!res.ok) throw new Error(`write ${key}: ${res.status} ${await res.text()}`);
  console.log(`  wrote ${key} (${value.length} B)`);
}

async function read(key) {
  const res = await fetch(
    `${API}/rest/v1/cms_store?store=eq.cms&key=eq.${encodeURIComponent(key)}&select=value`,
    { headers: { apikey: env.SUPABASE_SECRET_KEY } },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.value ?? null;
}

/* ------------------------------- read the source ------------------------------ */

const publishedRes = await fetch(`${BASE}/api/overrides`);
if (!publishedRes.ok) throw new Error(`published doc: ${publishedRes.status}`);
const published = await publishedRes.text();
console.log(`published v${JSON.parse(published).version}`);

const authRes = await fetch(`${BASE}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({ passphrase: passphrase() }),
});
if (!authRes.ok) throw new Error(`sign-in failed: ${authRes.status}`);
const cookie = (authRes.headers.get("set-cookie") ?? "").split(";")[0];
const { csrf } = await authRes.json();
const auth = { cookie, "x-cms-csrf": csrf, origin: BASE };

const draftRes = await fetch(`${BASE}/api/draft`, { headers: auth });
const draft = draftRes.ok ? await draftRes.text() : null;

const historyRes = await fetch(`${BASE}/api/history`, { headers: auth });
const history = historyRes.ok ? await historyRes.json() : [];
const versions = [];
for (const row of Array.isArray(history) ? history : history.versions ?? []) {
  const one = await fetch(`${BASE}/api/history?version=${row.version}`, { headers: auth });
  if (one.ok) versions.push([`versions/v${row.version}.json`, await one.text()]);
}

/* ----------------------------------- write ----------------------------------- */

const existing = await read("overrides");
if (existing && !force) {
  const a = JSON.parse(existing).version;
  const b = JSON.parse(published).version;
  if (a >= b) {
    console.log(`postgres already holds v${a} — nothing to do (--force to overwrite)`);
    process.exit(0);
  }
}

console.log(`migrating: published ${published.length} B, draft ${draft ? draft.length : 0} B, ${versions.length} versions`);
await write("overrides", published);
if (draft) await write("draft", draft);
if (Array.isArray(history)) await write("versions/index", JSON.stringify(history));
for (const [k, v] of versions) await write(k, v);

/* ---------------------------------- verify ----------------------------------- */

if (!dryRun) {
  const back = await read("overrides");
  if (!back) throw new Error("verify failed: overrides not readable");
  const doc = JSON.parse(back);
  const fields = Object.values(doc.entities ?? {}).reduce((n, e) => n + Object.keys(e.fields ?? {}).length, 0);
  console.log(`verify: v${doc.version}, ${Object.keys(doc.entities ?? {}).length} entities, ${fields} fields`);
}
