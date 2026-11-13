/**
 * The editor surface: the dock, the hover overlay, the inline input and the review sheet.
 *
 * Loaded lazily, and only when the editor is on (⌘⇧E or ?edit=1). It does not wrap the page or touch
 * a single element's markup: it listens at document level for `[data-cms]` targets and paints one
 * fixed-position box over whichever one the pointer is on. That is what keeps the pages unaware of it
 * beyond the attribute, and it is why a chip inside an `overflow: hidden` card still gets its label.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commitField,
  discardAll,
  dropField,
  publishDraft,
  signIn,
  signOut,
  stopEditing,
  undoLast,
  useCms,
  fieldOf,
  type PendingField,
} from "../../lib/cms";
import { fieldFor } from "../../lib/cms-registry";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Target {
  rect: Rect;
  entity: string;
  id: string;
  path: string;
  label: string;
  type: string;
  value: string;
  options?: readonly string[];
  labels?: Record<string, string>;
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

/** How wide the box has to be to look like a field over this element. */
const boxOf = (el: Element, type: string): Rect => {
  const r = rectOf(el);
  const width = Math.max(r.width, type === "prose" ? 320 : 180);
  const height = type === "prose" ? Math.max(r.height, 96) : Math.max(r.height + 8, 38);
  return {
    top: r.top - 4,
    left: Math.min(r.left - 10, window.innerWidth - width - 24),
    width,
    height,
  };
};

