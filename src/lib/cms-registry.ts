/**
 * The CMS field registry — one table read by both sides.
 *
 * The dock picks a control from `type`; the function validates every write against the same row, so a
 * field cannot be added to the UI without also being writable, and nothing outside this table can be
 * written at all. Keep this file dependency-free: the Netlify function bundles it, and the client
 * imports it directly.
 *
 * `path` is the dot path inside the entity object (`scouting.report`). `key` is `entity.path` and is
 * what travels over the wire and appears in a data-cms attribute.
 */

export type EntityType = "player" | "team" | "league" | "site";

export type FieldType =
  | "text"
  | "prose"
  | "number"
  | "date"
  | "select"
  | "list"
  | "people"
  | "colors"
  | "image";

export interface FieldDef {
  key: string;
  entity: EntityType;
  path: string;
  type: FieldType;
  label: string;
  /** max characters for text/prose/list items */
  max?: number;
  /** inclusive numeric bounds */
  min?: number;
  maxNum?: number;
  options?: readonly string[];
  /** display text per option, when the stored code is not the label ("L" → "Left") */
  labels?: Record<string, string>;
  /** keys every entry of a `people` array carries */
  item?: readonly string[];
}

const POSITIONS = ["A", "M", "D", "G", "FO", "LSM", "F", "T", "R"] as const;

