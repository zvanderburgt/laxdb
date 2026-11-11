import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, navigate, useCompare, useRoute, useTheme } from "../lib/app";
import {
  data,
  playerById,
  searchPlayers,
  teamById,
  teamOf,
  positionLabel,
} from "../lib/data";
import { PlayerAvatar } from "./ui";

/* ----------------------------------- nav ---------------------------------- */

const NAV = [
  { to: "/players", label: "Players" },
  { to: "/teams", label: "Teams" },
  { to: "/leagues", label: "Leagues" },
  { to: "/compare", label: "Compare" },
];

export function Nav() {
  const route = useRoute();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className={`nav ${scrolled ? "is-scrolled" : ""}`}>
        <div className="nav-inner">
          <Link to="/" className="wordmark" aria-label="LAXDB home">
            <span className="mark">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M6.6 6.2c3.1 2.4 7.7 9.2 10.8 11.6M17.4 6.2C14.3 8.6 9.7 15.4 6.6 17.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            LAXDB
          </Link>
          <nav className="nav-links" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`nav-link ${route.path.startsWith(n.to) ? "is-active" : ""}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="nav-right">
            <button className="searchbtn" onClick={() => setOpen(true)} aria-label="Search">
              <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12.8 12.8L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span className="searchbtn-text">Search</span>
              <kbd>⌘K</kbd>
            </button>
            <button className="iconbtn" onClick={toggle} aria-label="Toggle appearance">
              {theme === "dark" ? (
                <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
                  <circle cx="10" cy="10" r="4" fill="currentColor" />
                  <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M10 1.6v2M10 16.4v2M1.6 10h2M16.4 10h2M3.9 3.9l1.4 1.4M14.7 14.7l1.4 1.4M16.1 3.9l-1.4 1.4M5.3 14.7l-1.4 1.4" />
                  </g>
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
                  <path d="M16.5 12.4A7.2 7.2 0 016.6 3.5a7.5 7.5 0 109.9 8.9z" fill="currentColor" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* ------------------------------ command palette ---------------------------- */

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      const hot = data.players
        .slice()
        .sort((a, b) => (b.awards.length + (b.rankings[0]?.rank ? 4 : 0)) - (a.awards.length + (a.rankings[0]?.rank ? 4 : 0)))
        .slice(0, 5);
      return hot.map((p) => ({ kind: "Player" as const, to: `/player/${p.slug}`, label: p.name, sub: `${teamOf(p)?.shortName ?? ""} · ${p.positionName}` }));
    }
    const players = searchPlayers(needle, 6).map((p) => ({
      kind: "Player" as const,
      to: `/player/${p.slug}`,
      label: p.name,
      sub: `${teamOf(p)?.shortName ?? ""} · ${positionLabel[p.position]}`,
    }));
    const teams = data.teams
      .filter((t) => t.name.toLowerCase().includes(needle) || t.shortName.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((t) => ({ kind: "Team" as const, to: `/team/${t.slug}`, label: t.name, sub: t.city }));
    const leagues = data.leagues
      .filter((l) => l.name.toLowerCase().includes(needle) || l.short.toLowerCase().includes(needle))
      .slice(0, 3)
      .map((l) => ({ kind: "League" as const, to: `/league/${l.id}`, label: l.name, sub: `${l.level}` }));
    return [...players, ...teams, ...leagues];
  }, [q]);

  useEffect(() => setActive(0), [q]);

  if (!open) return null;

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="palette-input">
          <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12.8 12.8L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search players, teams, leagues…"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === "Enter" && results[active]) go(results[active].to);
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list">
          {results.length === 0 ? (
            <div className="palette-empty">No matches for “{q}”</div>
          ) : (
            results.map((r, i) => {
              const p = r.kind === "Player" ? data.players.find((x) => `/player/${x.slug}` === r.to) : undefined;
              const t = r.kind === "Team" ? data.teams.find((x) => `/team/${x.slug}` === r.to) : undefined;
              return (
                <button
                  key={r.to}
                  className={`palette-item ${i === active ? "is-active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r.to)}
                >
                  {p ? (
                    <PlayerAvatar player={p} size={30} />
                  ) : (
                    <span className={`palette-glyph ${r.kind.toLowerCase()}`}>{r.kind === "Team" ? "◆" : "◎"}</span>
                  )}
                  <span className="palette-label">{r.label}</span>
                  <span className="palette-sub">{r.sub}</span>
                  <span className="palette-kind">{r.kind}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
          <span><kbd>↵</kbd> to open</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- compare tray ------------------------------ */

export function CompareTray() {
  const { ids, clear, toggle } = useCompare();
  const route = useRoute();
  if (ids.length === 0 || route.path === "/compare") return null;
  const players = ids.map((id) => playerById.get(id)).filter(Boolean);
  return (
    <div className="tray">
      <div className="tray-people">
        {players.map((p) => (
          <div className="tray-person" key={p!.id}>
            <PlayerAvatar player={p!} size={30} />
            <span>{p!.lastName}</span>
            <button className="tray-x" onClick={() => toggle(p!.id)} aria-label={`Remove ${p!.name}`}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="tray-actions">
        <button className="btn btn-ghost btn-sm" onClick={clear}>Clear</button>
        <Link to={`/compare?ids=${ids.join(",")}`} className="btn btn-primary btn-sm">
          Compare {ids.length > 1 ? `${ids.length} players` : "player"}
        </Link>
      </div>
    </div>
  );
}

/* ---------------------------------- footer --------------------------------- */

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="wordmark small">LAXDB</span>
          <p>The lacrosse player database. Built for scouts, coaches and fans.</p>
        </div>
        <div className="footer-cols">
          <div>
            <h4>Explore</h4>
            <Link to="/players">Players</Link>
            <Link to="/teams">Teams</Link>
            <Link to="/leagues">Leagues</Link>
            <Link to="/compare">Compare</Link>
          </div>
          <div>
            <h4>Coverage</h4>
            <span>NCAA Division I</span>
            <span>MCLA</span>
            <span>Premier Lacrosse League</span>
            <span>16 Canadian box leagues</span>
            <span>{data.players.length.toLocaleString()} players</span>
          </div>
          <div>
            <h4>Sources</h4>
            <span>NCAA.com statistics</span>
            <span>School athletics sites</span>
            <span>mcla.us · stats.netfrontsports.com</span>
            <span>PLL stats API</span>
            <span>Updated {data.meta.generated}</span>
          </div>
        </div>
      </div>
      <div className="footer-fine">
        <span>
          © 2026 LAXDB. Data compiled from public NCAA and PLL sources; not affiliated with either.
        </span>
        <span>Field lacrosse · 2023–2026</span>
      </div>
    </footer>
  );
}
