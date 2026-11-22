/**
 * Per-entity share cards: `/og/player/<slug>.png`, `/og/team/<slug>.png`, `/og/league/<id>.png`.
 *
 * Every shared LAXDB link used to unfurl with the same site-wide image, so a link to a 93-point
 * season looked identical to a link to the home page. This function draws the entity's own card: the
 * player's name, club colours, career line and points-by-season bars — the same shape as the canvas
 * card the site hands a visitor, rendered server-side where an unfurler can fetch it.
 *
 * How it renders without a browser: `satori` lays out a flex tree and returns SVG, `@resvg/resvg-wasm`
 * rasterises it to PNG. Both are bundled by scripts/build-functions.mjs together with the Inter fonts
 * (`netlify/assets/fonts/*.ttf`) and the resvg wasm, so the function carries no runtime dependency and
 * a zip deploy still works.
 *
 * Facts come from the generated `entity-cards.json` (the full rows: colours, career totals, the
 * scoring series, the leaders), never from the dataset: a card has to answer in a few milliseconds on
 * a cold start, and 23 MB of JSON is not that. The meta function reads the trimmed
 * `entity-index.json` instead — its bundle is on the path of every entity response.
 *
 * Layout is deliberately explicit — every column has a pixel width and `flexShrink: 0`. Satori sizes a
 * flex item from its content when it can, and a long name or a five-figure stat then pushes the right
 * column past the canvas edge, where it is clipped with no warning.
 *
 * Caching: the card changes only when the data does, so it is cached hard at the edge.
 */
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
// bundled as raw bytes by esbuild (loader: { ".ttf": "binary", ".wasm": "binary" })
import inter400 from "../assets/fonts/Inter-400.ttf";
import inter600 from "../assets/fonts/Inter-600.ttf";
import inter700 from "../assets/fonts/Inter-700.ttf";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import index from "./entity-cards.json";

const SITE = (process.env.URL || "https://laxdb.netlify.app").replace(/\/$/, "");

export const config = { path: "/og/*" };

const W = 1200;
const H = 630;
const PAD = 64;
const INNER = W - PAD * 2; // 1072
const LEFT = 636;
const RIGHT = 384; // LEFT + RIGHT + 52 gap = 1072

type Card = {
  kicker: string;
  colour: string;
  accent: string;
  title: string;
  subtitle: string;
  stats: [string, string][];
  bars?: { label: string; value: number }[];
  barsTitle?: string;
  barsSuffix?: string;
  list?: { label: string; value: string }[];
  listTitle?: string;
};

/* fonts and the wasm module are per-instance, not per-request */
let ready: Promise<void> | null = null;
function init(): Promise<void> {
  if (ready) return ready;
  ready = initWasm(resvgWasm as unknown as Uint8Array);
  return ready;
}

const el = (type: string, style: Record<string, unknown>, children?: unknown) => ({
  type,
  props: { style, children },
});

const rgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: [number, number, number]) =>
  "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

/** Ink for a tile: white on a dark club colour, near-black on a pale one. */
function inkFor(hex: string): string {
  const c = rgb(hex);
  if (!c) return "#ffffff";
  const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  return lum > 0.62 ? "#101014" : "#ffffff";
}

/** Lift a club colour until it reads on a near-black card (a navy series is otherwise invisible). */
function lift(hex: string, toward = 0.42, floor = 0.55): string {
  const c = rgb(hex);
  if (!c) return "#8fa4bd";
  let out: [number, number, number] = [c[0], c[1], c[2]];
  for (let i = 0; i < 6; i += 1) {
    const lum = (0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]) / 255;
    if (lum >= floor) break;
    out = [out[0] + (255 - out[0]) * toward, out[1] + (255 - out[1]) * toward, out[2] + (255 - out[2]) * toward];
  }
  return toHex(out);
}

