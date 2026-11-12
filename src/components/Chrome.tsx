import React, { useEffect, useMemo, useState } from "react";
import {
  Menu as MenuIcon,
  Moon,
  Search,
  Sun,
  X,
} from "lucide-react";
import { Link, navigate, useCompare, useRoute, useTheme } from "../lib/app";
import { useRoster } from "../lib/storage";
import { data, playerById, searchPlayers, positionLabel, teamOf } from "../lib/data";
import { PlayerAvatar } from "./ui";
import { Button } from "./shadcn/button";
import { Input } from "./shadcn/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./shadcn/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./shadcn/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./shadcn/sheet";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./shadcn/command";

/* ----------------------------------- nav ---------------------------------- */

const NAV = [
  { to: "/players", label: "Players" },
  { to: "/teams", label: "Teams" },
  { to: "/leagues", label: "Leagues" },
  { to: "/compare", label: "Compare" },
  { to: "/history", label: "History" },
  { to: "/my-roster", label: "My roster" },
];

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <span className="grid size-7 place-items-center rounded-[9px] bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="M6.6 6.2c3.1 2.4 7.7 9.2 10.8 11.6M17.4 6.2C14.3 8.6 9.7 15.4 6.6 17.8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="text-[15px] tracking-[-0.01em]">LAXDB</span>
    </Link>
  );
}

