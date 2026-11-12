import React from "react";
import { Link } from "../lib/app";
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
  return (
    <div className={`segmented seg-${size}`} role="tablist" aria-label={ariaLabel}>
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
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={`card ${padded ? "pad" : ""} ${className}`}>{children}</div>;
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
