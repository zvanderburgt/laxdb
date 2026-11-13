/**
 * The override document: what the CMS writes, and the only thing the public read path serves.
 *
 * One JSON document holds every editorial field, keyed `entityType:entityId` — small enough (~40 KB
 * at 1,000 fields) that sending it whole keeps both ends trivially correct, and atomic enough that
 * publish is a single Blob write.
 *
 * Lifecycle: a draft document accumulates fields; `publish()` promotes it to `overrides` in one go
 * and appends a version snapshot. Nothing a visitor can see changes until that promotion.
 */
import { getPath, setPath, type Patch } from "../../src/lib/cms-registry";
import { store } from "./store";

export const DOC_KEY = "overrides";
export const DRAFT_KEY = "draft";
const INDEX_KEY = "versions/index";
const KEEP_VERSIONS = 20;

export interface EntityOverride {
  rev: number;
  updatedAt: string;
  fields: Record<string, unknown>;
}

export interface OverrideDoc {
  version: number;
  /** when this document last changed */
  generated: string;
  entities: Record<string, EntityOverride>;
}

export interface DraftDoc extends OverrideDoc {
  /** the published version the draft was started from; publish refuses if it has moved on */
  baseVersion: number;
}

export interface VersionRow {
  version: number;
  at: string;
  fields: number;
  entities: number;
}

export const entityKey = (entity: string, id: string) => `${entity}:${id}`;

export const emptyDoc = (version = 0): OverrideDoc => ({
  version,
  generated: new Date().toISOString(),
  entities: {},
});

export const emptyDraft = (baseVersion: number): DraftDoc => ({
  ...emptyDoc(baseVersion),
  baseVersion,
});

export function fieldCount(doc: OverrideDoc | null): number {
  if (!doc) return 0;
  return Object.values(doc.entities).reduce((n, e) => n + Object.keys(e.fields).length, 0);
}

export function entityCount(doc: OverrideDoc | null): number {
  if (!doc) return 0;
  return Object.values(doc.entities ?? {}).filter((e) => Object.keys(e.fields).length > 0).length;
}

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await store("cms").get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // a corrupt document must not take the site down: treat it as absent and say so in the log
    console.error(`cms: ${key} is not valid JSON — ignoring it`);
    return null;
  }
}

const readPublished = () => readJson<OverrideDoc>(DOC_KEY);
const readDraft = () => readJson<DraftDoc>(DRAFT_KEY);

/** Published overrides, always safe to serve to a visitor (empty document when none). */
export async function published(): Promise<OverrideDoc> {
  const doc = await readPublished();
  return doc && doc.entities ? { ...emptyDoc(), ...doc } : emptyDoc();
}

/** Published with the draft laid over it — what the signed-in editor sees, and only them. */
export async function withDraft(): Promise<OverrideDoc & { draft: boolean; baseVersion: number }> {
  const pub = await published();
  const draft = await readDraft();
  if (!draft) return { ...pub, draft: false, baseVersion: pub.version };
  const entities = { ...pub.entities };
  for (const [key, entry] of Object.entries(draft.entities ?? {})) {
    const prev = entities[key];
    entities[key] = {
      rev: entry.rev,
      updatedAt: entry.updatedAt,
      fields: { ...(prev?.fields ?? {}), ...entry.fields },
    };
  }
  return {
    version: pub.version,
    generated: draft.generated,
    entities,
    draft: fieldCount(draft) > 0,
    baseVersion: draft.baseVersion ?? pub.version,
  };
}

/** Set one field on the draft, creating the document from the current published version if needed. */
export async function stage(patch: Patch): Promise<DraftDoc> {
  const pub = await published();
  const draft = (await readDraft()) ?? emptyDraft(pub.version);
  const key = entityKey(patch.entity, patch.id);
  const entry = draft.entities[key] ?? { rev: 0, updatedAt: "", fields: {} };
  const fields = { ...entry.fields };
  const before = getPath(entry.fields, patch.path);
  if (JSON.stringify(before) === JSON.stringify(patch.value)) {
    // no-op: drop the field if it was the only change, so a re-typed value leaves no trace
    delete fields[patch.path];
  } else {
    fields[patch.path] = patch.value;
  }
  const now = new Date().toISOString();
  const entities = { ...draft.entities };
  if (Object.keys(fields).length === 0) delete entities[key];
  else entities[key] = { rev: entry.rev, updatedAt: now, fields };

  const next: DraftDoc = { ...draft, entities, generated: now, baseVersion: draft.baseVersion ?? pub.version };
  await store("cms").set(DRAFT_KEY, JSON.stringify(next));
  return next;
}

export async function discardDraft(): Promise<void> {
  await store("cms").del(DRAFT_KEY);
}

