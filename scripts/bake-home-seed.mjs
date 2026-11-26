#!/usr/bin/env node
/**
 * Bake the landing page's slice into the built shell.
 *
 * The home route was the slowest cold load on the site — 21 s when the function instance was cold,
 * against 0.3 s warm — because the first useful pixel waited on a round trip. The slice is a 63 KB
 * brotli JSON object; carrying it inside `dist/index.html` means the landing page paints with no
 * data request at all, and the client still revalidates in the background so the daily refresh
 * shows up a moment later.
 *
 * The body is produced by the *same* handler the function runs, bundled here, so the seed cannot
 * drift from what `/data/page?path=/home` answers. The meta function strips the block before an
 * entity page is served, so 26,000 player pages do not carry it.
 *
 *   node scripts/bake-home-seed.mjs          bake into dist/index.html
 *   node scripts/bake-home-seed.mjs --check  report the size, touch nothing
 *
 * Fails soft: no database credentials, an unreachable database or a non-200 all print one line and
 * leave the shell alone. A deploy without a seed is the site as it was, never a broken build.
 */
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = join(ROOT, "dist/index.html");
const ENV_PATH = process.env.SUPABASE_ENV_FILE ?? join(ROOT, "data/supabase-env.txt");
// a scratch path: anything under functions-build/ would ship as a function
const TMP = join(ROOT, "node_modules/.cache/laxdb/bake-page.mjs");
const MARK = /<!--seed:start-->[\s\S]*?<!--seed:end-->/;
const check = process.argv.includes("--check");

const note = (line) => console.log(line);
const skip = (why) => {
  note(`seed: skipped — ${why}`);
  process.exit(0);
};

if (!existsSync(SHELL)) skip("dist/index.html does not exist (run the build first)");

/** The endpoint's own query string, so the client finds this block by an exact key match. */
const KEY = `data/page?${new URLSearchParams({ path: "/home" }).toString()}`;

if (check) {
  const html = readFileSync(SHELL, "utf8");
  const block = html.match(MARK)?.[0] ?? "";
  note(`seed: ${block.length} bytes in dist/index.html (key ${KEY})`);
  process.exit(0);
}

/* ------------------------------- credentials ------------------------------- */

if (!existsSync(ENV_PATH)) skip(`no ${ENV_PATH}`);
for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
  const hit = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (hit) process.env[hit[1]] ??= hit[2].trim();
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  skip("SUPABASE_URL / SUPABASE_SECRET_KEY are not set");
}

/* ---------------------------- the slice, from the handler ---------------------------- */

let text;
try {
  mkdirSync(dirname(TMP), { recursive: true });
  await build({
    entryPoints: [join(ROOT, "netlify/functions/page.ts")],
    outfile: TMP,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    external: ["node:*"],
    loader: { ".ttf": "binary", ".wasm": "binary" },
    logLevel: "error",
  });
  const { default: handler } = await import(pathToFileURL(TMP).href);
  const res = await handler(new Request(`https://laxdb.invalid/data/page?path=/home`));
  if (!res.ok) skip(`the home handler answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  text = await res.text();
} catch (err) {
  skip(String(err?.message ?? err).split("\n")[0]);
}

let payload;
try {
  payload = JSON.parse(text);
} catch {
  skip("the handler did not answer JSON");
}
if (payload?.route !== "/home") skip(`the handler answered route ${String(payload?.route)}`);

/* --------------------------------- the shell -------------------------------- */

const html = readFileSync(SHELL, "utf8");
if (!MARK.test(html)) skip("dist/index.html has no seed markers");
if (!html.includes('id="laxdb-seed"') && !html.includes("<!--seed:start--><!--seed:end-->")) {
  // a re-run over an already-baked shell is fine; a shell with markers but no room is not
  note("seed: replacing the existing block");
}

// `</script>` inside a JSON string would close the block early; `<\/` is the same string to JSON.
const safe = text.replace(/<\//g, "<\\/");
const block =
  `<!--seed:start--><script id="laxdb-seed" type="application/json" data-key="/${KEY}">` +
  safe +
  `</script><!--seed:end-->`;

writeFileSync(SHELL, html.replace(MARK, block));

const before = Buffer.byteLength(html);
const after = statSync(SHELL).size;
note(
  `seed: ${Math.round(statSync(SHELL).size / 1024)} KB shell (was ${Math.round(before / 1024)} KB), ` +
    `key /${KEY}, ${payload.playerCount ?? "?"} players, generated ${String(payload.generated ?? "").slice(0, 10)}`,
);