export function Nav() {
  const route = useRoute();
  const { theme, setTheme } = useTheme();
  const roster = useRoster();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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

  useEffect(() => setMenuOpen(false), [route.path]);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border/80 bg-[var(--nav-bg)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-1.5 px-4 sm:px-6">
          <Wordmark className="mr-2" />

          <nav aria-label="Main" className="hidden md:flex items-center gap-0.5 whitespace-nowrap">
            {NAV.map((n) => {
              const active = route.path.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`relative shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13.5px] transition-colors ${
                    active
                      ? "bg-secondary text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                  }`}
                >
                  {n.label}
                  {n.to === "/my-roster" && roster.length ? (
                    <span className="ml-1.5 inline-grid min-w-[16px] place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
                      {roster.length}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              className="gap-2 rounded-full text-muted-foreground"
            >
              <Search className="size-3.5" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] font-medium sm:inline">
                ⌘K
              </kbd>
            </Button>

            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="rounded-full" aria-label="Appearance">
                      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Appearance</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuLabel>Appearance</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTheme("light")}>Light</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")}>Dark</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full md:hidden" aria-label="Menu">
                  <MenuIcon className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[78vw] max-w-xs gap-0">
                <SheetHeader className="pb-2">
                  <SheetTitle className="text-left">
                    <Wordmark />
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col px-2 py-2">
                  {NAV.map((n) => (
                    <Link
                      key={n.to}
                      to={n.to}
                      className={`rounded-lg px-3 py-2.5 text-[15px] ${
                        route.path.startsWith(n.to)
                          ? "bg-secondary font-medium text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {n.label}
                    </Link>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* ------------------------------ command palette ---------------------------- */

type Hit =
  | { kind: "player"; to: string; label: string; sub: string; id: string }
  | { kind: "team"; to: string; label: string; sub: string }
  | { kind: "league"; to: string; label: string; sub: string };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      return data.players
        .slice()
        .sort(
          (a, b) =>
            b.awards.length + (b.rankings[0]?.rank ? 4 : 0) - (a.awards.length + (a.rankings[0]?.rank ? 4 : 0)),
        )
        .slice(0, 5)
        .map((p) => ({
          kind: "player" as const,
          to: `/player/${p.slug}`,
          label: p.name,
          sub: `${teamOf(p)?.shortName ?? ""} · ${p.positionName}`,
          id: p.id,
        }));
    }
    const players = searchPlayers(needle, 6).map((p) => ({
      kind: "player" as const,
      to: `/player/${p.slug}`,
      label: p.name,
      sub: `${teamOf(p)?.shortName ?? ""} · ${positionLabel[p.position]}`,
      id: p.id,
    }));
    const teams = data.teams
      .filter((t) => t.name.toLowerCase().includes(needle) || t.shortName.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((t) => ({ kind: "team" as const, to: `/team/${t.slug}`, label: t.name, sub: t.city ?? "" }));
    const leagues = data.leagues
      .filter((l) => l.name.toLowerCase().includes(needle) || l.short.toLowerCase().includes(needle))
      .slice(0, 3)
      .map((l) => ({ kind: "league" as const, to: `/league/${l.id}`, label: l.name, sub: l.level ?? "" }));
    return [...players, ...teams, ...leagues];
  }, [q]);

  const groups = useMemo(() => {
    const by = {
      player: [] as Extract<Hit, { kind: "player" }>[],
      team: [] as Extract<Hit, { kind: "team" }>[],
      league: [] as Extract<Hit, { kind: "league" }>[],
    };
    for (const h of hits) {
      if (h.kind === "player") by.player.push(h);
      else if (h.kind === "team") by.team.push(h);
      else by.league.push(h);
    }
    return by;
  }, [hits]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      shouldFilter={false}
      showCloseButton={false}
      className="max-w-lg"
    >
      <CommandInput placeholder="Search players, teams, leagues…" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>No matches for “{q}”.</CommandEmpty>
        {groups.player.length ? (
          <CommandGroup heading="Players">
            {groups.player.map((h) => (
              <CommandItem key={h.to} value={`${h.label} ${h.sub}`} onSelect={() => go(h.to)}>
                <PlayerAvatar player={playerById.get(h.id)!} size={22} />
                <span className="truncate">{h.label}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{h.sub}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {groups.team.length ? (
          <CommandGroup heading="Teams">
            {groups.team.map((h) => (
              <CommandItem key={h.to} value={`${h.label} ${h.sub}`} onSelect={() => go(h.to)}>
                <span className="grid size-[22px] place-items-center rounded-md bg-secondary text-[10px]">◆</span>
                <span className="truncate">{h.label}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{h.sub}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {groups.league.length ? (
          <CommandGroup heading="Competitions">
            {groups.league.map((h) => (
              <CommandItem key={h.to} value={`${h.label} ${h.sub}`} onSelect={() => go(h.to)}>
                <span className="grid size-[22px] place-items-center rounded-md bg-secondary text-[10px]">◎</span>
                <span className="truncate">{h.label}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{h.sub}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

/* ------------------------------- compare tray ------------------------------ */

export function CompareTray() {
  const { ids, clear, toggle } = useCompare();
  const route = useRoute();
  if (ids.length === 0 || route.path === "/compare") return null;
  const players = ids.map((id) => playerById.get(id)).filter(Boolean);

  return (
    <div className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-24px)] max-w-md -translate-x-1/2 rounded-2xl border border-border bg-card/95 p-2 shadow-lg backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {players.map((p) => (
            <div
              key={p!.id}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary py-1 pl-1 pr-1.5"
            >
              <PlayerAvatar player={p!} size={22} />
              <span className="max-w-[92px] truncate text-xs font-medium">{p!.lastName}</span>
              <button
                onClick={() => toggle(p!.id)}
                className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-background"
                aria-label={`Remove ${p!.name}`}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={clear} className="shrink-0">
          Clear
        </Button>
        <Button size="sm" asChild className="shrink-0">
          <Link to={`/compare?ids=${ids.join(",")}`}>
            Compare {ids.length > 1 ? `(${ids.length})` : ""}
          </Link>
        </Button>
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
            <Link to="/history">History</Link>
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
        <span>© 2026 LAXDB. Data compiled from public NCAA and PLL sources; not affiliated with either.</span>
        <span>Field lacrosse · 2023–2026</span>
      </div>
    </footer>
  );
}
