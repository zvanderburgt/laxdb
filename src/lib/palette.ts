/** Club colours are brand colours, and brand colours collide: Cornell, UMass and Whitby
 *  are three different reds, and Oakville Rock's two league entries are byte-identical.
 *  On a chart with one line per club that makes two clubs look like one, so colours are
 *  spread in order — a colliding hue rotates and lightens until it is clearly apart. */

const hex = (h: string) => {
  const s = h.replace("#", "").trim();
  return s.length === 3
    ? [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)]
    : [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};

const toHex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

const toHsl = ([r, g, b]: number[]) => {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l] as const;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0)) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [(h * 60) % 360, s, l] as const;
};

const toRgb = ([h, s, l]: number[]) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][seg];
  return rgb.map((v) => (v + m) * 255);
};

const apart = (a: number[], b: number[]) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) > 60;

export function distinctEach(colors: string[], fallback = "#5B6472"): string[] {
  const out: (string | null)[] = colors.map(() => null);
  const taken: number[][] = [];

  colors.forEach((raw, i) => {
    const valid = /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test((raw ?? "").trim());
    let rgb = valid ? hex(raw!) : hex(fallback);
    if (!valid) {
      out[i] = fallback;
      return;
    }
    const [h0, s0, l0] = toHsl(rgb);
    for (let step = 0; step < 16 && taken.some((t) => !apart(t, rgb)); step += 1) {
      // stay near the brand hue: alternate a small rotation either way and step the
      // lightness, so a second red reads as burgundy or coral, not green
      const turn = Math.ceil((step + 1) / 2);
      const h = (h0 + (step % 2 === 0 ? 1 : -1) * 26 * turn + 360) % 360;
      const l = Math.min(0.7, Math.max(0.26, l0 + (step % 2 === 0 ? 0.13 : -0.13) * turn));
      rgb = toRgb([h, Math.max(0.3, Math.min(1, s0)), l]);
    }
    taken.push(rgb);
    out[i] = toHex(rgb);
  });

  return out as string[];
}
