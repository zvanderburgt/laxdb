import React from "react";
import { Link } from "../lib/app";
import { useFlipRows, useTrackedRect } from "../lib/motion";
import type { Player, Team } from "../lib/types";
import { positionLabel, teamById } from "../lib/data";

/* --------------------------------- avatar --------------------------------- */

export function Avatar({
  name,
  colors = ["#0071e3", "#5ac8fa"],
  size = 44,
  radius,
  className = "",
  photo,
}: {
  name: string;
  colors?: [string, string];
  size?: number;
  radius?: number;
  className?: string;
  photo?: string;
}) {
  const initials = name
    .replace(/[^A-Za-z' ]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.round(size * 0.28),
        background: `linear-gradient(145deg, ${colors[0]}, ${shade(colors[0], -28)} 60%, ${colors[1]})`,
        fontSize: Math.round(size * 0.36),
      }}
      aria-hidden="true"
    >
      {photo ? <img src={photo} alt="" loading="lazy" /> : initials}
    </span>
  );
}

/** Team mark: the real logo when we have one, the colour crest otherwise. */
export function TeamLogo({
  team,
  size = 28,
  className = "",
}: {
  team?: Team;
  size?: number;
  className?: string;
}) {
  if (!team) return null;
  if (team.logo) {
    return (
      <img
        className={`team-logo ${className}`}
        src={team.logo}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        style={{ width: size, height: size }}
      />
    );
  }
  return <span className={`team-dot ${className}`} style={{ background: team.colors[0] }} />;
}

/** Avatar that knows about team colors and headshots. */
export function PlayerAvatar({
  player,
  size = 44,
  radius,
  className = "",
}: {
  player: { name: string; photo?: string; teamId: string };
  size?: number;
  radius?: number;
  className?: string;
}) {
  const team = teamById.get(player.teamId);
  return (
    <Avatar
      name={player.name}
      colors={team?.colors}
      size={size}
      radius={radius}
      className={className}
      photo={player.photo}
    />
  );
}