const POSITION_LABELS: Record<string, string> = {
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

export const FIELDS: readonly FieldDef[] = [
  // ------------------------------- player ---------------------------------
  { key: "player.name", entity: "player", path: "name", type: "text", label: "Name", max: 60 },
  { key: "player.firstName", entity: "player", path: "firstName", type: "text", label: "First name", max: 40 },
  { key: "player.lastName", entity: "player", path: "lastName", type: "text", label: "Last name", max: 40 },
  { key: "player.bio", entity: "player", path: "bio", type: "prose", label: "Bio", max: 2000 },
  { key: "player.scouting.report", entity: "player", path: "scouting.report", type: "prose", label: "Scouting report", max: 2000 },
  { key: "player.scouting.author", entity: "player", path: "scouting.author", type: "text", label: "Report author", max: 80 },
  { key: "player.scouting.date", entity: "player", path: "scouting.date", type: "date", label: "Report date" },
  { key: "player.strengths", entity: "player", path: "strengths", type: "list", label: "Strengths", max: 60 },
  { key: "player.highSchool", entity: "player", path: "highSchool", type: "text", label: "High school", max: 80 },
  { key: "player.birthplace.city", entity: "player", path: "birthplace.city", type: "text", label: "Hometown", max: 60 },
  { key: "player.birthplace.state", entity: "player", path: "birthplace.state", type: "text", label: "State / province", max: 40 },
  { key: "player.birthplace.country", entity: "player", path: "birthplace.country", type: "text", label: "Country", max: 40 },
  { key: "player.dob", entity: "player", path: "dob", type: "date", label: "Date of birth" },
  { key: "player.hand", entity: "player", path: "hand", type: "select", label: "Shoots", options: ["L", "R", ""], labels: { L: "Left", R: "Right", "": "Not set" } },
  { key: "player.heightIn", entity: "player", path: "heightIn", type: "number", label: "Height (in)", min: 55, maxNum: 96 },
  { key: "player.weightLb", entity: "player", path: "weightLb", type: "number", label: "Weight (lb)", min: 100, maxNum: 350 },
  { key: "player.jersey", entity: "player", path: "jersey", type: "number", label: "Jersey", min: 0, maxNum: 99 },
  { key: "player.position", entity: "player", path: "position", type: "select", label: "Position", options: POSITIONS, labels: POSITION_LABELS },
  { key: "player.classYear", entity: "player", path: "classYear", type: "number", label: "Class of", min: 1950, maxNum: 2100 },
  { key: "player.awards", entity: "player", path: "awards", type: "people", label: "Awards", item: ["year", "title", "team"] },
  { key: "player.photo", entity: "player", path: "photo", type: "image", label: "Headshot" },

  // -------------------------------- team ----------------------------------
  { key: "team.name", entity: "team", path: "name", type: "text", label: "Team name", max: 80 },
  { key: "team.shortName", entity: "team", path: "shortName", type: "text", label: "Short name", max: 40 },
  { key: "team.city", entity: "team", path: "city", type: "text", label: "City", max: 60 },
  { key: "team.region", entity: "team", path: "region", type: "text", label: "State / province", max: 40 },
  { key: "team.conference", entity: "team", path: "conference", type: "text", label: "Conference", max: 60 },
  { key: "team.colors", entity: "team", path: "colors", type: "colors", label: "Colours" },
  { key: "team.staff", entity: "team", path: "staff", type: "people", label: "Staff", item: ["name", "role"] },
  { key: "team.logo", entity: "team", path: "logo", type: "image", label: "Logo" },

  // ------------------------------- league ---------------------------------
  { key: "league.name", entity: "league", path: "name", type: "text", label: "League name", max: 80 },
  { key: "league.short", entity: "league", path: "short", type: "text", label: "Short name", max: 24 },
  { key: "league.level", entity: "league", path: "level", type: "text", label: "Level", max: 40 },
  { key: "league.type", entity: "league", path: "type", type: "select", label: "Game type", options: ["field", "box"] },
  { key: "league.country", entity: "league", path: "country", type: "text", label: "Country", max: 40 },

  // -------------------------------- site ----------------------------------
  // copy that has no feed behind it at all: the first proof the layer works
  { key: "site.heroEyebrow", entity: "site", path: "heroEyebrow", type: "text", label: "Hero eyebrow", max: 60 },
  { key: "site.heroTail", entity: "site", path: "heroTail", type: "text", label: "Hero headline", max: 40 },
  { key: "site.heroLede", entity: "site", path: "heroLede", type: "prose", label: "Hero standfirst", max: 400 },
  { key: "site.banner", entity: "site", path: "banner", type: "text", label: "Site banner", max: 140 },
] as const;

export const fieldByKey = new Map(FIELDS.map((f) => [f.key, f]));

/** Every id in the dataset is a lowercase slug; refuse anything that could not be one. */
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** A field can never be longer than this, whatever its own cap says. */
export const HARD_MAX = 20000;

export interface Patch {
  entity: EntityType;
  id: string;
  path: string;
  value: unknown;
}

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

const ok = <T,>(value: T): Ok<T> => ({ ok: true, value });
const bad = (error: string): Err => ({ ok: false, error });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Strip control characters (keeping newlines in prose) and trim trailing space. */
function cleanString(raw: string, multiline: boolean): string {
  const allowed = multiline ? /[\u0009\u000A\u0020-\u007E\u00A0-\uFFFF]/g : /[\u0020-\u007E\u00A0-\uFFFF]/g;
  return (raw.match(allowed)?.join("") ?? "").replace(/[ \t]+$/gm, "").trim();
}

function validateValue(f: FieldDef, value: unknown): Result<unknown> {
  switch (f.type) {
    case "text":
    case "prose": {
      if (typeof value !== "string") return bad("expected a string");
      const s = cleanString(value, f.type === "prose");
      if (s.length > Math.min(f.max ?? 200, HARD_MAX)) return bad(`longer than ${f.max} characters`);
      return ok(s);
    }
    case "number": {
      const n = typeof value === "string" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) return bad("expected a whole number");
      if (f.min !== undefined && n < f.min) return bad(`below ${f.min}`);
      if (f.maxNum !== undefined && n > f.maxNum) return bad(`above ${f.maxNum}`);
      return ok(n);
    }
    case "date": {
      if (value === "" || value === null) return ok("");
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return bad("expected YYYY-MM-DD");
      const d = new Date(`${value}T12:00:00Z`);
      if (Number.isNaN(d.getTime())) return bad("not a real date");
      const year = d.getUTCFullYear();
      if (year < 1900 || year > new Date().getUTCFullYear()) return bad(`year out of range: ${year}`);
      return ok(value);
    }
    case "select": {
      const s = typeof value === "string" ? value.trim() : value;
      if (s === "" || s === null) return ok("");
      if (typeof s !== "string" || !f.options?.includes(s)) return bad(`not one of ${f.options?.join(", ")}`);
      return ok(s);
    }
    case "list": {
      if (!Array.isArray(value)) return bad("expected a list");
      if (value.length > 40) return bad("more than 40 entries");
      const out: string[] = [];
      for (const raw of value) {
        if (typeof raw !== "string") return bad("entries must be text");
        const s = cleanString(raw, false);
        if (!s) continue;
        if (s.length > Math.min(f.max ?? 200, HARD_MAX)) return bad("entry too long");
        out.push(s);
      }
      return ok(out);
    }
    case "people": {
      if (!Array.isArray(value)) return bad("expected a list");
      if (value.length > 40) return bad("more than 40 entries");
      const keys = f.item ?? [];
      const out: Record<string, string | number>[] = [];
      for (const raw of value) {
        if (!isRecord(raw)) return bad("entries must be objects");
        const row: Record<string, string | number> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (!keys.includes(k)) return bad(`unexpected key: ${k}`);
          if (typeof v === "number" && Number.isFinite(v)) row[k] = v;
          else if (typeof v === "string") {
            const s = cleanString(v, false);
            if (s.length > 120) return bad(`${k} is too long`);
            row[k] = s;
          } else return bad(`${k} must be text`);
        }
        if (keys.includes("name") && !row.name) continue; // an empty staff row is not an entry
        if (Object.values(row).some((v) => v !== "")) out.push(row);
      }
      return ok(out);
    }
    case "colors": {
      if (!Array.isArray(value) || value.length !== 2) return bad("expected two colours");
      const out = value.map((c) => (typeof c === "string" ? c.trim() : c));
      if (!out.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))) return bad("expected #rrggbb");
      return ok(out);
    }
    case "image": {
      if (value === "" || value === null || value === undefined) return ok("");
      if (typeof value !== "string") return bad("expected a path");
      const s = value.trim().replace(/^\/+/, "");
      // uploaded media or a path the importer wrote — never an absolute or remote URL
      if (!/^(media|logos|players)\/[a-z0-9][a-z0-9/_.-]*\.(webp|png|jpe?g)$/i.test(s)) return bad("expected an image path");
      return ok(s);
    }
  }
}

