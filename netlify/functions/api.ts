/**
 * The whole admin API, in one function.
 *
 *   POST   /api/session    { passphrase }        → sets the session cookie
 *   GET    /api/session                          → { exp, csrf } | 401
 *   DELETE /api/session                          → clears the cookie
 *   GET    /api/overrides                        → published document (edge-cached, public)
 *   GET    /api/overrides?draft=1                → published + draft (auth, no-store)
 *   GET    /api/draft                            → the draft alone (auth)
 *   POST   /api/draft      { patch }             → stage one field (auth + csrf)
 *   DELETE /api/draft                            → throw the draft away (auth + csrf)
 *   POST   /api/publish                          → promote draft → published (auth + csrf)
 *   GET    /api/history[?version=n]              → version index, or one version's document (auth)
 *
 * One entry point rather than eight keeps the bundle single and lets the same handlers run under a
 * plain Node server locally (`scripts/cms-dev-server.mjs`) with a filesystem store.
 */
import { FIELDS, fieldFor, validatePatch } from "../../src/lib/cms-registry";
import {
  clearCookie,
  clearFailures,
  clientIp,
  configured,
  cookieHeader,
  csrfFor,
  linger,
  readCookie,
  recordFailure,
  sessionOf,
  signSession,
  tooManyAttempts,
  verifyPassphrase,
} from "../lib/auth";
import {
  discardDraft,
  draftState,
  entityFields,
  fieldCount,
  publish,
  published,
  revert,
  stage,
  unstage,
  versionDoc,
  versions,
  withDraft,
} from "../lib/doc";
import { StoreError, usingFs } from "../lib/store";

export const config = { path: "/api/*" };

const MAX_BODY = 128 * 1024;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...(init.headers as Record<string, string> | undefined),
    },
  });

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  json({ error, ...extra }, { status });

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Same-origin POSTs only, plus the header derived from the session token. */
function csrfOk(req: Request, token: string | null): boolean {
  if (!token) return false;
  const sent = req.headers.get("x-cms-csrf");
  return Boolean(sent) && sent === csrfFor(token);
}

/**
 * Same-origin writes only.
 *
 * The host has to come from the `host`/`x-forwarded-host` header rather than the request URL: behind
 * the local dev proxy the function sees `localhost:8787` while the browser sends
 * `Origin: localhost:5173`, and on Netlify the forwarded host is the site the visitor typed.
 */