function shade(hex: string, amt: number) {
  const c = hex.replace("#", "");
  const n = parseInt(c.length === 3 ? c.replace(/./g, (x) => x + x) : c, 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0x00ff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0x0000ff) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/* -------------------------------- primitives ------------------------------- */

export function PositionBadge({ pos, name }: { pos: string; name?: string }) {
  return (
    <span className={`pos pos-${pos.toLowerCase()}`} title={name ?? positionLabel[pos]}>
      {pos}
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  // one pill follows the selection instead of the background blinking between two
  // buttons: the control reads as one object moving, not two states swapping
  const track = React.useRef<HTMLDivElement>(null);
  const ink = useTrackedRect(track, '[aria-selected="true"]', [value, options.length, size]);

  return (
    <div ref={track} className={`segmented seg-${size}`} role="tablist" aria-label={ariaLabel}>
      {ink ? (
        <span
          className="seg-ink"
          aria-hidden="true"
          style={{ transform: `translateX(${ink.x}px)`, width: `${ink.width}px` }}
        />
      ) : null}
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={`seg-item ${o.value === value ? "is-on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------- skeletons -------------------------------- */
/* Shapes that stand in for the layout while a fetch resolves, so nothing jumps when the
   real rows land. The whole block is decorative; the wrapper announces the wait once. */

export function Skeleton({
  w,
  h = 12,
  r = 6,
  className = "",
}: {
  w?: number | string;
  h?: number | string;
  r?: number;
  className?: string;
}) {
  return <span className={`skel ${className}`} style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

/** Table-shaped placeholder: a header line and n rows, with ragged name widths. */
export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="skel-rows">
      <div className="skel-row skel-row-head">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} h={9} w={i === 0 ? "46%" : 22} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div className="skel-row" key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={c}
              h={13}
              w={c === 0 ? `${54 + ((r * 13) % 26)}%` : 24}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A card with its real title, holding rows that are still on the way. */
export function SkeletonCard({
  title,
  sub,
  rows = 5,
  cols = 4,
}: {
  title: string;
  sub?: string;
  rows?: number;
  cols?: number;
}) {
  return (
    <Card padded={false} className="standings-card" aria-busy="true">
      <div className="card-toolbar">
        <div>
          <h3 className="card-title">{title}</h3>
          <p className="muted small">{sub ?? <Skeleton h={10} w={180} />}</p>
        </div>
      </div>
      <SkeletonRows rows={rows} cols={cols} />
    </Card>
  );
}

/** The first paint: the shell, before data.json has even arrived. */
export function AppSkeleton() {
  return (
    <div className="app" aria-busy="true">
      <span className="sr-only" role="status">Loading the player database</span>
      <div className="skel-nav" aria-hidden="true">
        <div className="skel-nav-inner">
          <Skeleton w={96} h={22} r={7} />
          <div className="skel-nav-links">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} w={48 + (i % 3) * 12} h={11} />
            ))}
          </div>
          <Skeleton w={180} h={30} r={9} />
        </div>
      </div>
      <main className="skel-main" aria-hidden="true">
        <Skeleton w={64} h={10} />
        <Skeleton w="min(520px, 72%)" h={44} r={10} />
        <Skeleton w="min(420px, 60%)" h={13} />
        <div className="skel-hero">
          <Skeleton w="100%" h={190} r={18} />
          <div className="skel-hero-side">
            <Skeleton w="100%" h={88} r={16} />
            <Skeleton w="100%" h={88} r={16} />
          </div>
        </div>
        <div className="skel-cards">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} w="100%" h={176} r={16} />
          ))}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------ abbreviations ----------------------------- */
/* Table headers print abbreviations, so each one carries the sentence a reader needs.
   A single fixed node is reused for the tooltip: cards are `overflow: hidden`, so an
   absolutely positioned tip would be clipped by the card it lives in. */

type TermEntry = { label: string; full: string; note?: string };

const TERMS: Record<string, TermEntry> = {
  gp: { label: "GP", full: "Games played" },
  gs: { label: "GS", full: "Games started" },
  g: { label: "G", full: "Goals" },
  a: { label: "AST", full: "Assists" },
  pts: { label: "PTS", full: "Points", note: "goals plus assists" },
  ppg: { label: "PTS/G", full: "Points per game" },
  sh: { label: "SH", full: "Shots" },
  shp: { label: "SH%", full: "Shooting percentage", note: "goals divided by shots" },
  gb: { label: "GB", full: "Ground balls" },
  lb: { label: "LB", full: "Loose balls", note: "the box count that replaces ground balls" },
  to: { label: "TO", full: "Turnovers" },
  ct: { label: "CT", full: "Caused turnovers" },
  fo: { label: "FO%", full: "Faceoff percentage", note: "wins divided by attempts" },
  pim: { label: "PIM", full: "Penalty minutes" },
  sv: { label: "SV", full: "Saves" },
  ga: { label: "GA", full: "Goals against" },
  gaa: { label: "GAA", full: "Goals against average", note: "per 60 minutes" },
  svp: { label: "SV%", full: "Save percentage" },
  min: { label: "MIN", full: "Minutes played" },
  w: { label: "W", full: "Wins" },
  l: { label: "L", full: "Losses" },
  t: { label: "T", full: "Ties" },
  wl: { label: "W–L", full: "Wins and losses" },
  pct: { label: "PCT", full: "Winning percentage" },
  gf: { label: "GF", full: "Goals for" },
  diff: { label: "DIFF", full: "Goal differential", note: "goals for minus goals against" },
  conf: { label: "CONF", full: "Conference record" },
  elo: { label: "ELO", full: "Elo rating", note: "1500 to start, this season only" },
  sos: { label: "SOS", full: "Strength of schedule", note: "average opponent rating" },
  consensus: { label: "CONSENSUS", full: "Consensus rank", note: "average of the poll ranks and the Elo rank, ± the spread" },
  pos: { label: "POS", full: "Position" },
  record: { label: "RECORD", full: "Wins and losses this season" },
  titles: { label: "TITLES", full: "National titles" },
  seasons: { label: "SEASONS", full: "Seasons on record" },
  first: { label: "FIRST", full: "First season" },
  players: { label: "PLAYERS", full: "Players", note: "with a birthplace on file" },
  share: { label: "SHARE", full: "Share of all players with a birthplace" },
  per100k: { label: "PER 100K", full: "Players per 100,000 residents" },
  idx: { label: "IDX", full: "Points index", note: "points per game against the league average, ×100" },
};

export function termLabel(k: string): string {
  return TERMS[k]?.label ?? k;
}

let tipNode: HTMLDivElement | null = null;

function hideTip() {
  tipNode?.classList.remove("is-on");
}

function showTip(target: HTMLElement, text: string) {
  if (!tipNode) {
    tipNode = document.createElement("div");
    tipNode.className = "abbr-tip";
    tipNode.setAttribute("role", "tooltip");
    document.body.appendChild(tipNode);
    window.addEventListener("scroll", hideTip, true);
    window.addEventListener("resize", hideTip);
    document.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest(".abbr")) hideTip();
    }, true);
  }
  tipNode.textContent = text;
  tipNode.classList.add("is-on");
  const r = target.getBoundingClientRect();
  const box = tipNode.getBoundingClientRect();
  const pad = 8;
  const left = Math.max(pad, Math.min(r.left + r.width / 2 - box.width / 2, window.innerWidth - box.width - pad));
  // a block's label sits directly under its value, so opening upward would hide the number
  // the reader tapped: below the label in the lower half of the screen, above it up top
  const below = r.top > window.innerHeight * 0.55;
  let top = below ? r.bottom + 6 : r.top - box.height - 6;
  if (top + box.height > window.innerHeight - pad) top = r.top - box.height - 6;
  if (top < pad) top = r.bottom + 6;
  tipNode.style.left = `${Math.round(left)}px`;
  tipNode.style.top = `${Math.round(top)}px`;
}

/** An abbreviation that explains itself on hover, focus and tap. */
export function Term({ k, children }: { k: string; children?: React.ReactNode }) {
  const entry = TERMS[k];
  const text = entry ? `${entry.full}${entry.note ? ` — ${entry.note}` : ""}` : k;
  return (
    <abbr
      className="abbr"
      aria-label={text}
      tabIndex={0}
      onMouseEnter={(e) => showTip(e.currentTarget, text)}
      onMouseLeave={hideTip}
      onFocus={(e) => showTip(e.currentTarget, text)}
      onBlur={hideTip}
      /* a tap on a phone opens the tip; inside a sortable header or a sort button the tap
         already means "sort this column", so those keep their behaviour */
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        const el = e.currentTarget;
        if (el.closest("th") || el.closest("button")) return;
        showTip(el, text);
      }}
    >
      {children ?? entry?.label ?? k}
    </abbr>
  );
}

const LABEL_TO_KEY: Record<string, string> = {
  GP: "gp", GS: "gs", G: "g", A: "a", AST: "a", PTS: "pts", "PTS/G": "ppg",
  SH: "sh", "SH%": "shp", GB: "gb", LB: "lb", TO: "to", CT: "ct", FO: "fo", "FO%": "fo",
  PIM: "pim", SV: "sv", GA: "ga", GAA: "gaa", "SV%": "svp", MIN: "min",
  W: "w", L: "l", T: "t", "W–L": "wl", "W-L": "wl", PCT: "pct", GF: "gf", DIFF: "diff",
  CONF: "conf", ELO: "elo", Elo: "elo", SOS: "sos", POS: "pos", RECORD: "record",
  TITLES: "titles", SEASONS: "seasons", FIRST: "first", PLAYERS: "players",
  SHARE: "share", "PER 100K": "per100k", IDX: "idx", CONSENSUS: "consensus",
};

/** For labels that arrive as text (feeds, maps, column descriptors). */
export function TermFor({ text }: { text: string }) {
  const key = LABEL_TO_KEY[text];
  return key ? <Term k={key} /> : <>{text}</>;
}

/* --------------------------- mobile block rows ---------------------------- */
/* A table with seven or more columns cannot fit a phone without sideways scrolling, so
   each row also renders as a block under 640px: identity on the first line, then every
   number with its column label underneath. The table stays for wide screens. */

export type BlockCell = {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  /** makes the cell a sort button, for tables whose headers sort the list */
  onSort?: () => void;
  sorted?: "asc" | "desc";
};

export type BlockRow = {
  key: string;
  rank?: React.ReactNode;
  primary: React.ReactNode;
  meta?: React.ReactNode;
  cells: BlockCell[];
  /** a control that belongs on the identity line — a bookmark, a compare toggle */
  action?: React.ReactNode;
  /** a full-width line under the numbers — programs, notes */
  note?: React.ReactNode;
  /** renders a divider whenever it changes from the previous row */
  group?: string;
};

function BlockCells({ cells }: { cells: BlockCell[] }) {
  // four across at most, but the last line must not be an orphan: five cells split 3+2,
  // six 3+3, seven 4+3 — same height as 4+1 and 4+3, without the ragged edge
  const rows = Math.ceil(cells.length / 4);
  const cols = Math.max(1, Math.ceil(cells.length / Math.max(1, rows)));
  return (
    <div className="block-cells" style={{ "--block-cols": cols } as React.CSSProperties}>
      {cells.map((c, i) => {
        const body = (
          <>
            <b className={c.strong ? "num strong" : "num"}>{c.value}</b>
            <i>{c.label}</i>
          </>
        );
        return c.onSort ? (
          <button
            type="button"
            key={i}
            className={`block-cell is-sortable${c.sorted ? " is-sorted" : ""}`}
            onClick={c.onSort}
            aria-label={`Sort by ${c.label}`}
          >
            {body}
            {c.sorted ? <span className="block-sort" aria-hidden="true">{c.sorted === "desc" ? "↓" : "↑"}</span> : null}
          </button>
        ) : (
          <span key={i} className="block-cell">
            {body}
          </span>
        );
      })}
    </div>
  );
}

export function BlockList({
  rows,
  foot,
  motionKey,
}: {
  rows: BlockRow[];
  foot?: { caption: React.ReactNode; cells: BlockCell[] };
  /** any string that changes with the filter/sort: re-orders the rows in place */
  motionKey?: string;
}) {
  const list = React.useRef<HTMLDivElement>(null);
  useFlipRows(list, [motionKey], { max: 40 });
  let lastGroup: string | undefined;
  return (
    <div className="block-list" ref={list}>
      {rows.map((r) => {
        const divider = r.group !== undefined && r.group !== lastGroup ? r.group : null;
        lastGroup = r.group;
        return (
          <React.Fragment key={r.key}>
            {divider ? <div className="block-group">{divider}</div> : null}
            <div className="block-row" data-k={r.key}>
              <div className="block-head">
                {r.rank !== undefined ? <span className="block-rank num">{r.rank}</span> : null}
                <span className="block-primary">{r.primary}</span>
                {r.meta ? <span className="block-meta muted">{r.meta}</span> : null}
                {r.action ? <span className="block-action">{r.action}</span> : null}
              </div>
              <BlockCells cells={r.cells} />
              {r.note ? <div className="block-note">{r.note}</div> : null}
            </div>
          </React.Fragment>
        );
      })}
      {foot ? (
        <div className="block-row block-total">
          <div className="block-head">
            <span className="block-primary strong">{foot.caption}</span>
          </div>
          <BlockCells cells={foot.cells} />
        </div>
      ) : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "accent";
}) {
  return (
    <div className={`stat ${tone === "accent" ? "stat-accent" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
  padded = true,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${padded ? "pad" : ""} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function SectionHead({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">◎</div>
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

/* --------------------------------- charts ---------------------------------- */

export function Sparkline({
  values,
  labels,
  width = 560,
  height = 168,
  color = "var(--accent)",
  showValues = true,
  valueSuffix = "",
  pointColors,
  legend,
  pointTitles,
}: {
  values: number[];
  labels?: string[];
  width?: number;
  height?: number;
  color?: string;
  showValues?: boolean;
  valueSuffix?: string;
  /** one colour per point — a merged career colours the marker by club */
  pointColors?: (string | undefined)[];
  legend?: { label: string; color: string; to?: string }[];
  /** hover text per point, e.g. the per-club split of a combined season */
  pointTitles?: string[];
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pad = { l: 34, r: 12, t: 16, b: 26 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = (v: number) => pad.t + h - ((v - min) / Math.max(1, max - min)) * h;
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1)},${pad.t + h} L${x(0)},${pad.t + h} Z`;
  const gid = React.useId().replace(/:/g, "");

  return (
    <div className="spark-wrap">
      <svg className="spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Points by season">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={pad.l}
          x2={width - pad.r}
          y1={pad.t + h * t}
          y2={pad.t + h * t}
          className="grid-line"
        />
      ))}
      <text x={pad.l - 8} y={pad.t + 4} className="axis-label" textAnchor="end">
        {max}{valueSuffix}
      </text>
      <text x={pad.l - 8} y={pad.t + h / 2 + 4} className="axis-label" textAnchor="end">
        {Math.round(max / 2)}
      </text>
      <text x={pad.l - 8} y={pad.t + h + 4} className="axis-label" textAnchor="end">
        0
      </text>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {values.map((v, i) => (
        <g key={i}>
          {showValues ? (
            <text x={x(i)} y={y(v) - 11} className="point-label" textAnchor="middle">
              {v}{valueSuffix}
            </text>
          ) : null}
          <circle
            cx={x(i)}
            cy={y(v)}
            r="4"
            fill="var(--card)"
            stroke={pointColors?.[i] ?? color}
            strokeWidth="2.5"
          >
            <title>{pointTitles?.[i] ?? `${labels?.[i] ?? ""} · ${v}${valueSuffix}`}</title>
          </circle>
          {labels?.[i] ? (
            <text x={x(i)} y={height - 6} className="axis-label" textAnchor="middle">
              {labels[i]}
            </text>
          ) : null}
        </g>
      ))}
      </svg>
      {legend && legend.length > 1 ? (
        <ul className="bar-legend">
          {legend.map((l) => (
            <li key={l.label}>
              <span className="bar-swatch" style={{ background: l.color }} />
              {l.to ? (
                <Link to={l.to} className="cell-link">
                  {l.label}
                </Link>
              ) : (
                l.label
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}


/* One line and one filled area per club. A merged career is several clubs, and a
   single summed line hides which of them produced the points — and a rate like save
   percentage cannot be summed at all. Gaps stay gaps: a club with no season at a
   year simply has no point there. */
export function SeasonLines({
  categories,
  series,
  suffix = "",
  height = 236,
  showValues = true,
}: {
  categories: string[];
  series: { label: string; color: string; to?: string; points: Record<string, number> }[];
  suffix?: string;
  height?: number;
  showValues?: boolean;
}) {
  const uid = React.useId().replace(/:/g, "");
  // A fixed 560-wide viewBox shrinks to a 113px-tall plot on a phone, so the box changes
  // shape with the container it is actually in — measured, not inferred from the window,
  // which lags behind an emulated or resized viewport.
  const [measured, setMeasured] = React.useState(560);
  React.useEffect(() => {
    const read = () => {
      const el = document.querySelector<HTMLElement>(".season-lines");
      if (el) setMeasured((current) => {
        const next = el.getBoundingClientRect().width;
        return Math.abs(next - current) < 1 ? current : next;
      });
    };
    read();
    // Neither a resize listener nor a ResizeObserver sees a viewport that changed *before*
    // the chart mounted (emulated device, restored window, a card revealed after paint), so
    // the width is re-read on a short interval while the layout settles, then left alone.
    const poll = window.setInterval(read, 250);
    const settle = window.setTimeout(() => window.clearInterval(poll), 4000);
    window.addEventListener("resize", read);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(settle);
      window.removeEventListener("resize", read);
    };
  }, []);
  if (categories.length === 0 || series.length === 0) return null;

  const narrow = measured < 480;
  const pad = { l: 34, r: 14, t: 20, b: 26 };
  const width = narrow ? 360 : 560;
  const boxHeight = narrow ? 232 : height;
  const w = width - pad.l - pad.r;
  const h = boxHeight - pad.t - pad.b;

  const peak = Math.max(1, ...series.flatMap((s) => categories.map((c) => s.points[c] ?? 0)));
  const step = (() => {
    const rough = peak / 3;
    const mag = 10 ** Math.floor(Math.log10(Math.max(1, rough)));
    for (const m of [1, 2, 2.5, 5, 10]) if (rough <= mag * m) return mag * m;
    return mag * 10;
  })();
  const top = Math.max(step, Math.ceil(peak / step) * step);

  const x = (i: number) => pad.l + (categories.length === 1 ? w / 2 : (i / (categories.length - 1)) * w);
  const y = (v: number) => pad.t + h - (v / top) * h;

  // contiguous runs: a club absent for a season must break the line, not interpolate
  const runs = (points: Record<string, number>) => {
    const out: { i: number; v: number }[][] = [];
    let run: { i: number; v: number }[] = [];
    categories.forEach((c, i) => {
      const v = points[c];
      if (v === undefined) {
        if (run.length) out.push(run);
        run = [];
      } else {
        run.push({ i, v });
      }
    });
    if (run.length) out.push(run);
    return out;
  };
  const pathOf = (run: { i: number; v: number }[]) =>
    run.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const areaOf = (run: { i: number; v: number }[]) =>
    `${pathOf(run)} L${x(run[run.length - 1].i).toFixed(1)},${(pad.t + h).toFixed(1)} L${x(run[0].i).toFixed(1)},${(
      pad.t + h
    ).toFixed(1)} Z`;

  // a point on the top gridline or on the baseline sends its label the other way, and two
  // clubs in one season stagger so their labels do not stack
  const labelOffset = (l: { k: number; total: number; v: number }, top: number, bottom: number) => {
    let dy = l.total > 1 && l.k > 0 ? 15 : -10;
    if (y(l.v) - 12 < top + 6) dy = 15;
    if (y(l.v) + 15 > bottom - 2) dy = -10;
    return dy;
  };

  const labels = categories.flatMap((c) => {
    const at = series
      .map((s, si) => ({ si, v: s.points[c] }))
      .filter((e): e is { si: number; v: number } => e.v !== undefined)
      .sort((a, b) => b.v - a.v);
    return at.map((e, k) => ({ c, ...e, k, total: at.length }));
  });

  return (
    <div className="season-lines">
      <svg viewBox={`0 0 ${width} ${boxHeight}`} role="img" aria-label="Points by season, one line per club">
        <defs>
          {series.map((s, i) => (
            <linearGradient
              key={i}
              id={`${uid}-${i}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
              style={{ ["--series" as string]: s.color } as React.CSSProperties}
            >
              <stop className="sl-stop" offset="0%" stopColor="var(--series)" stopOpacity="0.34" />
              <stop className="sl-stop" offset="100%" stopColor="var(--series)" stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>
        {[0, 1, 2, 3].map((k) => (
          <line
            key={k}
            x1={pad.l}
            x2={width - pad.r}
            y1={pad.t + (h * k) / 3}
            y2={pad.t + (h * k) / 3}
            className="grid-line"
          />
        ))}
        {[0, 1, 2, 3].map((k) => (
          <text key={k} x={pad.l - 8} y={pad.t + (h * k) / 3 + 3.5} className="axis-label" textAnchor="end">
            {Math.round(top - (top * k) / 3)}
          </text>
        ))}

        {series.map((s, i) =>
          runs(s.points).map((run, k) => (
            <path key={`a-${i}-${k}`} d={areaOf(run)} fill={`url(#${uid}-${i})`} />
          )),
        )}

        {/* a club he left and came back to: dashed, so the line reads as one club without
            pretending the missing season happened */}
        {series.map((s, i) => {
          const segments = runs(s.points);
          return segments.slice(1).map((run, k) => {
            const prev = segments[k][segments[k].length - 1];
            const next = run[0];
            return (
              <path
                key={`gap-${i}-${k}`}
                className="sl-gap"
                d={`M${x(prev.i).toFixed(1)},${y(prev.v).toFixed(1)} L${x(next.i).toFixed(1)},${y(next.v).toFixed(1)}`}
                fill="none"
                stroke="var(--series)"
                strokeWidth="2.8"
                strokeDasharray="6 5"
                strokeOpacity="0.9"
                style={{ ["--series" as string]: s.color } as React.CSSProperties}
              />
            );
          });
        })}

        {series.map((s, i) =>
          runs(s.points).map((run, k) => (
            <path
              key={`l-${i}-${k}`}
              className="sl-line"
              d={pathOf(run)}
              fill="none"
              stroke="var(--series)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ ["--series" as string]: s.color } as React.CSSProperties}
            />
          )),
        )}

        {series.map((s, i) =>
          categories.map((c) =>
            s.points[c] === undefined ? null : (
              <circle
                key={`d-${i}-${c}`}
                className={Object.keys(s.points).length === 1 ? "sl-dot sl-dot-fill" : "sl-dot"}
                cx={x(categories.indexOf(c))}
                cy={y(s.points[c])}
                /* a club with one season has no line to follow: fill its marker so the
                   colour still reads, instead of an empty ring */
                r={Object.keys(s.points).length === 1 ? 5.2 : 4.4}
                fill={Object.keys(s.points).length === 1 ? "var(--series)" : "var(--card)"}
                stroke={Object.keys(s.points).length === 1 ? "var(--card)" : "var(--series)"}
                strokeWidth="2.6"
                style={{ ["--series" as string]: s.color } as React.CSSProperties}
              >
                <title>{`${c} · ${s.label} · ${s.points[c]}${suffix}`}</title>
              </circle>
            ),
          ),
        )}

        {showValues
          ? labels.map((l) => (
              <text
                key={`v-${l.c}-${l.si}`}
                x={x(categories.indexOf(l.c))}
                /* above the marker by default; a point on the top gridline or on the
                   baseline sends its label the other way so it never lands on the axis */
                y={y(l.v) + labelOffset(l, pad.t, pad.t + h)}
                className="point-label"
                textAnchor="middle"
              >
                {l.v}
                {suffix}
              </text>
            ))
          : null}

        {categories.map((c, i) => (
          <text key={`x-${c}`} x={x(i)} y={boxHeight - 6} className="axis-label" textAnchor="middle">
            {c}
          </text>
        ))}
      </svg>
      {series.length > 1 ? (
        <ul className="bar-legend">
          {series.map((s) => (
            <li key={s.label}>
              <span
                className="bar-swatch sl-swatch"
                style={{ ["--series" as string]: s.color, background: "var(--series)" } as React.CSSProperties}
              />
              {s.to ? (
                <Link to={s.to} className="cell-link">
                  {s.label}
                </Link>
              ) : (
                s.label
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function GradeBar({ label, value, rank }: { label: string; value: number; rank?: number }) {
  return (
    <div className="grade">
      <div className="grade-top">
        <span>{label}</span>
        <span className="num">{value}</span>
      </div>
      <div className="grade-track">
        <div className="grade-fill" style={{ width: `${value}%` }} />
        {rank !== undefined ? <span className="grade-pin" style={{ left: `${rank}%` }} /> : null}
      </div>
    </div>
  );
}

/* --------------------------------- player card ------------------------------ */

export function PlayerCard({ player, team }: { player: Player; team?: Team }) {
  const s = player.seasons[player.seasons.length - 1];
  return (
    <Link to={`/player/${player.slug}`} className="pcard">
      <div className="pcard-top">
        <Avatar name={player.name} colors={team?.colors} size={52} photo={player.photo} />
        <div className="pcard-id">
          <div className="pcard-name">{player.name}</div>
          <div className="pcard-team">
            {team?.shortName} <span className="dot">·</span> {player.positionName}
          </div>
        </div>
        <PositionBadge pos={player.position} />
      </div>
      <div className="pcard-stats">
        <div>
          <span className="num">{s?.g ?? 0}</span>
          <span className="lbl">G</span>
        </div>
        <div>
          <span className="num">{s?.a ?? 0}</span>
          <span className="lbl">A</span>
        </div>
        <div>
          <span className="num">{s?.pts ?? 0}</span>
          <span className="lbl">PTS</span>
        </div>
        <div>
          <span className="num">{s?.gp ?? 0}</span>
          <span className="lbl">GP</span>
        </div>
      </div>
    </Link>
  );
}
