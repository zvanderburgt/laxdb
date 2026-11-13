import React from "react";

/* ------------------------------- motion system ------------------------------
   The web's default is that a state change lands between two frames and the eye
   has to re-read the page. Everything here exists to make a change legible:
   a sorted list re-orders in place, a filtered list closes its gaps, a bar grows
   to the number it stands for. Nothing runs on scroll, and nothing may ever be
   the only reason content is visible.

   Motion values come from the CSS tokens (--dur-*, --ease-out); only durations
   JS cannot read from CSS live here. */

export const DUR = { feedback: 120, state: 240, layout: 320 } as const;
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

/** The user's motion preference, read at the moment of the animation. */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * FLIP for a list whose rows are painted from a keyed array (sort, filter,
 * remove). Rows are found by `data-k`, so a page only has to mark its rows and
 * pass the state that changed.
 *
 * Two details matter:
 * - `useLayoutEffect` runs before paint, so the browser never shows the new
 *   order for one frame and then animates it.
 * - Web Animations rather than a CSS class: a second click cancels the first
 *   animation instead of stacking two transforms.
 *
 * `max` bounds the work: a 150-row table with every row moving is 150
 * compositor layers, and past the first screenful nobody sees the rest move.
 */
export function useFlipRows(
  ref: React.RefObject<HTMLElement | null>,
  deps: React.DependencyList,
  { max = 48, duration = DUR.state }: { max?: number; duration?: number } = {},
) {
  const prev = React.useRef<Map<string, DOMRect>>(new Map());

  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-k]"));
    const next = new Map<string, DOMRect>();
    for (const row of rows) {
      const key = row.dataset.k;
      if (key) next.set(key, row.getBoundingClientRect());
    }

    const hadPrev = prev.current.size > 0;
    if (hadPrev && !reducedMotion()) {
      let moved = 0;
      for (const row of rows) {
        if (moved >= max) break;
        const key = row.dataset.k;
        if (!key) continue;
        const before = prev.current.get(key);
        const after = next.get(key);
        if (!before || !after) continue; // a new row slides in on its own; a removed one is gone
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        row.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
          duration,
          easing: EASE_OUT,
        });
        moved += 1;
      }
    }
    prev.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Tracks a DOM node's width/position so a moving indicator (the segmented
 * control's pill) can follow the selected option instead of jumping to it.
 */
export function useTrackedRect(
  container: React.RefObject<HTMLElement | null>,
  selector: string,
  deps: React.DependencyList,
): { x: number; width: number } | null {
  const [rect, setRect] = React.useState<{ x: number; width: number } | null>(null);

  React.useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) {
        setRect(null);
        return;
      }
      setRect({ x: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return rect;
}
