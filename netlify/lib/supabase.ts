/**
 * Shared Data API access for the read functions (`slice.ts`, `players.ts`).
 *
 * The secret key talks to PostgREST: no Postgres driver in the bundle, no connection pool to keep
 * warm, and the same key the loader uses. PostgREST caps a response at 1000 rows, so every read
 * pages until it has the count the first response announced — a silent truncation here would change
 * ranks and totals without any error.
 */
import { readFileSync } from "node:fs";

// short enough that a reload of the dataset is live within a minute, long enough that a page's
// handful of reads share one round trip each
const CACHE_TTL = 60 * 1000;
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

let resolved: { url: string; key: string } | null = null;

/**
 * The endpoint and key, resolved on first use rather than at import.
 *
 * This was a module-scope `const { url, key } = env()`, so a deploy missing either variable failed
 * while the module was still loading — and Netlify answers an import failure with its own blank
 * error page, not our JSON. The client then cannot tell "the key is missing" from "the database is
 * down", which is exactly the class of dead page this file has to rule out. Resolved here, the same
 * failure is a 500 whose body names the missing variable.
 */
function api() {
  return (resolved ??= env());
}

/**
 * How long one upstream read may hang before we stop waiting for it.
 *
 * PostgREST has no client-side deadline of its own: a dropped or wedged connection holds the
 * function open until Netlify's own limit kills it, and the browser receives a 502 with a body that
 * is not ours. Eight seconds turns that into a JSON 500 the page can render as a retryable failure.
 */
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * One Data API request, with a deadline and a single retry for a failure that might be transient.
 *
 * 5xx, 429 and a dropped socket are retried once — a pooler that reset a connection usually answers
 * the second attempt. A 4xx is returned as-is: it is the query's own fault and asking again earns
 * the same answer.
 */
async function dataFetch(path: string, headers: Record<string, string>): Promise<Response> {
  const { url, key } = api();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`${url}/rest/v1/${path}`, {
        headers: { apikey: key, ...headers },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (res.ok || res.status < 500) return res;
      lastError = new Error(`supabase ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt === 0) await new Promise((done) => setTimeout(done, 250));
  }
  throw lastError ?? new Error(`supabase request failed: ${path}`);
}
const cache = new Map<string, { at: number; rows: any[] }>();

export async function rows<T = any>(path: string): Promise<T[]> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.rows as T[];

  const sep = path.includes("?") ? "&" : "?";

  // A caller that names a limit wants that many rows, not the table.
  //
  // Paging the whole result set and letting the caller slice afterwards is what made the home page
  // 178 requests and 33 MB of rows for six top-six leaderboards — `limit=900` was overridden by the
  // page loop's own `limit=1000`. A named limit is one request now; only a limit larger than
  // PostgREST's page cap still pages, and only as far as it asked.
  const asked = Number(new URLSearchParams(path.split("?")[1] ?? "").get("limit") ?? 0);
  if (asked > 0) {
    const out: T[] = [];
    for (let offset = 0; offset < asked; offset += PAGE) {
      const want = Math.min(PAGE, asked - offset);
      const res = await dataFetch(`${path}${sep}limit=${want}&offset=${offset}`, {
        accept: "application/json",
      });
      if (!res.ok) {
        throw new Error(`supabase ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
      }
      const page = (await res.json()) as T[];
      out.push(...page);
      if (page.length < want) break;
    }
    cache.set(path, { at: Date.now(), rows: out as any[] });
    return out;
  }

  const head = await dataFetch(`${path}${sep}limit=1`, {
    accept: "application/json",
    prefer: "count=exact",
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
        const res = await dataFetch(`${path}${sep}limit=${PAGE}&offset=${offset}`, {
          accept: "application/json",
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
  const { url, key } = api();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers,
    // a write that hangs must not hold the function open until Netlify kills it
    signal: init.signal ?? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

/** How many rows match, without transferring them: PostgREST reports it in Content-Range. */
export async function count(path: string): Promise<number> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await dataFetch(`${path}${sep}limit=1`, {
    accept: "application/json",
    prefer: "count=exact",
  });
  if (!res.ok) throw new Error(`count ${path}: ${res.status}`);
  return Number((res.headers.get("content-range") ?? "0-0/0").split("/")[1] ?? 0);
}

/**
 * The response preamble every read route shares: one query per URL per cache window.
 *
 * Two policies, deliberately: the edge holds a slice for five minutes (and serves it stale for ten
 * while it revalidates), while the *browser* may reuse it for one minute. Without the second header
 * Netlify answers function responses with `cache-control: no-cache`, so a back button, a nav click
 * and a revisit each re-run the function — which is what made a cold load take twenty seconds.
 */
export const CACHE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "public, max-age=60, stale-while-revalidate=600",
  // a reload of the dataset should show up in minutes, not the next day
  "netlify-cdn-cache-control": "public, max-age=300, stale-while-revalidate=600",
};

/**
 * The body an unreachable database produces, shared by every read function.
 *
 * Two jobs. The status must be 5xx so the client's retry logic can tell a transient failure from a
 * bad request, and `no-store` must be explicit: an error that gets cached at the edge is an outage
 * that outlives itself, served to visitors who would otherwise have recovered. The message keeps the
 * upstream reason — the browser logs it — but no page shows it; `LoadError` reads a plain sentence
 * from the status alone.
 */
export function databaseError(err: unknown): Response {
  return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }), {
    status: 500,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "retry-after": "5",
    },
  });
}
