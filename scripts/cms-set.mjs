#!/usr/bin/env node
/**
 * Stage (and optionally publish) one override from the command line — the seed tool for development,
 * and the escape hatch when the dock isn't available.
 *
 *   node scripts/cms-set.mjs site:site heroTail '"Every player, one record."' --publish
 *   node scripts/cms-set.mjs player:p-ncaa-luke-robinson-cornell-bi heightIn 79 --draft
 *   node scripts/cms-set.mjs --base https://laxdb.netlify.app ... --publish
 *
 * The value is JSON; a bare word is treated as a JSON string. The passphrase comes from
 * data/cms-env.local or CMS_PASSPHRASE, exactly like cms-smoke.mjs.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:8787";
const publish = args.includes("--publish");
const rest = args.filter((a, i) => !["--publish", "--draft", "--base"].includes(a) && args[i - 1] !== "--base");

if (rest.length !== 3) {
  console.error("usage: node scripts/cms-set.mjs <entity:id> <path> <json-value> [--publish] [--base url]");
  process.exit(1);
}

const [entityAndId, path, rawValue] = rest;
const [entity, ...idParts] = entityAndId.split(":");
const id = idParts.join(":");

let value;
try {
  value = JSON.parse(rawValue);
} catch {
  value = rawValue;
}

async function passphrase() {
  if (process.env.CMS_PASSPHRASE) return process.env.CMS_PASSPHRASE;
  const local = base.includes("localhost") || base.includes("127.0.0.1");
  const file = local ? "data/cms-passphrase" : "data/cms-passphrase.netlify";
  if (existsSync(file)) return (await readFile(file, "utf8")).trim();
  if (existsSync("data/cms-env.local")) {
    const m = (await readFile("data/cms-env.local", "utf8")).match(/^CMS_DEV_PASSPHRASE=(.*)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("no passphrase: run node scripts/cms-secret.mjs --local, or set CMS_PASSPHRASE");
}

let cookie = "";
const call = async (p, init = {}) => {
  const res = await fetch(base + p, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

const signin = await call("/api/session", { method: "POST", body: JSON.stringify({ passphrase: await passphrase() }) });
if (signin.status !== 200) {
  console.error(`sign-in failed: ${signin.status} ${JSON.stringify(signin.body)}`);
  process.exit(1);
}
const csrf = signin.body.csrf;

const staged = await call("/api/draft", {
  method: "POST",
  headers: { "x-cms-csrf": csrf },
  body: JSON.stringify({ patch: { entity, id, path, value } }),
});
if (staged.status !== 200) {
  console.error(`stage failed: ${staged.status} ${JSON.stringify(staged.body)}`);
  process.exit(1);
}
console.log(`staged ${entity}:${id} ${path} = ${JSON.stringify(value)} (draft holds ${staged.body.fields} field(s))`);

if (publish) {
  const done = await call("/api/publish", { method: "POST", headers: { "x-cms-csrf": csrf }, body: "{}" });
  if (done.status !== 200) {
    console.error(`publish failed: ${done.status} ${JSON.stringify(done.body)}`);
    process.exit(1);
  }
  console.log(`published version ${done.body.version} — ${done.body.fields} field(s), ${done.body.entities} entity(ies)`);
}