const originOk = (req: Request): boolean => {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetch may omit it; the cookie is SameSite=Strict either way
  const hosts = new Set<string>();
  for (const h of [req.headers.get("host"), req.headers.get("x-forwarded-host")]) {
    if (h) hosts.add(h.toLowerCase());
  }
  try {
    hosts.add(new URL(req.url).host.toLowerCase());
  } catch {
    /* ignore a malformed url */
  }
  try {
    return hosts.has(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
};

export default async function handler(req: Request): Promise<Response> {
  try {
    return await route(req);
  } catch (err) {
    // never let a stack trace reach the client as a 502; say what broke and answer like an API
    const storage = err instanceof StoreError;
    console.error(`api: ${req.method} ${new URL(req.url).pathname} — ${String(err)}`);
    return fail(storage ? 503 : 500, storage ? "storage unavailable — try again" : "request failed");
  }
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();
  const token = readCookie(req);
  const session = sessionOf(req);

  if (method !== "GET" && !originOk(req)) return fail(403, "cross-origin write refused");

  /* --------------------------------- session -------------------------------- */

  if (route === "/session") {
    if (method === "GET") {
      if (!session || !token) return fail(401, "signed out");
      return json({ exp: session.exp, csrf: csrfFor(token) }, { headers: { "cache-control": "no-store" } });
    }

    if (method === "POST") {
      if (!configured()) return fail(503, "admin API is not configured — set ADMIN_PASSPHRASE_HASH and ADMIN_SESSION_SECRET");
      const ip = clientIp(req);
      const wait = await tooManyAttempts(ip);
      if (wait > 0) return fail(429, "too many attempts", { retryAfter: wait });

      const body = await readBody(req);
      const passphrase = typeof body?.passphrase === "string" ? body.passphrase : "";
      if (!passphrase || passphrase.length > 200) {
        await recordFailure(ip);
        return fail(401, "not signed in");
      }
      if (!verifyPassphrase(passphrase)) {
        await recordFailure(ip);
        await linger(1000);
        return fail(401, "not signed in");
      }
      await clearFailures(ip);
      const { token: fresh, session: s } = signSession();
      return json(
        { exp: s.exp, csrf: csrfFor(fresh) },
        { headers: { "set-cookie": cookieHeader(fresh), "cache-control": "no-store" } }
      );
    }

    if (method === "DELETE") {
      return json({ ok: true }, { headers: { "set-cookie": clearCookie(), "cache-control": "no-store" } });
    }
    return fail(405, "method not allowed");
  }

  /* -------------------------------- overrides ------------------------------- */

  if (route === "/overrides") {
    if (method !== "GET") return fail(405, "method not allowed");

    if (url.searchParams.get("draft") === "1") {
      if (!session) return fail(401, "signed out");
      const doc = await withDraft();
      return json(doc, { headers: { "cache-control": "no-store" } });
    }

    const doc = await published();
    const etag = `W/"cms-${doc.version}-${fieldCount(doc)}"`;
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag, "cache-control": "public, max-age=60" } });
    }
    return json(doc, {
      headers: {
        etag,
        // 60s at the edge keeps this off the function hot path; the extra window means a burst of
        // traffic never pays for a cold invocation, it just reads one minute stale
        "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=600",
      },
    });
  }

  /* ---------------------------------- draft --------------------------------- */

  if (route === "/draft") {
    if (!session || !token) return fail(401, "signed out");
    if (!csrfOk(req, token) && method !== "GET") return fail(403, "missing csrf header");

    if (method === "GET") {
      const state = await draftState();
      return json(state, { headers: { "cache-control": "no-store" } });
    }

    if (method === "DELETE") {
      await discardDraft();
      return json({ ok: true, fields: 0 }, { headers: { "cache-control": "no-store" } });
    }

    if (method === "POST") {
      const body = await readBody(req);
      if (!body) return fail(413, "body missing or too large");

      // drop a staged field: the dock's chip ×, its Undo, and the review sheet's "Drop"
      if (body.remove && typeof body.remove === "object") {
        const r = body.remove as Record<string, unknown>;
        const entity = typeof r.entity === "string" ? r.entity : "";
        const id = typeof r.id === "string" ? r.id : "";
        const path = typeof r.path === "string" ? r.path : "";
        if (!["player", "team", "league", "site"].includes(entity) || !id || !fieldFor(entity, path)) {
          return fail(422, "bad remove target");
        }
        const next = await unstage(entity, id, path);
        return json(
          { fields: fieldCount(next), baseVersion: next?.baseVersion ?? 0, generated: next?.generated ?? "" },
          { headers: { "cache-control": "no-store" } }
        );
      }

      const parsed = validatePatch(body.patch);
      if (!parsed.ok) return fail(422, parsed.error);
      const next = await stage(parsed.value);
      return json(
        { fields: fieldCount(next), baseVersion: next.baseVersion, generated: next.generated },
        { headers: { "cache-control": "no-store" } }
      );
    }
    return fail(405, "method not allowed");
  }

  /* --------------------------------- publish -------------------------------- */
  if (route === "/publish") {
    if (method !== "POST") return fail(405, "method not allowed");
    if (!session || !token) return fail(401, "signed out");
    if (!csrfOk(req, token)) return fail(403, "missing csrf header");

    const result = await publish();
    if (!result.ok && result.reason === "empty") return fail(409, "nothing to publish");
    if (!result.ok) {
      return fail(409, "version conflict — reload the page, your draft is still saved", {
        version: result.version,
      });
    }
    return json(
      { version: result.version, fields: result.fields, entities: result.entities },
      { headers: { "cache-control": "no-store" } }
    );
  }

  /* ---------------------------------- revert -------------------------------- */

  // back to the feed value: dropping the override *is* the revert, and it publishes a version
  if (route === "/revert") {
    if (method !== "POST") return fail(405, "method not allowed");
    if (!session || !token) return fail(401, "signed out");
    if (!csrfOk(req, token)) return fail(403, "missing csrf header");

    const body = await readBody(req);
    const entity = typeof body?.entity === "string" ? body.entity : "";
    const id = typeof body?.id === "string" ? body.id : "";
    const path = typeof body?.path === "string" ? body.path : undefined;
    if (!["player", "team", "league", "site"].includes(entity) || !id) return fail(422, "bad entity");
    if (path && !fieldFor(entity, path)) return fail(422, `not an editable field: ${entity}.${path}`);

    const result = await revert(entity, id, path);
    if (!result.ok) return fail(409, "nothing to revert");
    return json(result, { headers: { "cache-control": "no-store" } });
  }

  /* --------------------------------- history -------------------------------- */
  if (route === "/history") {
    if (method !== "GET") return fail(405, "method not allowed");
    if (!session) return fail(401, "signed out");
    const v = Number(url.searchParams.get("version"));
    if (Number.isInteger(v) && v > 0) {
      const doc = await versionDoc(v);
      if (!doc) return fail(404, "no such version");
      return json(doc, { headers: { "cache-control": "no-store" } });
    }
    return json({ versions: await versions() }, { headers: { "cache-control": "no-store" } });
  }

  /* --------------------------------- entity --------------------------------- */

  if (route === "/entity") {
    if (!session) return fail(401, "signed out");
    const key = url.searchParams.get("key") ?? "";
    if (!/^[a-z]+:[a-z0-9][a-z0-9-]{0,79}$/.test(key)) return fail(400, "bad entity key");
    return json({ key, fields: await entityFields(key) }, { headers: { "cache-control": "no-store" } });
  }

  /* ---------------------------------- meta ---------------------------------- */

  if (route === "/meta") {
    return json(
      {
        fields: FIELDS.length,
        store: usingFs() ? "fs" : "blobs",
        signedIn: Boolean(session),
      },
      { headers: { "cache-control": "no-store" } }
    );
  }

  return fail(404, "no such route");
}
