/**
 * Shared Data API access for the read functions (`slice.ts`, `players.ts`).
 *
 * The secret key talks to PostgREST: no Postgres driver in the bundle, no connection pool to keep
 * warm, and the same key the loader uses. PostgREST caps a response at 1000 rows, so every read
 * pages until it has the count the first response announced — a silent truncation here would change
 * ranks and totals without any error.
 */
import { readFileSync } from "node:fs";

const CACHE_TTL = 5 * 60 * 1000;
const PAGE = 1000;

function env(): { url: string; key: string } {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    // local runs read the gitignored file; a deployed function only ever gets the env vars
    try {
      const raw = readFileSync(process.env.SUPABASE_ENV_FILE ?? "data/supabase-env.txt", "utf8");
      for (const line of raw.split("\n")) {
        const i = line.indexOf("=");
        if (i <= 0) continue;
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k === "SUPABASE_URL") url ??= v;
        if (k === "SUPABASE_SECRET_KEY") key ??= v;
      }
    } catch {
      /* nothing to fall back to */
    }
  }
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY missing");
  return { url: url.replace(/\/$/, ""), key };
}

const { url: API, key: KEY } = env();
const cache = new Map<string, { at: number; rows: any[] }>();

export async function rows<T = any>(path: string): Promise<T[]> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.rows as T[];

  const sep = path.includes("?") ? "&" : "?";

  const head = await fetch(`${API}/rest/v1/${path}${sep}limit=1`, {
    headers: { apikey: KEY, accept: "application/json", prefer: "count=exact" },
  });
  if (!head.ok) {
    throw new Error(`supabase ${head.status} on ${path}: ${(await head.text()).slice(0, 200)}`);
  }
  const total = Number((head.headers.get("content-range") ?? "0-0/0").split("/")[1] ?? 0);
  if (total <= 1) {
    const only = (await head.json()) as T[];
    cache.set(path, { at: Date.now(), rows: only as any[] });
    return only;
  }

  const offsets: number[] = [];
  for (let o = 0; o < total; o += PAGE) offsets.push(o);

  const out: T[] = [];
  const WAVE = 8;
  for (let i = 0; i < offsets.length; i += WAVE) {
    const wave = offsets.slice(i, i + WAVE);
    const pages = await Promise.all(
      wave.map(async (offset) => {
        const res = await fetch(`${API}/rest/v1/${path}${sep}limit=${PAGE}&offset=${offset}`, {
          headers: { apikey: KEY, accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(`supabase ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
        }
        return (await res.json()) as T[];
      }),
    );
    for (const page of pages) out.push(...page);
  }

  cache.set(path, { at: Date.now(), rows: out as any[] });
  return out;
}

/**
 * One call to the Data API, for callers that need writes (the CMS store). Reads go through `rows()`
 * so they keep the pagination and the cache; this is the raw path.
 */
export async function pgFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", KEY);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${API}/rest/v1/${path}`, { ...init, headers });
}

/** The response preamble every read route shares: one query per URL per cache window. */
export const CACHE_HEADERS = {
  "content-type": "application/json",
  "netlify-cdn-cache-control": "public, max-age=300, stale-while-revalidate=86400",
};
