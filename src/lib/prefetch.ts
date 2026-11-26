/**
 * Warm the slice for the page the visitor is about to open.
 *
 * Two shapes, both cheap: a nav link under the pointer or the keyboard focus warms exactly that
 * route, and the two small directory routes are warmed once the browser is idle so the first click
 * already has an answer. The store is the same one `src/lib/cache.ts` writes, so a warmed route
 * paints before its own fetch settles.
 *
 * Nothing here runs on a metered or slow connection: `saveData` and a 2G-class effective type both
 * opt out, and a route is never warmed twice in one page life.
 */
import { warmSlice } from "./cache";
import { sliceUrlForPath } from "./data";

const warmed = new Set<string>();

function constrained(): boolean {
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  if (conn?.saveData) return true;
  return conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g";
}

/** The in-site path an anchor points at, or null for anything off-site or hash-only. */
function localPath(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  return url.pathname;
}

function warmPath(pathname: string | null): void {
  if (!pathname || constrained()) return;
  const url = sliceUrlForPath(pathname);
  if (!url || warmed.has(url)) return;
  warmed.add(url);
  void warmSlice(url);
}

function fromEvent(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a[href]");
  if (anchor instanceof HTMLAnchorElement) warmPath(localPath(anchor));
}

export function installPrefetch(): void {
  document.addEventListener("pointerover", fromEvent, { passive: true });
  document.addEventListener("focusin", fromEvent, { passive: true });

  const idle = () => {
    if (constrained()) return;
    warmPath("/leagues");
    warmPath("/teams");
  };
  const ric = (window as unknown as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (ric) ric(idle, { timeout: 4000 });
  else setTimeout(idle, 2500);
}
