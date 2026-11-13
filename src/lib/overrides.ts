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
  /** override keys whose entity is not in this dataset — reported, never pruned */
  orphans: string[];
}

export const overrides: OverridesState = {
  version: 0,
  generated: "",
  source: "none",
  draft: false,
  entities: 0,
  fields: 0,
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

function resolve(key: string): Record<string, unknown> | null {
  const [entity, ...rest] = key.split(":");
  const id = rest.join(":");
  switch (entity) {
    case "player":
      return (playerById.get(id) as unknown as Record<string, unknown>) ?? null;
    case "team":
      return (teamById.get(id) as unknown as Record<string, unknown>) ?? null;
    case "league":
      return (leagueById.get(id) as unknown as Record<string, unknown>) ?? null;
    case "site":
      return site as unknown as Record<string, unknown>;
    default:
      return null;
  }
}

/** The published document, then — if this browser has signed in — the draft laid over it. */
export async function loadOverrides(): Promise<OverridesState> {
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
  overrides.source = source;

  if (cmsHint()) {
    const session = (await fetchJson("/api/session")) as CmsSession | null;
    if (session) {
      cmsSession = session;
      const draft = (await fetchJson("/api/overrides?draft=1", { cache: "no-store" })) as OverrideDoc | null;
      if (draft) {
        applyDoc(draft);
        overrides.source = "api";
      }
    } else {
      setCmsHint(false);
    }
  }

  return overrides;
}

/**
 * Sign in and immediately pick up the draft, so the editor opens onto their own unpublished work.
 * The passphrase is only ever sent to `/api/session`; it is not stored anywhere in the browser.
 */
export async function signIn(passphrase: string): Promise<boolean> {
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
  const draft = (await fetchJson("/api/overrides?draft=1", { cache: "no-store" })) as OverrideDoc | null;
  if (draft) {
    applyDoc(draft);
    overrides.draft = true;
  }
  return true;
}

export async function signOut(): Promise<void> {
  await fetch("/api/session", { method: "DELETE", credentials: "same-origin" }).catch(() => null);
  cmsSession = null;
  setCmsHint(false);
}

/** The dataset version is what "this document is for" means; a mismatch is worth saying out loud. */
export const datasetSeason = () => data.meta.season;

export const siteCopy = (): SiteCopy => site;
