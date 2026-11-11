import type { League, Player, Team } from "./types";
import { careerTotals, currentSeason, fmtDate } from "./data";

/** CSV of whatever rows a table is showing — keeps exports honest to the screen. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif';

/** 1200×630 share card, drawn on canvas so it can be posted anywhere. */
export function downloadPlayerCard(player: Player, team?: Team, league?: League) {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0b0d12");
  bg.addColorStop(1, "#141821");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // team colour wash
  const accent = team?.colors?.[0] ?? "#0071e3";
  const wash = ctx.createRadialGradient(980, 120, 40, 980, 120, 620);
  wash.addColorStop(0, `${accent}55`);
  wash.addColorStop(1, "transparent");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  const pad = 64;
  ctx.textBaseline = "alphabetic";

  // wordmark
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText("LAXDB", pad, pad + 8);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = `400 15px ${FONT}`;
  ctx.fillText(`${league?.name ?? ""}${league ? " · " : ""}${data_meta_season()}`, pad, pad + 32);

  // initials chip
  const initials = player.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  ctx.fillStyle = accent;
  roundRect(ctx, pad, 150, 96, 96, 26);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `600 38px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(initials, pad + 48, 212);
  ctx.textAlign = "left";

  // name + subhead
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 62px ${FONT}`;
  ctx.fillText(clip(ctx, player.name, W - pad * 2 - 130), pad + 128, 208);
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = `400 24px ${FONT}`;
  const sub = [player.positionName, team?.name, player.classYear ? `Class of ${player.classYear}` : ""]
    .filter(Boolean)
    .join(" · ");
  ctx.fillText(clip(ctx, sub, W - pad * 2 - 130), pad + 128, 244);

  // stat cells
  const cur = currentSeason(player);
  const career = careerTotals(player);
  const isGoal = player.position === "G";
  const cells = isGoal
    ? [
        ["GAMES", String(cur.gp)],
        ["SAVE %", cur.svp ? cur.svp.toFixed(3).replace(/^0/, "") : "—"],
        ["GAA", cur.gaa ? cur.gaa.toFixed(2) : "—"],
        ["CAREER WINS", String(career.w ?? 0)],
      ]
    : [
        ["GOALS", String(cur.g)],
        ["ASSISTS", String(cur.a)],
        ["POINTS", String(cur.pts ?? 0)],
        ["PTS / GAME", (cur.gp ? (cur.pts ?? 0) / cur.gp : 0).toFixed(2)],
      ];

  const cellW = (W - pad * 2) / 4;
  const top = 330;
  cells.forEach(([label, value], i) => {
    const x = pad + cellW * i;
    if (i > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath();
      ctx.moveTo(x - 16, top);
      ctx.lineTo(x - 16, top + 128);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `500 14px ${FONT}`;
    ctx.fillText(label, x, top + 22);
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 54px ${FONT}`;
    ctx.fillText(value, x, top + 82);
  });

  // footer
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = `400 16px ${FONT}`;
  const span = player.seasons.length
    ? `${player.seasons[0].season}–${player.seasons[player.seasons.length - 1].season}`
    : "";
  ctx.fillText(
    `${span}${span ? " · " : ""}${career.gp} career games · laxdb.netlify.app`,
    pad,
    H - pad
  );
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillText(fmtDate(new Date().toISOString()), W - pad, H - pad);
  ctx.textAlign = "left";

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${player.slug}-laxdb.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Truncate to fit the card without measuring every frame. */
function clip(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 3 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function data_meta_season() {
  return "2026 season";
}
