import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/* ---------------------------------- router --------------------------------- */

export interface Route {
  path: string;
  query: URLSearchParams;
}

/**
 * Real paths, not hashes: a crawler and a chat unfurler have to be able to ask for
 * /player/cj-kirst and get that player's page. Every link written before this change used
 * `#/…`, so the hash form is still read (and rewritten to the path form on arrival).
 */
function parseLocation(): Route {
  const raw = window.location.hash.startsWith("#/")
    ? window.location.hash.slice(1)
    : window.location.pathname + window.location.search;
  const [path, qs] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(qs ?? "") };
}

const RouteCtx = createContext<Route>({ path: "/", query: new URLSearchParams() });

import { sliceMode } from "./slice";
import { pageSliceActive } from "./page";

const ROUTE_EVENT = "laxdb:navigate";

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<Route>(parseLocation);

  useEffect(() => {
    // an old `#/player/x` link becomes the canonical path before anything is rendered twice
    if (window.location.hash.startsWith("#/")) {
      const raw = window.location.hash.slice(1);
      window.history.replaceState(null, "", raw);
      setRoute(parseLocation());
    }

    const onChange = () => {
      setRoute(parseLocation());
      // back/forward keeps the browser's own scroll restoration; only a pushed navigation starts
      // at the top (see navigate()), or going back lands at the top of the page every time
      if (window.history.state?.laxdbPush) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      else restoreScroll(keyOf());
    };
    window.addEventListener("popstate", onChange);
    window.addEventListener(ROUTE_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(ROUTE_EVENT, onChange);
    };
  }, []);

  return <RouteCtx.Provider value={route}>{children}</RouteCtx.Provider>;
}

export const useRoute = () => useContext(RouteCtx);

/**
 * Scroll positions by path, so Back lands where the visitor left. The browser's own restoration
 * runs before React has painted the route, and a list that is still loading is too short to scroll
 * to 900 — the measured result was 338 of 900. Recording the position on the way out and applying
 * it once the document is tall enough is what makes it exact.
 */
const scrollMemory = new Map<string, number>();
const keyOf = () => window.location.pathname + window.location.search;

function restoreScroll(key: string, tries = 25): void {
  const y = scrollMemory.get(key) ?? 0;
  if (!y) return;
  let n = 0;
  const tick = () => {
    if (document.documentElement.scrollHeight >= y + window.innerHeight - 4 || n >= tries) {
      window.scrollTo(0, y);
      return;
    }
    n += 1;
    setTimeout(tick, 80);
  };
  setTimeout(tick, 60);
}

/** Push a new URL. `to` is a path with an optional query ("/players?league=ncaa-d1"). */
export function navigate(to: string, { replace = false }: { replace?: boolean } = {}) {
  const here = window.location.pathname + window.location.search;
  // a slice-built page holds one route's data only, so any move is a fresh document: the next page
  // loads the full dataset unless its own URL asks for a slice
  if (sliceMode() || pageSliceActive()) {
    if (to === here) return;
    window.location.assign(to);
    return;
  }
  if (here === to) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  // remember where the visitor was, so Back can put them back there (see restoreScroll)
  scrollMemory.set(here, window.scrollY);
  // `laxdbPush` is what tells the router a popstate came from a link click rather than the back
  // button: only the former resets the scroll position
  if (replace) window.history.replaceState({ laxdbPush: false }, "", to);
  else window.history.pushState({ laxdbPush: true }, "", to);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

export function Link({
  to,
  children,
  className,
  onClick,
  ...rest
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        // a modified click belongs to the browser: it opens the real URL in a new tab
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/* ---------------------------------- theme ---------------------------------- */

type Theme = "light" | "dark";

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("laxdb-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("laxdb-theme", theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#000000" : "#fbfbfd");
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((t) => (t === "light" ? "dark" : "light")),
    []
  );

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

/* ------------------------------- compare tray ------------------------------ */

const CompareCtx = createContext<{
  ids: string[];
  toggle: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
}>({ ids: [], toggle: () => {}, clear: () => {}, has: () => false });

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("laxdb-compare") ?? "[]");
      return Array.isArray(saved) ? saved.slice(0, 3) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("laxdb-compare", JSON.stringify(ids));
  }, [ids]);

  const toggle = useCallback((id: string) => {
    setIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 3) return [...cur.slice(1), id];
      return [...cur, id];
    });
  }, []);

  const value = useMemo(
    () => ({
      ids,
      toggle,
      clear: () => setIds([]),
      has: (id: string) => ids.includes(id),
    }),
    [ids, toggle]
  );

  return <CompareCtx.Provider value={value}>{children}</CompareCtx.Provider>;
}

export const useCompare = () => useContext(CompareCtx);
