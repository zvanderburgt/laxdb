/**
 * One tiny key/value interface, two backends:
 *
 *  - `blobs` — Netlify Blobs, strong consistency (a publish is read back immediately)
 *  - `fs`    — a directory under `data/cms-store`, so a local dev pass never touches production
 *
 * Everything above this file (draft document, revisions, rate limits) only knows `KV`.
 */
import { getStore } from "@netlify/blobs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export type StoreName = "cms" | "media";

const FS_ROOT = process.env.CMS_STORE_DIR ?? "data/cms-store";
const useFs = () => process.env.CMS_STORE === "fs";

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

const cache = new Map<StoreName, KV>();

export function store(name: StoreName): KV {
  let s = cache.get(name);
  if (!s) {
    s = useFs() ? fsStore(name) : blobsStore(name);
    cache.set(name, s);
  }
  return s;
}

export const usingFs = useFs;
