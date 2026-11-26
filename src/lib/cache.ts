/**
 * The device's copy of every slice it has loaded.
 *
 * A cold load used to mean a function round trip before the first useful pixel, and a revisit meant
 * the same round trip again. IndexedDB holds the last payload for each route, keyed by the endpoint
 * URL the client would have fetched, with a timestamp and a fingerprint of the bytes — so a revisit
 * paints from the device and only re-renders when the fresh payload actually differs.
 *
 * Everything here is best effort. A private window, an evicted store, a device out of quota: each
 * one degrades to the behaviour the site had before this file existed, and none of them throws into
 * the boot path.
 *
 * `laxdb-cache` is deliberately separate from `laxdb.roster.v1` / `laxdb-compare` (user state, small
 * and precious) and from `laxdb-theme`: nothing in this store survives being thrown away.
 */

const DB = "laxdb-cache";
const STORE = "slices";
const VERSION = 1;

/** A stored copy younger than this is offered without any network round trip at all. */
export const FRESH_MS = 60_000;

export type Entry = { text: string; hash: number; storedAt: number };

/** FNV-1a over the response text: cheap, and exact enough to tell "same payload" from "changed". */
export function fingerprint(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB, VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    // Safari in a private window, and any policy-blocked origin, land here
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function read(db: IDBDatabase, key: string): Promise<Entry | null> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Entry | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function put(db: IDBDatabase, key: string, entry: Entry): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

export async function readEntry(key: string): Promise<Entry | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await read(db, key);
  } finally {
    db.close();
  }
}

/**
 * Store one route's payload. A device out of quota gets its slice cache cleared rather than a
 * failed write: this store is disposable by design — the roster and the compare tray are not.
 */
export async function writeEntry(key: string, text: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const entry: Entry = { text, hash: fingerprint(text), storedAt: Date.now() };
  try {
    await put(db, key, entry);
  } catch {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
      await put(db, key, entry);
    } catch {
      // still full, or read-only: warming is not worth an error the visitor can see
    }
  } finally {
    db.close();
  }
}

/** Fetch a route's slice into the store, for a prefetch or a nav hover. Never applies it. */
export async function warmSlice(url: string): Promise<void> {
  try {
    const existing = await readEntry(url);
    if (existing && Date.now() - existing.storedAt < FRESH_MS) return;
    const res = await fetch(url);
    if (!res.ok) return;
    await writeEntry(url, await res.text());
  } catch {
    // best effort: a prefetch that fails costs nothing
  }
}

/**
 * The slice the build baked into this document, if there is one and it is for this page's key.
 * Kept as a script block rather than a fetch so the landing page needs no data request at all.
 */
export function readSeed(): { key: string; text: string } | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById("laxdb-seed");
  const key = el?.getAttribute("data-key");
  const text = el?.textContent;
  if (!key || !text || text.length < 2) return null;
  return { key, text };
}
