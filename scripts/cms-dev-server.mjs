#!/usr/bin/env node
/**
 * Local admin API on http://localhost:8787 — the same handler Netlify runs, over a filesystem store.
 *
 *   node scripts/build-functions.mjs        # (or --watch in a second terminal)
 *   node scripts/cms-dev-server.mjs         # this
 *   npm run dev                             # vite, which proxies /api here
 *
 * Credentials come from data/cms-env.local (written by scripts/cms-secret.mjs --local) — never from
 * the repo, never from this file, never printed. Nothing here can reach production: CMS_STORE=fs
 * keeps every write under data/cms-store/.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const ENV_FILE = "data/cms-env.local";
const PORT = Number(process.env.CMS_PORT ?? 8787);

if (!existsSync(ENV_FILE)) {
  console.error(`missing ${ENV_FILE} — run: node scripts/cms-secret.mjs --local`);
  process.exit(1);
}
for (const line of (await readFile(ENV_FILE, "utf8")).split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}
process.env.CMS_STORE = "fs";
process.env.NODE_ENV ??= "development";

const entry = join(process.cwd(), "netlify/functions-build/api.mjs");
if (!existsSync(entry)) {
  console.error(`missing ${entry} — run: node scripts/build-functions.mjs`);
  process.exit(1);
}
const { default: handler } = await import(pathToFileURL(entry).href);

const server = createServer(async (req, res) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) {
      res.writeHead(413).end("too large");
      return;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });

  let response;
  try {
    response = await handler(request);
  } catch (err) {
    console.error(err);
    response = new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const headers = {};
  response.headers.forEach((v, k) => {
    if (k === "set-cookie") return;
    headers[k] = v;
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length) headers["set-cookie"] = setCookie;
  res.writeHead(response.status, headers).end(Buffer.from(await response.arrayBuffer()));
  console.log(`${req.method} ${req.url} → ${response.status}`);
});

server.listen(PORT, () => console.log(`cms api on http://localhost:${PORT} (store: fs)`));
