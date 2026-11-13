/**
 * The override layer — how editorial work survives an importer run.
 *
 * `public/data.json` is generated; this module applies a small document of field overrides on top of
 * it after `loadDataset()` normalises, mutating the same objects the pages already hold. Nothing is
 * copied, so every derived view (peers, similarity, leaders) reads the edited value with no extra work.
 *
 * Boot order is deliberate: the published document is fetched with a short ceiling and a bundled
 * fallback, and only a browser that has already signed in asks for the draft. An anonymous visitor
 * makes no CMS request at all.
 */
import { setPath } from "./cms-registry";
import type { EntityType } from "./cms-registry";
import { playerById, teamById, leagueById, data } from "./data";
import { site, type SiteCopy } from "./site";

export interface EntityOverride {
  rev?: number;
  updatedAt?: string;
  fields: Record<string, unknown>;
}

export interface OverrideDoc {
  version: number;
  generated: string;
  draft?: boolean;
  baseVersion?: number;
  entities: Record<string, EntityOverride>;
}

export interface OverridesState {
  version: number;
  generated: string;
  source: "api" | "bundled" | "none";
  draft: boolean;
  entities: number;
  fields: number;
  /** draft rows whose value differs from the published one — the dock's pending list */
  draftFields: DraftField[];
  /** override keys whose entity is not in this dataset — reported, never pruned */
  orphans: string[];
}

/** One field that exists only in the draft, with the value it replaced. */
export interface DraftField {
  entity: EntityType;
  id: string;
  path: string;
  before: unknown;
  after: unknown;
}

export const overrides: OverridesState = {
  version: 0,
  generated: "",
  source: "none",
  draft: false,
  entities: 0,
  fields: 0,
  draftFields: [],
  orphans: [],
};

const HINT_KEY = "laxdb.cms";
const TIMEOUT_MS = 1200;

export interface CmsSession {
  csrf: string;
  exp: number;
}

export let cmsSession: CmsSession | null = null;

/** A non-secret flag: it only decides whether to *ask* the server who we are. */
export const cmsHint = (): boolean => {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
};

export const setCmsHint = (on: boolean) => {
  try {
    if (on) localStorage.setItem(HINT_KEY, "1");
    else localStorage.removeItem(HINT_KEY);
  } catch {
    /* private mode: the dock just won't appear next time */
  }
};

const fetchJson = async (url: string, init?: RequestInit): Promise<unknown> => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, credentials: "same-origin", ...init });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Apply one document. Mutates in place so object identity (and every memo keyed on it) survives. */
export function applyDoc(doc: OverrideDoc | null): OverridesState {
  overrides.orphans = [];
  overrides.entities = 0;
  overrides.fields = 0;
  if (!doc?.entities) return overrides;

  for (const [key, entry] of Object.entries(doc.entities)) {
    const target = resolve(key);
    if (!target) {
      if (Object.keys(entry.fields ?? {}).length) overrides.orphans.push(key);
      continue;
    }
    overrides.entities++;
    for (const [path, value] of Object.entries(entry.fields ?? {})) {
      // keep the first value this path ever held: that is the feed value, and mutating the object
      // in place destroys the only other copy of it
      const feedKey = `${key}|${path}`;
      if (!feedValues.has(feedKey)) feedValues.set(feedKey, readPath(target, path));
      const next = setPath(target, path, value);
      Object.assign(target, next);
      overrides.fields++;
      // a derived value the UI reads directly, repaired at the edge of the layer
      if (key.startsWith("player:") && path === "position") {
        const p = target as { positionName?: string; position?: string };
        p.positionName = POSITION_NAME[p.position ?? ""] ?? p.positionName ?? "";
      }
    }
  }

  overrides.version = doc.version ?? 0;
  overrides.generated = doc.generated ?? "";
  overrides.draft = Boolean(doc.draft);
  return overrides;
}

const POSITION_NAME: Record<string, string> = {
  A: "Attack",
  M: "Midfield",
  D: "Defense",
  G: "Goalie",
  FO: "Faceoff",
  LSM: "LSM",
  F: "Forward",
  T: "Transition",
  R: "Runner",
};

/** The dataset object a key points at — the same reference the pages render. */
export function entityObject(entity: EntityType | string, id: string): object | null {
  switch (entity) {
    case "player":
      return playerById.get(id) ?? null;
    case "team":
      return teamById.get(id) ?? null;
    case "league":
      return leagueById.get(id) ?? null;
    case "site":
      return site;
    default:
      return null;
  }
}

function resolve(key: string): Record<string, unknown> | null {
  const [entity, ...rest] = key.split(":");
  return (entityObject(entity, rest.join(":")) as Record<string, unknown> | null) ?? null;
}

/**
 * What the dataset held before any override touched it, keyed `entity:id|path`.
 *
 * Recorded the first time the layer writes a path, and never overwritten. It is the only record of the
 * feed value once an object has been mutated, so it is what "before" means in the review sheet and what
 * a drop restores — recomputing it from the live object after a reload would just read the override.
 */
