/**
 * Editor state — what the dock shows and what a commit does.
 *
 * Deliberately small and dependency-free of components: pages read `useCms().mode` to decide whether
 * to draw an empty slot (a player with no bio is the common case, and it has to be editable), while
 * the dock, overlay and sheets load lazily and only when the editor is actually on.
 */
import { useSyncExternalStore } from "react";
import { fieldFor, setPath, validatePatch, type EntityType } from "./cms-registry";
import { entityObject, loadOverrides, logIn, logOut, probeSession, cmsSession, overrides } from "./overrides";

export type Mode = "off" | "select";

export interface PendingField {
  key: string;
  entity: EntityType;
  id: string;
  path: string;
  /** "Zach Miller" — the entity, for the chip and the review row */
  entityLabel: string;
  /** "Bio" — the field, from the registry */
  label: string;
  before: unknown;
  after: unknown;
  /** set when the write failed; the value is still on screen but not saved */
  error?: string;
}

export interface CmsState {
  mode: Mode;
  signedIn: boolean;
  signingIn: boolean;
  signInError: string;
  pending: PendingField[];
  /** the last thing the server said, shown in the dock while it matters */
  notice: string;
  noticeKind: "" | "ok" | "bad";
  busy: boolean;
  /** the published version the editor is looking at */
  version: number;
}

const keyOf = (entity: string, id: string, path: string) => `${entity}:${id}:${path}`;

let state: CmsState = {
  mode: "off",
  signedIn: Boolean(cmsSession),
  signingIn: false,
  signInError: "",
  pending: [],
  notice: "",
  noticeKind: "",
  busy: false,
  version: overrides.version,
};

const listeners = new Set<() => void>();

