#!/usr/bin/env node
/**
 * Delete the importer's data files from `dist/` before it is uploaded.
 *
 * The site and its API read Postgres; the JSON files under `public/` are the importer's output and
 * the loader's input, and nothing a visitor requests needs them. Leaving them in the deploy shipped
 * ~27 MB of unreachable files (`data.json` alone is 23 MB) and made it impossible to tell, from the
 * deploy, whether anything still read them.
 *
 * `overrides.json` stays: it is the rendered fallback for the CMS document when `/api/overrides` is
 * unreachable, and it is written from the API, never from local state.
 *
 *   node scripts/strip-data-files.mjs          # after `vite build`
 *   node scripts/strip-data-files.mjs --dry    # list what would go
 */
import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const dry = process.argv.includes("--dry");

/** Everything the importer writes into public/ that the deploy does not serve. */
const DATA_FILES = [
  "data.json",
  "data.wire.json",
  "games.json",
  "scores.json",
  "history-results.json",
  "franchises.json",
  "rankings.json",
  "rankings-history.json",
  "entity-index.json",
  "entity-cards.json",
];

let freed = 0;
const removed = [];
for (const file of DATA_FILES) {
  const path = join(DIST, file);
  if (!existsSync(path)) continue;
  const bytes = statSync(path).size;
  freed += bytes;
  removed.push(`${file} (${(bytes / 1_048_576).toFixed(1)} MB)`);
  if (!dry) rmSync(path, { force: true });
}

if (!removed.length) {
  console.log("strip-data-files: nothing to remove");
} else {
  console.log(
    `strip-data-files: ${dry ? "would remove" : "removed"} ${removed.length} files, ` +
      `${(freed / 1_048_576).toFixed(1)} MB — ${removed.join(", ")}`,
  );
}
