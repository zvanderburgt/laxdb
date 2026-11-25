/**
 * One tiny key/value interface, two backends:
 *
 *  - `blobs` — Netlify Blobs, strong consistency (a publish is read back immediately)
 *  - `fs`    — a directory under `data/cms-store`, so a local dev pass never touches production
 *
 * Everything above this file (draft document, revisions, rate limits) only knows `KV`.
 */
import { getStore } from "@netlify/blobs";
import { pgFetch } from "./supabase";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export type StoreName = "cms" | "media";

const FS_ROOT = process.env.CMS_STORE_DIR ?? "data/cms-store";
const mode = () => process.env.CMS_STORE ?? "";
const useFs = () => mode() === "fs";
/** Postgres is the store whenever the project's credentials are present — `blobs` is the fallback. */
const usePg = () => mode() === "pg" || (mode() !== "fs" && mode() !== "blobs" && hasSupabase());

function hasSupabase(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) ||
      existsSync(process.env.SUPABASE_ENV_FILE ?? "data/supabase-env.txt"),
  );
}

/**
 * The CMS's documents, in Postgres.
 *
 * `cms_store` is a key/value table on purpose: `doc.ts` treats the override document as one object
 * and publish as one write, so the storage layer stays that shape. What changes is the substrate —
 * one project, one backup, one place to look, and no Netlify Blobs token to expire mid-session.
 */
function pgStore(name: StoreName): KV {
  const base = `cms_store?store=eq.${encodeURIComponent(name)}`;
  const id = (key: string) => `&key=eq.${encodeURIComponent(key)}`;
  return {
    async get(key) {
      const res = await pgFetch(`${base}${id(key)}&select=value`);
      if (!res.ok) throw new StoreError(`get ${key}: ${res.status}`);
      const body = (await res.json()) as { value: string }[];
      return body[0]?.value ?? null;
    },
    async set(key, value) {
      const res = await pgFetch(`cms_store?on_conflict=store,key`, {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ store: name, key, value }]),
      });
      if (!res.ok) throw new StoreError(`set ${key}: ${res.status} ${(await res.text()).slice(0, 120)}`);
    },
    async del(key) {
      const res = await pgFetch(`${base}${id(key)}`, { method: "DELETE" });
      if (!res.ok) throw new StoreError(`del ${key}: ${res.status}`);
    },
    async list(prefix = "") {
      const like = encodeURIComponent(`${prefix}*`);
      const res = await pgFetch(`${base}&key=like.${like}&select=key&order=key`);
      if (!res.ok) throw new StoreError(`list ${prefix}: ${res.status}`);
      const body = (await res.json()) as { key: string }[];
      return body.map((r) => r.key);
    },
  };
}

/** Keys are slugs we generate ourselves, but never trust that when they reach a path. */
const safeKey = (key: string) => key.replace(/[^a-zA-Z0-9._/-]/g, "_").replace(/\.\./g, "_");

function fsStore(name: StoreName): KV {
  const root = join(FS_ROOT, name);
  const path = (key: string) => join(root, safeKey(key));
  return {
    async get(key) {
      try {
        return await readFile(path(key), "utf8");
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const file = path(key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, value, "utf8");
    },
    async del(key) {
      await rm(path(key), { force: true });
    },
    async list(prefix = "") {
      const out: string[] = [];
      const walk = async (dir: string, rel: string) => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const nextRel = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(join(dir, e.name), nextRel);
          else if (nextRel.startsWith(prefix)) out.push(nextRel);
        }
      };
      await walk(root, "");
      return out.sort();
    },
  };
}

function blobsStore(name: StoreName): KV {
  // strong consistency: a publish must be visible to the very next read, not 60s later
  const store = getStore({ name, consistency: "strong" });
  return {
    get: async (key) => (await store.get(key, { type: "text" })) ?? null,
    set: async (key, value) => {
      await store.set(key, value);
    },
    del: async (key) => {
      await store.delete(key);
    },
    async list(prefix = "") {
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key).sort();
    },
  };
}

/**
 * A store handle for this request.
 *
 * Deliberately NOT cached across invocations: Netlify Blobs hands the function a short-lived token in
 * `NETLIFY_BLOBS_CONTEXT`, and a client built on a warm instance keeps the token it captured — which
 * expires. Caching it produced `BlobsInternalError: Failed to decode token: Token expired` on every
 * request after the first hour, which surfaced to the editor as a 502. `getStore()` re-reads the
 * environment and costs nothing measurable.
 */
const fsCache = new Map<StoreName, KV>();

export function store(name: StoreName): KV {
  if (usePg()) return resilient(pgStore(name));
  if (!useFs()) return resilient(blobsStore(name));
  let s = fsCache.get(name);
  if (!s) {
    s = fsStore(name);
    fsCache.set(name, s);
  }
  return s;
}

/** Reads degrade to "nothing stored"; writes fail loudly so a caller can answer 503, not 502. */
function resilient(kv: KV): KV {
  return {
    async get(key) {
      try {
        return await kv.get(key);
      } catch (err) {
        console.error(`blobs: get ${key} failed — ${String(err)}`);
        return null;
      }
    },
    async list(prefix) {
      try {
        return await kv.list(prefix);
      } catch (err) {
        console.error(`blobs: list ${prefix} failed — ${String(err)}`);
        return [];
      }
    },
    async set(key, value) {
      try {
        await kv.set(key, value);
      } catch (err) {
        throw new StoreError(`could not write ${key}: ${String(err)}`);
      }
    },
    async del(key) {
      try {
        await kv.del(key);
      } catch (err) {
        throw new StoreError(`could not delete ${key}: ${String(err)}`);
      }
    },
  };
}

export class StoreError extends Error {}

export const usingFs = useFs;