function set(patch: Partial<CmsState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const snapshot = () => state;
export const useCms = () => useSyncExternalStore(subscribe, snapshot, snapshot);

/**
 * Whether the editor is on — a boolean, so a page that only needs this does not re-render every time
 * a field is staged. Used for the "add a bio" slot, which only exists while editing.
 */
/**
 * The pages render objects we mutate in place, so React cannot know a field changed. Bumping a counter
 * after every mutation re-renders the route subtree once — cheap, and the alternative (copying the
 * dataset) would leave every derived index reading the old values.
 */
let revision = 0;
const revListeners = new Set<() => void>();
export function bumpRevision() {
  revision++;
  for (const l of revListeners) l();
}
export const useDataRevision = () =>
  useSyncExternalStore(
    (fn) => {
      revListeners.add(fn);
      return () => void revListeners.delete(fn);
    },
    () => revision,
    () => 0
  );

export const useIsEditing = () =>
  useSyncExternalStore(
    subscribe,
    () => state.mode !== "off",
    () => false
  );

/* ------------------------------- entity labels ------------------------------ */

export function entityLabelOf(entity: EntityType, id: string): string {
  const obj = entityObject(entity, id) as { name?: string; shortName?: string; short?: string } | null;
  if (!obj) return id;
  if (entity === "site") return "Site";
  return obj.name ?? obj.shortName ?? obj.short ?? id;
}

/** Turn a `data-cms` element into the field it points at. */
export function fieldOf(el: Element): { entity: EntityType; id: string; path: string; label: string } | null {
  const key = el.getAttribute("data-cms");
  const id = el.getAttribute("data-cms-id");
  if (!key || !id) return null;
  const [entity, ...rest] = key.split(".");
  const path = rest.join(".");
  const def = fieldFor(entity, path);
  if (!def) return null;
  return { entity: entity as EntityType, id, path, label: def.label };
}

/* --------------------------------- editing --------------------------------- */

export function startEditing() {
  set({ mode: "select" });
  void begin();
}

/**
 * Opening the editor: is there already a session, and if so what is staged?
 *
 * Deriving "signed in" from an in-memory variable was wrong — a reload with the hint cleared showed
 * the passphrase prompt while the cookie was still perfectly valid.
 */
async function begin() {
  const signedIn = await probeSession();
  set({ signedIn });
  if (signedIn) await refreshDraft();
}

export function stopEditing() {
  set({ mode: "off" });
}

async function refreshDraft() {
  await loadOverrides(true);
  set({ pending: draftToPending(), version: overrides.version, signedIn: Boolean(cmsSession) });
}

/** The server's draft, as pending rows. Befores were captured when the draft was applied. */
function draftToPending(): PendingField[] {
  return overrides.draftFields.map((d) => ({
    key: keyOf(d.entity, d.id, d.path),
    entity: d.entity,
    id: d.id,
    path: d.path,
    entityLabel: entityLabelOf(d.entity, d.id),
    label: fieldFor(d.entity, d.path)?.label ?? d.path,
    before: d.before,
    after: d.after,
  }));
}

/**
 * Commit one field.
 *
 * The page changes first — the editor is looking at a draft preview, so delaying the DOM until the
 * server answers would make typing feel broken. If the write fails the value stays on screen (and the
 * dock says so) rather than snapping back and losing what was typed.
 */
export async function commitField(
  target: { entity: EntityType; id: string; path: string },
  raw: unknown
): Promise<boolean> {
  const parsed = validatePatch({ ...target, value: raw });
  if (!parsed.ok) {
    set({ notice: parsed.error, noticeKind: "bad" });
    return false;
  }
  const value = parsed.value.value;
  const obj = entityObject(target.entity, target.id);
  if (!obj) {
    set({ notice: "that record is not in this dataset", noticeKind: "bad" });
    return false;
  }

  const before = fieldValue(obj, target.path);
  if (JSON.stringify(before) === JSON.stringify(value)) {
    // no change: drop any existing pending row for it rather than staging a no-op
    if (state.pending.some((p) => p.key === keyOf(target.entity, target.id, target.path))) {
      await dropField(keyOf(target.entity, target.id, target.path));
    }
    return true;
  }

  applyToObject(obj, target.path, value, target.entity);
  bumpRevision();

  const key = keyOf(target.entity, target.id, target.path);
  const row: PendingField = {
    key,
    ...target,
    entityLabel: entityLabelOf(target.entity, target.id),
    label: fieldFor(target.entity, target.path)?.label ?? target.path,
    before,
    after: value,
  };
  set({ pending: [...state.pending.filter((p) => p.key !== key), row], notice: "", noticeKind: "", busy: true });

  const res = await post("/api/draft", { patch: { ...target, value } });
  if (!res.ok) {
    set({
      busy: false,
      notice: res.error ?? "could not stage that change",
      noticeKind: "bad",
      pending: state.pending.map((p) => (p.key === key ? { ...p, error: res.error } : p)),
    });
    return false;
  }
  set({ busy: false, notice: "staged", noticeKind: "ok" });
  return true;
}

/** Drop a staged field: the page goes back to what it showed before, and the draft forgets it. */
export async function dropField(key: string) {
  const row = state.pending.find((p) => p.key === key);
  if (!row) return;
  const obj = entityObject(row.entity, row.id);
  if (obj) applyToObject(obj, row.path, row.before, row.entity, true);
  bumpRevision();
  set({ pending: state.pending.filter((p) => p.key !== key), busy: true });

  const res = await post("/api/draft", { remove: { entity: row.entity, id: row.id, path: row.path } });
  set({ busy: false, notice: res.ok ? "dropped" : res.error ?? "could not drop that change", noticeKind: res.ok ? "ok" : "bad" });
}

export async function undoLast() {
  const last = state.pending[state.pending.length - 1];
  if (last) await dropField(last.key);
}

export async function discardAll() {
  const rows = state.pending;
  for (const row of rows) {
    const obj = entityObject(row.entity, row.id);
    if (obj) applyToObject(obj, row.path, row.before, row.entity, true);
  }
  bumpRevision();
  set({ pending: [], busy: true });
  const res = await post("/api/draft", undefined, "DELETE");
  set({ busy: false, notice: res.ok ? "draft discarded" : res.error ?? "could not discard", noticeKind: res.ok ? "ok" : "bad" });
}

export async function publishDraft() {
  set({ busy: true, notice: "" });
  const res = await post("/api/publish", {});
  if (!res.ok) {
    set({ busy: false, notice: res.error ?? "publish failed", noticeKind: "bad" });
    return false;
  }
  // re-read the published document so the editor is now looking at the live values
  await loadOverrides(true);
  bumpRevision();
  set({
    busy: false,
    pending: [],
    version: overrides.version,
    notice: `published v${overrides.version}`,
    noticeKind: "ok",
  });
  return true;
}

export async function signIn(passphrase: string) {
  set({ signingIn: true, signInError: "" });
  const ok = await logIn(passphrase);
  if (!ok) {
    set({ signingIn: false, signInError: "That passphrase didn't work." });
    return false;
  }
  await loadOverrides(true);
  bumpRevision();
  set({
    signingIn: false,
    signedIn: true,
    signInError: "",
    mode: "select",
    pending: draftToPending(),
    version: overrides.version,
  });
  return true;
}

export async function signOut() {
  await logOut();
  set({ signedIn: false, pending: [], notice: "signed out", noticeKind: "" });
}

/* --------------------------------- helpers -------------------------------- */

const fieldValue = (obj: unknown, path: string): unknown => {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
};

const applyToObject = (obj: object, path: string, value: unknown, entity: EntityType, keepPositionName = false) => {
  const prevPosition = entity === "player" ? (obj as { position?: string }).position : undefined;
  const next = setPath(obj, path, value);
  Object.assign(obj, next);
  if (entity === "player" && path === "position" && !keepPositionName && prevPosition !== value) {
    // the descriptive variant ("Defensive Midfield") belonged to the old code
    (obj as { positionName?: string }).positionName = POSITION_NAME[String(value)] ?? String(value ?? "");
  }
};

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

async function post(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; error?: string }> {
  const csrf = cmsSession?.csrf;
  if (!csrf) return { ok: false, error: "not signed in" };
  try {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-cms-csrf": csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: json?.error ?? `request failed (${res.status})` };
  } catch {
    return { ok: false, error: "network error — your change is still on screen" };
  }
}

/** Used after a publish/reload so the dock's counter matches the store again. */
export const resetPending = () => set({ pending: [] });

export { overrides };