export const feedValues = new Map<string, unknown>();

/**
 * What visitors are currently seeing, keyed `entity:id|path` — the published document's fields.
 *
 * "Before" in the review sheet and on a drop means this, not the feed: reverting a draft edit has to
 * land on the published value, while reverting a published override (a server-side `/api/revert`) is
 * what returns to the feed.
 */
export const publishedValues = new Map<string, unknown>();

const readPath = (obj: unknown, path: string): unknown => {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
};

/**
 * Apply the merged document, and record which of its fields are *draft-only*.
 *
 * `merged` is what the page should show; `pending` is the draft document on its own, and only its
 * fields are unsaved. Diffing the merged document against the feed would count every published
 * override as pending, which reads as "1 unsaved" on a page with nothing staged.
 */
function applyDraft(merged: OverrideDoc | null, pending: OverrideDoc | null): void {
  overrides.draftFields = [];
  if (!merged?.entities) return;

  const rows: DraftField[] = [];
  for (const [key, entry] of Object.entries(pending?.entities ?? {})) {
    const [entity, ...rest] = key.split(":");
    const id = rest.join(":");
    const target = entityObject(entity, id);
    if (!target) continue;
    for (const [path, after] of Object.entries(entry.fields ?? {})) {
      const feedKey = `${key}|${path}`;
      const before = publishedValues.has(feedKey)
        ? publishedValues.get(feedKey)
        : feedValues.has(feedKey)
          ? feedValues.get(feedKey)
          : readPath(target, path);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        rows.push({ entity: entity as EntityType, id, path, before, after });
      }
    }
  }
  applyDoc(merged);
  overrides.draftFields = rows;
}

/** The published document, then — if this browser has signed in — the draft laid over it. */
export async function loadOverrides(force = false): Promise<OverridesState> {
  if (!force && overrides.source !== "none") return overrides;

  const published = (await fetchJson("/api/overrides", { cache: "no-cache" })) as OverrideDoc | null;
  let source: OverridesState["source"] = "none";
  let doc = published;

  if (doc) {
    source = "api";
  } else {
    // the function is down (or we are on a plain static host): the deploy-time snapshot still applies
    const bundled = (await fetchJson(`${import.meta.env.BASE_URL}overrides.json`, { cache: "no-cache" })) as OverrideDoc | null;
    if (bundled) {
      doc = bundled;
      source = "bundled";
    }
  }

  applyDoc(doc);
  publishedValues.clear();
  for (const [key, entry] of Object.entries(doc?.entities ?? {})) {
    for (const [path, value] of Object.entries(entry.fields ?? {})) publishedValues.set(`${key}|${path}`, value);
  }
  overrides.draftFields = [];
  overrides.source = source;

  if (cmsSession || cmsHint()) {
    const session = (await fetchJson("/api/session")) as CmsSession | null;
    if (session) {
      cmsSession = session;
      const draft = (await fetchJson("/api/overrides?draft=1", { cache: "no-store" })) as OverrideDoc | null;
      if (draft) {
        // the draft document on its own answers "what is unsaved"; the merged one answers "what to draw"
        const staged = (await fetchJson("/api/draft", { cache: "no-store" })) as { draft?: OverrideDoc | null } | null;
        applyDraft(draft, staged?.draft ?? null);
        overrides.source = "api";
      }
    } else {
      cmsSession = null;
      setCmsHint(false);
    }
  }

  return overrides;
}

/**
 * Sign in and immediately pick up the draft, so the editor opens onto their own unpublished work.
 * The passphrase is only ever sent to `/api/session`; it is not stored anywhere in the browser.
 */
export async function logIn(passphrase: string): Promise<boolean> {
  const res = await fetch("/api/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase }),
  }).catch(() => null);
  if (!res?.ok) return false;
  const json = (await res.json().catch(() => null)) as CmsSession | null;
  if (!json) return false;
  cmsSession = json;
  setCmsHint(true);
  // the caller follows up with loadOverrides(true); signing in does not apply anything by itself
  return true;
}

export async function logOut(): Promise<void> {
  await fetch("/api/session", { method: "DELETE", credentials: "same-origin" }).catch(() => null);
  cmsSession = null;
  overrides.draftFields = [];
  setCmsHint(false);
}

/**
 * Ask the server whether this browser already has a session.
 *
 * The cookie is HttpOnly, so the only way to know is to ask — and asking costs a request, which is why
 * this runs when the editor is opened rather than on every page load.
 */
export async function probeSession(): Promise<boolean> {
  if (cmsSession) return true;
  const s = (await fetchJson("/api/session")) as CmsSession | null;
  if (!s) {
    setCmsHint(false);
    return false;
  }
  cmsSession = s;
  setCmsHint(true);
  return true;
}

/** The published version the editor is looking at. */
export const publishedVersion = () => overrides.version;

/** The dataset version is what "this document is for" means; a mismatch is worth saying out loud. */
export const datasetSeason = () => data.meta.season;

export const siteCopy = (): SiteCopy => site;
