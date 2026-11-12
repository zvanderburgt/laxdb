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

  // two clubs in one season would stack their labels; the smaller one drops below
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
            <linearGradient key={i} id={`${uid}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
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

        {series.map((s, i) =>
          runs(s.points).map((run, k) => (
            <path
              key={`l-${i}-${k}`}
              d={pathOf(run)}
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )),
        )}

        {series.map((s, i) =>
          categories.map((c) =>
            s.points[c] === undefined ? null : (
              <circle
                key={`d-${i}-${c}`}
                cx={x(categories.indexOf(c))}
                cy={y(s.points[c])}
                /* a club with one season has no line to follow: fill its marker so the
                   colour still reads, instead of an empty ring */
                r={Object.keys(s.points).length === 1 ? 4.6 : 3.6}
                fill={Object.keys(s.points).length === 1 ? s.color : "var(--card)"}
                stroke={Object.keys(s.points).length === 1 ? "var(--card)" : s.color}
                strokeWidth="2.5"
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
                /* a point sitting on the top gridline puts its label above the plot, so it
                   drops below the marker instead */
                y={y(l.v) + ((l.total > 1 && l.k > 0) || y(l.v) - 12 < pad.t + 6 ? 15 : -10)}
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
              <span className="bar-swatch" style={{ background: s.color }} />
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