const alpha = (hex: string, a: number): string => {
  const c = rgb(hex);
  return c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})` : `rgba(255,255,255,${a})`;
};

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

const MUTED = "rgba(255,255,255,0.56)";
const FAINT = "rgba(255,255,255,0.14)";

function card(c: Card) {
  const bar = lift(c.accent || c.colour, 0.5, 0.62);
  const max = Math.max(1, ...(c.bars ?? []).map((b) => b.value));
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: `${W}px`,
      height: `${H}px`,
      padding: `${PAD}px`,
      fontFamily: "Inter",
      color: "#ffffff",
      background: "#0b0d12",
      backgroundImage: `radial-gradient(circle at 86% 6%, ${alpha(c.colour, 0.34)} 0%, ${alpha(c.colour, 0)} 58%)`,
    },
    [
      /* top rule */
      el("div", { display: "flex", width: `${INNER}px`, justifyContent: "space-between", alignItems: "center" }, [
        el("div", { display: "flex", alignItems: "center" }, [
          el("div", { display: "flex", width: "11px", height: "11px", borderRadius: "3px", background: bar, marginRight: "14px" }),
          el("div", { display: "flex", fontSize: "20px", fontWeight: 700, letterSpacing: "3px" }, "LAXDB"),
        ]),
        el(
          "div",
          {
            display: "flex",
            width: "600px",
            justifyContent: "flex-end",
            fontSize: "16px",
            fontWeight: 400,
            color: MUTED,
            letterSpacing: "0.6px",
            overflow: "hidden",
            whiteSpace: "nowrap",
          },
          c.kicker,
        ),
      ]),

      /* body */
      el(
        "div",
        { display: "flex", flex: 1, alignItems: "center", width: `${INNER}px` },
        [
          el(
            "div",
            { display: "flex", flexDirection: "column", width: `${LEFT}px`, flexShrink: 0 },
            [
              el(
                "div",
                {
                  display: "flex",
                  width: "84px",
                  height: "84px",
                  borderRadius: "20px",
                  background: c.colour,
                  color: inkFor(c.colour),
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "32px",
                  fontWeight: 700,
                  letterSpacing: "1px",
                },
                initials(c.title),
              ),
              el(
                "div",
                {
                  display: "flex",
                  fontSize: "56px",
                  fontWeight: 700,
                  lineHeight: 1.07,
                  letterSpacing: "-1.6px",
                  marginTop: "24px",
                  width: `${LEFT}px`,
                  maxHeight: "124px",
                  overflow: "hidden",
                },
                c.title,
              ),
              el(
                "div",
                { display: "flex", fontSize: "22px", fontWeight: 400, color: MUTED, marginTop: "12px", width: `${LEFT}px`, overflow: "hidden" },
                c.subtitle,
              ),
              el(
                "div",
                {
                  display: "flex",
                  width: `${LEFT}px`,
                  justifyContent: "space-between",
                  marginTop: "30px",
                  paddingTop: "20px",
                  borderTop: `1px solid ${FAINT}`,
                },
                c.stats.map(([value, label]) =>
                  el("div", { display: "flex", flexDirection: "column", width: "140px" }, [
                    el("div", { display: "flex", fontSize: "32px", fontWeight: 600, lineHeight: 1.1 }, value),
                    el(
                      "div",
                      { display: "flex", fontSize: "11px", fontWeight: 400, color: MUTED, letterSpacing: "1.6px", marginTop: "7px" },
                      label,
                    ),
                  ]),
                ),
              ),
            ],
          ),

          el(
            "div",
            { display: "flex", flexDirection: "column", width: `${RIGHT}px`, flexShrink: 0, marginLeft: "52px" },
            c.bars && c.bars.length
              ? [
                  el(
                    "div",
                    { display: "flex", fontSize: "12px", fontWeight: 400, color: MUTED, letterSpacing: "1.8px", marginBottom: "14px" },
                    c.barsTitle ?? "POINTS BY SEASON",
                  ),
                  el(
                    "div",
                    { display: "flex", alignItems: "flex-end", height: "186px" },
                    c.bars.map((b, i) =>
                      el(
                        "div",
                        {
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          width: "84px",
                          marginRight: i === c.bars!.length - 1 ? "0px" : "16px",
                          height: "186px",
                        },
                        [
                          el(
                            "div",
                            { display: "flex", fontSize: "15px", fontWeight: 600, color: b.value === max ? "#ffffff" : MUTED, marginBottom: "8px" },
                            `${b.value}${c.barsSuffix ?? ""}`,
                          ),
                          el("div", {
                            display: "flex",
                            width: "84px",
                            height: `${Math.max(8, Math.round((b.value / max) * 140))}px`,
                            // a club's second colour can be near-black: the non-leading bars use a
                            // neutral so the chart never loses three of its four bars
                            background: b.value === max ? bar : "rgba(255,255,255,0.22)",
                            borderRadius: "5px 5px 0 0",
                          }),
                        ],
                      ),
                    ),
                  ),
                  el("div", { display: "flex", width: `${RIGHT}px`, height: "1px", background: FAINT, marginTop: "0px" }),
                  el(
                    "div",
                    { display: "flex" },
                    c.bars.map((b, i) =>
                      el(
                        "div",
                        {
                          display: "flex",
                          width: "84px",
                          justifyContent: "center",
                          marginRight: i === c.bars!.length - 1 ? "0px" : "16px",
                          marginTop: "10px",
                          fontSize: "14px",
                          fontWeight: 400,
                          color: MUTED,
                        },
                        b.label,
                      ),
                    ),
                  ),
                ]
              : [
                  el(
                    "div",
                    { display: "flex", fontSize: "12px", fontWeight: 400, color: MUTED, letterSpacing: "1.8px", marginBottom: "18px" },
                    c.listTitle ?? "CAREER LEADERS",
                  ),
                  ...(c.list ?? []).map((row) =>
                    el(
                      "div",
                      {
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        borderBottom: `1px solid ${FAINT}`,
                        paddingBottom: "12px",
                        marginBottom: "12px",
                      },
                      [
                        el("div", { display: "flex", fontSize: "19px", fontWeight: 500, width: "270px", overflow: "hidden" }, row.label),
                        el("div", { display: "flex", fontSize: "16px", fontWeight: 600, color: MUTED }, row.value),
                      ],
                    ),
                  ),
                ],
          ),
        ],
      ),

      /* footer */
      el(
        "div",
        { display: "flex", width: `${INNER}px`, justifyContent: "space-between", fontSize: "14px", color: "rgba(255,255,255,0.38)" },
        [
          el("div", { display: "flex" }, "laxdb.netlify.app"),
          el("div", { display: "flex" }, "Season-by-season stats · game logs · career history"),
        ],
      ),
    ],
  );
}

type PlayerRow = [
  string, string, string, string, string, string, string,
  number[], [string, number][] | null, number[] | null, [string, number][] | null,
];

function cardFor(pathname: string): Card | null {
  const [, , kind, rawKey] = pathname.split("/");
  const key = decodeURIComponent((rawKey ?? "").replace(/\.png$/i, ""));
  if (!key) return null;
  const players = (index as unknown as { players: Record<string, PlayerRow> }).players;
  const teams = (index as unknown as { teams: Record<string, (string | number)[]> }).teams;
  const leagues = (index as unknown as { leagues: Record<string, (string | string[][])[]> }).leagues;

  if (kind === "player") {
    const row = players[key];
    if (!row) return null;
    const [name, club, league, position, , c1, c2, career, series, goalie, svSeries] = row;
    const [pts, gp, g, a] = career ?? [0, 0, 0, 0];
    const isGoalie = /goalie/i.test(position ?? "");
    // a goalie's card charts save percentage and counts saves, not goals
    const bars = isGoalie && svSeries
      ? svSeries.map(([season, value]) => ({ label: season, value }))
      : (series ?? []).map(([season, value]) => ({ label: season, value }));
    // a roster entry has no stat line at all: zeros would read as "played, scored nothing"
    const dash = gp > 0 ? null : "—";
    const goalieStats: [string, string][] | null = isGoalie && goalie
      ? [
          [dash ?? String(goalie[4] ?? 0), "GAMES"],
          [dash ?? String(goalie[0] ?? 0), "SAVES"],
          [dash ?? (goalie[2] ? `${Number(goalie[2]).toFixed(1)}%` : "—"), "SAVE %"],
          [dash ?? (goalie[3] ? Number(goalie[3]).toFixed(2) : "—"), "GAA"],
        ]
      : null;
    return {
      kicker: [position, club, league].filter(Boolean).join(" · "),
      colour: c1,
      accent: c2 || c1,
      title: name,
      subtitle: [club, position].filter(Boolean).join(" · ") || league,
      stats: goalieStats ?? [
        [dash ?? String(pts), "CAREER PTS"],
        [dash ?? String(g), "GOALS"],
        [dash ?? String(a), "ASSISTS"],
        [dash ?? String(gp), "GAMES"],
      ],
      bars,
      barsTitle: isGoalie && svSeries ? "SAVE % BY SEASON" : "POINTS BY SEASON",
      barsSuffix: isGoalie && svSeries ? "%" : "",
      // with no season line there is nothing to chart, so the right column carries the facts instead
      listTitle: "PROFILE",
      list: bars.length
        ? undefined
        : (
            [
              club ? { label: club, value: "CLUB" } : null,
              league ? { label: league, value: "COMPETITION" } : null,
              position ? { label: position, value: "POSITION" } : null,
            ].filter(Boolean) as { label: string; value: string }[]
          ),
    };
  }

  if (kind === "team") {
    const row = teams[key] as unknown as [string, string, string, string, number, number, number, string, string, [string, number][]];
    if (!row) return null;
    const [name, league, city, record, elo, playerCount, seasonCount, c1, c2, top] = row;
    return {
      kicker: [league, city].filter(Boolean).join(" · "),
      colour: c1,
      accent: c2 || c1,
      title: name,
      subtitle: city ? `${city}${league ? ` · ${league}` : ""}` : league,
      stats: [
        [record || "—", "RECORD"],
        [elo ? String(elo) : "—", "ELO"],
        [String(playerCount), "PLAYERS"],
        [String(seasonCount), "PLAYER-SEASONS"],
      ],
      list: (top ?? []).map(([n, pts]) => ({ label: n, value: `${pts} PTS` })),
    };
  }

  if (kind === "league") {
    const row = leagues[key] as unknown as [string, string, string, string, string, string, [string, number][]];
    if (!row) return null;
    const [name, level, teamCount, playerCount, first, last, top] = row;
    return {
      kicker: [level, first && last ? `${first}–${last}` : ""].filter(Boolean).join(" · "),
      colour: "#0b3d6b",
      accent: "#5ac8fa",
      title: name,
      subtitle: `${teamCount} teams · ${playerCount} players`,
      stats: [
        [teamCount, "TEAMS"],
        [playerCount, "PLAYERS"],
        [first || "—", "FIRST SEASON"],
        [last || "—", "LATEST"],
      ],
      list: (top ?? []).map(([n, pts]) => ({ label: n, value: `${pts} PTS` })),
    };
  }

  return null;
}

async function png(c: Card): Promise<Uint8Array> {
  const svg = await satori(card(c) as never, {
    width: W,
    height: H,
    fonts: [
      { name: "Inter", data: inter400 as unknown as ArrayBuffer, weight: 400, style: "normal" },
      { name: "Inter", data: inter600 as unknown as ArrayBuffer, weight: 600, style: "normal" },
      { name: "Inter", data: inter700 as unknown as ArrayBuffer, weight: 700, style: "normal" },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
}

const NOT_FOUND = new Response("not found", {
  status: 404,
  headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=60" },
});

export default async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const url = new URL(req.url);
  const c = cardFor(url.pathname);
  if (!c) return NOT_FOUND;

  try {
    await init();
    const body = await png(c);
    return new Response(body as unknown as BodyInit, {
      headers: {
        "content-type": "image/png",
        // the card changes only when the data does: cache it hard, let the edge serve it
        "cache-control": "public, max-age=3600",
        "netlify-cdn-cache-control": "public, durable, s-maxage=604800, stale-while-revalidate=86400",
        "x-og-site": SITE,
      },
    });
  } catch (err) {
    // never hand a browser a stack trace, and never cache a failure
    console.error("[og] render failed:", err);
    return new Response("card unavailable", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
};