/** Field lookup by `entity.path`, since a patch carries the path and not the key. */
export function fieldFor(entity: string, path: string): FieldDef | undefined {
  return FIELDS.find((f) => f.entity === entity && f.path === path);
}

export function validatePatch(raw: unknown): Result<Patch> {
  if (!isRecord(raw)) return bad("expected an object");
  const { entity, id, path, value } = raw;
  if (typeof entity !== "string") return bad("missing entity");
  if (typeof id !== "string" || !ID_RE.test(id)) return bad("bad entity id");
  if (typeof path !== "string") return bad("missing path");
  const f = fieldFor(entity, path);
  if (!f) return bad(`not an editable field: ${entity}.${path}`);
  const v = validateValue(f, value);
  if (!v.ok) return bad(`${f.label}: ${v.error}`);
  return ok({ entity: entity as EntityType, id, path, value: v.value });
}

/** Read a dot path out of an object, for before/after comparison and the review sheet. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!isRecord(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Write a dot path, creating intermediate objects. Returns a new object (never mutates the input). */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const parts = path.split(".");
  const clone: Record<string, unknown> = isRecord(obj) ? { ...(obj as Record<string, unknown>) } : {};
  let cur = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    cur[parts[i]] = isRecord(next) ? { ...next } : {};
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return clone as T;
}