const toInput = (value: unknown, type: string): string => {
  if (value == null) return "";
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value, null, type === "people" ? 2 : 0);
  return String(value);
};

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "string") return v.trim() ? (v.length > 90 ? `${v.slice(0, 90)}…` : v) : "(empty)";
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : "(none)";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function Editor() {
  const cms = useCms();
  const [hover, setHover] = useState<Target | null>(null);
  const [editing, setEditing] = useState<Target | null>(null);
  const [draft, setDraft] = useState("");
  const [review, setReview] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [notice, setNotice] = useState<{ text: string; kind: "" | "ok" | "bad" } | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  /* ------------------------------- the page -------------------------------- */

  const read = useCallback((el: Element): Target | null => {
    const f = fieldOf(el);
    if (!f) return null;
    const def = fieldFor(f.entity, f.path);
    if (!def) return null;
    const value = el.getAttribute("data-cms-value") ?? el.textContent ?? "";
    return {
      rect: rectOf(el),
      entity: f.entity,
      id: f.id,
      path: f.path,
      label: f.label,
      type: def.type,
      value,
      options: def.options,
      labels: def.labels,
    };
  }, []);

  useEffect(() => {
    if (cms.mode === "off" || editing) return;

    let frame = 0;
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-cms]") ?? null;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!el) {
          setHover(null);
          return;
        }
        const next = read(el);
        setHover((prev) =>
          prev && next && prev.id === next.id && prev.path === next.path ? { ...next, rect: prev.rect } : next
        );
      });
    };

    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-cms]") ?? null;
      if (!el) return;
      // never let an edited element do its own thing (navigate, toggle) while the editor is on
      e.preventDefault();
      e.stopPropagation();
      const target = read(el);
      if (!target) return;
      const def = fieldFor(target.entity, target.path);
      if (!def || !["text", "prose", "number", "date", "select"].includes(def.type)) {
        setNotice({ text: `${target.label}: that control arrives with the next pass`, kind: "" });
        return;
      }
      setEditing({ ...target, rect: boxOf(el, def.type) });
      setDraft(toInput(def.type === "select" ? el.getAttribute("data-cms-value") ?? target.value : target.value, def.type));
    };

    const onScroll = () => {
      if (!hover) return;
      const el = document.querySelector(`[data-cms="${hover.entity}.${hover.path}"][data-cms-id="${hover.id}"]`);
      if (!el) return setHover(null);
      setHover({ ...hover, rect: rectOf(el) });
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onScroll);
    };
  }, [cms.mode, editing, hover, read]);

  // focus the shadow input the moment it appears
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
  }, [editing]);

  // the page's own values are the input's starting point; a select needs its raw code
  useEffect(() => {
    if (!editing) return;
    const el = document.querySelector(`[data-cms="${editing.entity}.${editing.path}"][data-cms-id="${editing.id}"]`);
    const raw = el?.getAttribute("data-cms-value");
    if (raw != null) setDraft(raw);
  }, [editing]);

  /* -------------------------------- actions -------------------------------- */

  const closeInput = () => {
    setEditing(null);
    setDraft("");
  };

  const commit = async () => {
    if (!editing) return;
    const value = editing.type === "number" ? (draft === "" ? 0 : Number(draft)) : draft;
    const target = { entity: editing.entity as never, id: editing.id, path: editing.path };
    closeInput();
    const ok = await commitField(target, value);
    if (!ok) setNotice({ text: cms.notice || "could not save that field", kind: "bad" });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      closeInput();
      return;
    }
    const commitKey = e.key === "Enter" && (editing?.type !== "prose" || e.metaKey || e.ctrlKey);
    if (commitKey) {
      e.preventDefault();
      e.stopPropagation();
      void commit();
    }
  };

  const exit = () => {
    if (cms.pending.length && !window.confirm(`Discard ${cms.pending.length} unsaved change(s)?`)) return;
    if (cms.pending.length) void discardAll();
    stopEditing();
  };

  // clear the transient notice after a beat
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(t);
  }, [notice]);

  // mark fields with an unsaved change, so a scan of the page shows what you touched
  useEffect(() => {
    const touched = new Map<string, Element[]>();
    document.querySelectorAll("[data-cms]").forEach((el) => {
      const f = fieldOf(el);
      if (!f) return;
      const key = `${f.entity}:${f.id}:${f.path}`;
      touched.set(key, [...(touched.get(key) ?? []), el]);
    });
    for (const [key, els] of touched) {
      const on = cms.pending.some((p) => p.key === key);
      for (const el of els) {
        if (on) el.setAttribute("data-cms-dirty", "1");
        else el.removeAttribute("data-cms-dirty");
      }
    }
  }, [cms.pending, cms.mode]);

  const count = cms.pending.length;
  const chips = useMemo(() => cms.pending.slice(-4), [cms.pending]);

  if (cms.mode === "off") return null;

  return (
    <>
      {hover && !editing ? (
        <div
          className="cms-outline"
          style={{ top: hover.rect.top, left: hover.rect.left, width: hover.rect.width, height: hover.rect.height }}
          aria-hidden="true"
        >
          <span className="cms-tip">{hover.label}</span>
        </div>
      ) : null}

      {editing ? (
        <div
          className="cms-field"
          style={{
            top: editing.rect.top,
            left: editing.rect.left,
            width: editing.rect.width,
            minHeight: editing.rect.height,
          }}
          onKeyDown={onKey}
        >
          <div className="cms-field-head">
            <span className="cms-field-label">{editing.label}</span>
            <span className="cms-field-hint">
              <kbd>esc</kbd> cancel <kbd>⌘</kbd>
              <kbd>↵</kbd> save
            </span>
          </div>
          {editing.type === "select" ? (
            <select
              ref={(el) => void (inputRef.current = el)}
              className="cms-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            >
              {(editing.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {editing.labels?.[o] ?? (o || "Not set")}
                </option>
              ))}
            </select>
          ) : editing.type === "prose" ? (
            <textarea
              ref={(el) => void (inputRef.current = el)}
              className="cms-input cms-textarea"
              value={draft}
              rows={4}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit()}
            />
          ) : (
            <input
              ref={(el) => void (inputRef.current = el)}
              className="cms-input"
              value={draft}
              inputMode={editing.type === "number" ? "numeric" : undefined}
              type={editing.type === "date" ? "date" : "text"}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit()}
            />
          )}
          <div className="cms-field-foot">
            <button type="button" className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={closeInput}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => void commit()}>
              Save
            </button>
          </div>
        </div>
      ) : null}

      {!cms.signedIn ? (
        <form
          className="cms-signin"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn(pass).then((ok) => {
              if (ok) {
                setSignOpen(false);
                setPass("");
              }
            });
          }}
        >
          <span className="cms-signin-label">Admin passphrase</span>
          <input
            className="cms-input"
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={cms.signingIn || pass.length < 6}>
            {cms.signingIn ? "Signing in…" : "Sign in"}
          </button>
          {cms.signInError ? <span className="cms-signin-err">{cms.signInError}</span> : null}
        </form>
      ) : null}

      {review ? (
        <div className="cms-sheet-backdrop" onClick={() => setReview(false)}>
          <div className="cms-sheet" role="dialog" aria-modal="true" aria-label="Review changes" onClick={(e) => e.stopPropagation()}>
            <div className="cms-sheet-head">
              <div>
                <div className="eyebrow">Review</div>
                <h2>
                  {count} change{count === 1 ? "" : "s"}
                </h2>
              </div>
              <button className="tray-x" onClick={() => setReview(false)} aria-label="Close">
                ×
              </button>
            </div>

            {count === 0 ? (
              <p className="cms-sheet-empty">
                Nothing staged. Click any outlined field on the page, or press <kbd>⌘⇧E</kbd> to leave editing.
              </p>
            ) : (
              <ul className="cms-rows">
                {cms.pending.map((row: PendingField) => (
                  <li key={row.key} className={row.error ? "is-err" : undefined}>
                    <div className="cms-row-head">
                      <span className="cms-row-where">
                        {row.entityLabel} <span className="cms-row-field">{row.label}</span>
                      </span>
                      <button className="cms-row-drop" onClick={() => void dropField(row.key)}>
                        Drop
                      </button>
                    </div>
                    <div className="cms-row-diff">
                      <span className="cms-before">{formatValue(row.before)}</span>
                      <span className="cms-arrow">→</span>
                      <span className="cms-after" title={formatValue(row.after)}>{formatValue(row.after)}</span>
                    </div>
                    {row.error ? <div className="cms-row-err">{row.error}</div> : null}
                  </li>
                ))}
              </ul>
            )}

            <div className="cms-sheet-foot">
              <span className="cms-foot-note">
                {cms.notice ? <span className={`cms-notice is-${cms.noticeKind}`}>{cms.notice}</span> : `version ${cms.version} live`}
              </span>
              <div className="cms-foot-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => void discardAll()} disabled={!count}>
                  Discard all
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!count || cms.busy}
                  onClick={() => void publishDraft().then((ok) => ok && setReview(false))}
                >
                  {cms.busy ? "Publishing…" : "Publish"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="tray tray-cms" role="toolbar" aria-label="Content editor">
        <span className="cms-mode">
          <span className={`cms-dot${notice?.kind === "bad" ? " is-bad" : ""}`} />
          Editing
        </span>
        <span className="cms-sep" />
        <div className="cms-stack">
          {chips.map((row) => (
            <span className="chip" key={row.key}>
              {row.entityLabel} <em>· {row.label}</em>
              <button className="cms-chip-x" onClick={() => void dropField(row.key)} aria-label={`Drop ${row.label}`}>
                ×
              </button>
            </span>
          ))}
        </div>
        <span className="count">
          {count ? (
            <>
              <b>{count}</b> unsaved
            </>
          ) : (
            "all saved"
          )}
        </span>
        <div className="tray-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => void undoLast()} disabled={!count || cms.busy}>
            Undo
          </button>
          <button className="btn btn-ghost btn-sm btn-discard" onClick={() => void discardAll()} disabled={!count || cms.busy}>
            Discard
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setReview(true)}>
            Review{count ? ` · ${count}` : ""}
          </button>
          {cms.signedIn ? (
            <button className="tray-x" onClick={() => void signOut()} title="Sign out" aria-label="Sign out">
              ⏻
            </button>
          ) : null}
          <button className="tray-x" onClick={exit} title="Leave editing" aria-label="Leave editing">
            ×
          </button>
        </div>
      </div>

      {notice && !review ? <div className={`cms-toast is-${notice.kind}`}>{notice.text}</div> : null}
    </>
  );
}
