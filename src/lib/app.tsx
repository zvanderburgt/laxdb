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

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(qs ?? "") };
}

const RouteCtx = createContext<Route>({ path: "/", query: new URLSearchParams() });

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return <RouteCtx.Provider value={route}>{children}</RouteCtx.Provider>;
}

export const useRoute = () => useContext(RouteCtx);

export function navigate(to: string) {
  if (window.location.hash === `#${to}`) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  window.location.hash = to;
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
      href={`#${to}`}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
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