export async function draftState(): Promise<{ draft: DraftDoc | null; fields: number; baseVersion: number }> {
  const doc = await readDraft();
  const pub = await published();
  return { draft: doc, fields: fieldCount(doc), baseVersion: doc?.baseVersion ?? pub.version };
}

export type PublishResult =
  | { ok: true; version: number; fields: number; entities: number }
  | { ok: false; reason: "empty" | "conflict"; version: number };

/**
 * Draft → published, in one Blob write.
 *
 * The version guard is the whole concurrency story: a draft remembers the version it started from,
 * so two tabs (or two devices) cannot silently clobber each other — the loser gets a 409 and the
 * union of both drafts is still in the store to merge by hand.
 */
export async function publish(): Promise<PublishResult> {
  const draft = await readDraft();
  const pub = await published();
  if (!draft || fieldCount(draft) === 0) return { ok: false, reason: "empty", version: pub.version };
  if ((draft.baseVersion ?? pub.version) !== pub.version) {
    return { ok: false, reason: "conflict", version: pub.version };
  }

  const entities = { ...pub.entities };
  for (const [key, entry] of Object.entries(draft.entities)) {
    const prev = entities[key];
    entities[key] = {
      rev: pub.version + 1,
      updatedAt: entry.updatedAt,
      fields: { ...(prev?.fields ?? {}), ...entry.fields },
    };
  }

  const next: OverrideDoc = {
    version: pub.version + 1,
    generated: new Date().toISOString(),
    entities,
  };

  const kv = store("cms");
  await kv.set(`versions/v${next.version}.json`, JSON.stringify(next));
  await kv.set(DOC_KEY, JSON.stringify(next));
  await kv.del(DRAFT_KEY);

  const index = (await readJson<VersionRow[]>(INDEX_KEY)) ?? [];
  index.push({
    version: next.version,
    at: next.generated,
    fields: fieldCount(next),
    entities: entityCount(next),
  });
  const kept = index.slice(-KEEP_VERSIONS);
  await kv.set(INDEX_KEY, JSON.stringify(kept));
  const stale = index.slice(0, -KEEP_VERSIONS);
  for (const row of stale) await kv.del(`versions/v${row.version}.json`);

  return { ok: true, version: next.version, fields: fieldCount(next), entities: entityCount(next) };
}

export async function versions(): Promise<VersionRow[]> {
  return ((await readJson<VersionRow[]>(INDEX_KEY)) ?? []).slice().reverse();
}

/** One version's document, for the review sheet's "compare with version N". */
export async function versionDoc(v: number): Promise<OverrideDoc | null> {
  return readJson<OverrideDoc>(`versions/v${v}.json`);
}

/** Fields set on one entity, published + draft — the inspector's per-entity view. */
export async function entityFields(key: string): Promise<Record<string, unknown>> {
  const pub = await published();
  const draft = await readDraft();
  return {
    ...(pub.entities[key]?.fields ?? {}),
    ...(draft?.entities[key]?.fields ?? {}),
  };
}

/**
 * Drop one field (or one entity's fields) from the published document — "back to the feed value".
 *
 * This is not an edit: the feed value is whatever `data.json` holds, so removing the override *is*
 * the revert. It publishes a new version like any other change, so the history shows the revert
 * rather than the override quietly disappearing.
 */
export async function revert(entity: string, id: string, path?: string): Promise<PublishResult> {
  const pub = await published();
  const key = entityKey(entity, id);
  const entry = pub.entities[key];
  if (!entry || Object.keys(entry.fields).length === 0) return { ok: false, reason: "empty", version: pub.version };

  const fields = { ...entry.fields };
  if (path) delete fields[path];
  else for (const k of Object.keys(fields)) delete fields[k];

  const entities = { ...pub.entities };
  if (Object.keys(fields).length === 0) delete entities[key];
  else entities[key] = { ...entry, rev: pub.version + 1, updatedAt: new Date().toISOString(), fields };

  const next: OverrideDoc = { version: pub.version + 1, generated: new Date().toISOString(), entities };
  const kv = store("cms");
  await kv.set(`versions/v${next.version}.json`, JSON.stringify(next));
  await kv.set(DOC_KEY, JSON.stringify(next));

  const index = (await readJson<VersionRow[]>(INDEX_KEY)) ?? [];
  index.push({
    version: next.version,
    at: next.generated,
    fields: fieldCount(next),
    entities: entityCount(next),
  });
  const kept = index.slice(-KEEP_VERSIONS);
  await kv.set(INDEX_KEY, JSON.stringify(kept));

  return { ok: true, version: next.version, fields: fieldCount(next), entities: entityCount(next) };
}

export { setPath };
