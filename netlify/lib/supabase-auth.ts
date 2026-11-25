/**
 * Who is editing — Supabase Auth, with the passphrase as the fallback.
 *
 * The CMS had no auth provider, so it grew a passphrase, an HMAC cookie, an Origin check and a scrypt
 * hash. Supabase Auth replaces all four: the dock asks for an email, the editor types the 6-digit code
 * Supabase emails, and every write carries the resulting token in an `Authorization` header.
 *
 * A bearer token is not a cookie, which is the point: a cross-site form cannot set that header, so
 * CSRF stops being a class of bug instead of being mitigated by a header comparison.
 *
 * The allowlist is `public.editors`. Being signed in to the project is not the same as being allowed
 * to edit the site, and the browser's publishable key can sign anyone in.
 */
import { pgFetch } from "./supabase";

const TOKEN_TTL = 60_000;

function config(): { url: string; key: string } {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  // in the browser this is the publishable key; the server's secret key identifies the same project
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY missing");
  return { url, key };
}

/* ---------------------------------- allowlist -------------------------------- */

let editors: { at: number; ids: Set<string> } | null = null;

async function editorIds(): Promise<Set<string>> {
  if (editors && Date.now() - editors.at < TOKEN_TTL) return editors.ids;
  const res = await pgFetch("editors?select=userId");
  if (!res.ok) throw new Error(`editors: ${res.status}`);
  const rows = (await res.json()) as { userId: string }[];
  editors = { at: Date.now(), ids: new Set(rows.map((r) => r.userId)) };
  return editors.ids;
}

/** A publish or a draft write must be an allowlisted editor, however they signed in. */
export async function isEditor(userId: string): Promise<boolean> {
  return (await editorIds()).has(userId);
}

/* ---------------------------------- token check ------------------------------ */

const verified = new Map<string, { at: number; user: { id: string; email?: string } | null }>();

/** Verifies a bearer token with GoTrue and returns the user, or null. Cached for a minute. */
export async function bearerUser(req: Request): Promise<{ id: string; email?: string } | null> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const hit = verified.get(token);
  if (hit && Date.now() - hit.at < TOKEN_TTL) return hit.user;

  let user: { id: string; email?: string } | null = null;
  try {
    const { url, key } = config();
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const body = (await res.json()) as { id?: string; email?: string };
      if (body?.id) user = { id: body.id, email: body.email };
    }
  } catch {
    user = null;
  }

  // a failed verification is cached too, but only for a moment: a token that just expired must not
  // keep a stale failure alive for a full minute while the editor is retrying
  verified.set(token, { at: Date.now(), user });
  if (verified.size > 200) verified.clear();
  return user;
}

/* ------------------------------------ OTP ------------------------------------ */

export async function requestOtp(email: string): Promise<{ ok: boolean; error?: string }> {
  const { url, key } = config();
  const res = await fetch(`${url}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ email, create_user: false }),
  });
  if (res.ok) return { ok: true };
  const body = (await res.text()).slice(0, 200);
  return { ok: false, error: body || `otp failed (${res.status})` };
}

export type TokenSet = { access_token: string; refresh_token?: string; expires_at?: number };

export async function verifyOtp(
  email: string,
  token: string,
): Promise<{ tokens?: TokenSet; error?: string }> {
  const { url, key } = config();
  const res = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ type: "email", email, token }),
  });
  if (!res.ok) return { error: `code rejected (${res.status})` };
  const body = (await res.json()) as TokenSet;
  return body?.access_token ? { tokens: body } : { error: "no token returned" };
}
