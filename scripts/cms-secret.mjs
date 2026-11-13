#!/usr/bin/env node
/**
 * Generates the admin credentials. Nothing secret is printed to the terminal or pasted into chat.
 *
 *   node scripts/cms-secret.mjs --local     → data/cms-env.local (local dev server reads this)
 *   node scripts/cms-secret.mjs --netlify   → data/cms-netlify-env.txt (you copy the two values into
 *                                             Netlify → Site configuration → Environment variables)
 *   ...add --pass-stdin to supply your own passphrase instead of a generated one
 *
 * Both files land under data/ and are gitignored. The passphrase itself is never written to the
 * environment: only its scrypt hash is.
 */
import { randomBytes, randomInt, scryptSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LOCAL = "--local";
const NETLIFY = "--netlify";
const PASS_STDIN = "--pass-stdin";

const words = [
  "amber", "barn", "birch", "blue", "canyon", "cedar", "chalk", "cobalt", "copper", "crest",
  "delta", "dune", "ember", "fern", "flint", "forge", "granite", "grove", "harbor", "heron",
  "indigo", "iron", "ivory", "juniper", "kestrel", "larch", "linen", "maple", "meadow", "mesa",
  "nectar", "night", "north", "oak", "ochre", "onyx", "opal", "pike", "pine", "quartz",
  "raven", "reed", "ridge", "river", "slate", "sorrel", "spruce", "steel", "summit", "tundra",
];

const generated = () => `${words[randomInt(words.length)]}-${words[randomInt(words.length)]}-${words[randomInt(words.length)]}-${randomInt(10, 100)}`;

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8").trim();
}

const passphrase = process.argv.includes(PASS_STDIN) ? await readStdin() : generated();
if (passphrase.length < 12) {
  console.error("passphrase must be at least 12 characters");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(passphrase.normalize("NFKC"), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const packed = `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
const sessionSecret = randomBytes(32).toString("hex");

await mkdir("data", { recursive: true });
// one passphrase file per target, so a local run never signs in with the production passphrase
const passFile = join("data", process.argv.includes(NETLIFY) ? "cms-passphrase.netlify" : "cms-passphrase");
await writeFile(passFile, passphrase + "\n", { mode: 0o600 });

if (process.argv.includes(LOCAL)) {
  const file = join("data", "cms-env.local");
  await writeFile(
    file,
    [
      "# local CMS credentials — generated, gitignored, never commit",
      `ADMIN_PASSPHRASE_HASH=${packed}`,
      `ADMIN_SESSION_SECRET=${sessionSecret}`,
      "# the passphrase itself, only so the local test scripts can sign in",
      `CMS_DEV_PASSPHRASE=${passphrase}`,
      "",
    ].join("\n"),
    { mode: 0o600 }
  );
  console.log(`wrote ${file} (0600)`);
  console.log("local passphrase is on the CMS_DEV_PASSPHRASE line of that file");
} else if (process.argv.includes(NETLIFY)) {
  const file = join("data", "cms-netlify-env.txt");
  await writeFile(
    file,
    [
      "Netlify → Site configuration → Environment variables",
      "Add both, scoped to Functions (and Builds), then redeploy so the function picks them up.",
      "",
      `ADMIN_PASSPHRASE_HASH=${packed}`,
      `ADMIN_SESSION_SECRET=${sessionSecret}`,
      "",
      "Your passphrase (enter it in the dock's sign-in prompt, not here):",
      passphrase,
      "",
    ].join("\n"),
    { mode: 0o600 }
  );
  console.log(`wrote ${file} (0600) — open it, copy the two env values into Netlify, keep the passphrase`);
} else {
  console.error("usage: node scripts/cms-secret.mjs --local | --netlify [--pass-stdin]");
  process.exit(1);
}
