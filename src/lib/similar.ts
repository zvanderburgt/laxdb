import type { Player } from "./types";
import { careerTotals, data } from "./data";

/**
 * Statistical similarity, in the spirit of Basketball-Reference's similarity scores.
 *
 * Each player becomes a vector of per-game rates; rates are z-scored inside their own
 * position group so a defender's ground balls are never compared with an attackman's
 * points. Distance is the mean squared difference across the features both players have,
 * turned into a 1-99 score. Goalies are compared only with goalies.
 */

type Group = "G" | "D" | "M" | "A" | "FO";

const GROUP_OF: Record<string, Group> = {
  G: "G", D: "D", LSM: "D", M: "M", SSDM: "M", FO: "FO", A: "A",
};

type Features = Record<string, number | null>;

function groupOf(p: Player): Group {
  return GROUP_OF[p.position] ?? "M";
}

function features(p: Player): Features {
  const c = careerTotals(p);
  const gp = Math.max(1, c.gp);
  const shots = c.sh || 0;
  const foA = c.foA || 0;

  if (groupOf(p) === "G") {
    const faced = (c.sv || 0) + (c.ga || 0);
    return {
      "sv/g": (c.sv || 0) / gp,
      "ga/g": (c.ga || 0) / gp,
      "sv%": faced > 0 ? (c.sv || 0) / faced : null,
      "w/g": (c.w || 0) / gp,
      height: p.heightIn || null,
    };
  }

  return {
    "g/g": (c.g || 0) / gp,
    "a/g": (c.a || 0) / gp,
    "sh/g": shots / gp,
    "sh%": shots >= 10 ? (c.g || 0) / shots : null,
    "gb/g": (c.gb || 0) / gp,
    "ct/g": (c.ct || 0) / gp,
    "to/g": gp >= 3 ? (c.to || 0) / gp : null,
    "fo%": foA >= 20 ? (c.foW || 0) / foA : null,
    height: p.heightIn || null,
  };
}

type Pool = { ids: Player[]; z: Map<string, Features> };

let poolCache: Map<Group, Pool> | null = null;

function pools(): Map<Group, Pool> {
  if (poolCache) return poolCache;
  const byGroup = new Map<Group, Player[]>();
  for (const p of data.players) {
    const c = careerTotals(p);
    if (c.gp < 5) continue; // a two-game cameo has no shape to compare
    const g = groupOf(p);
    const list = byGroup.get(g) ?? [];
    list.push(p);
    byGroup.set(g, list);
  }

  const out = new Map<Group, Pool>();
  for (const [g, players] of byGroup) {
    const raw = players.map((p) => features(p));
    const keys = new Set<string>();
    raw.forEach((f) => Object.keys(f).forEach((k) => keys.add(k)));

    const stats = new Map<string, { mean: number; sd: number }>();
    for (const k of keys) {
      const vals = raw.map((f) => f[k]).filter((v): v is number => typeof v === "number");
      if (vals.length < 8) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
      stats.set(k, { mean, sd });
    }

    const z = new Map<string, Features>();
    players.forEach((p, i) => {
      const f = raw[i];
      const out1: Features = {};
      for (const [k, v] of Object.entries(f)) {
        const s = stats.get(k);
        if (!s || typeof v !== "number") continue;
        out1[k] = (v - s.mean) / s.sd;
      }
      z.set(p.id, out1);
    });
    out.set(g, { ids: players, z });
  }

  poolCache = out;
  return out;
}

export type Similar = { player: Player; score: number };

export function similarTo(p: Player, n = 6): Similar[] {
  const pool = pools().get(groupOf(p));
  if (!pool) return [];
  const mine = pool.z.get(p.id);
  if (!mine) return [];

  const scored: Similar[] = [];
  for (const other of pool.ids) {
    if (other.id === p.id) continue;
    const theirs = pool.z.get(other.id);
    if (!theirs) continue;
    let sum = 0;
    let count = 0;
    for (const [k, a] of Object.entries(mine)) {
      if (typeof a !== "number") continue;
      const b = theirs[k];
      if (typeof b !== "number") continue;
      sum += (a - b) ** 2;
      count += 1;
    }
    if (count < 3) continue;
    const d = Math.sqrt(sum / count);
    const score = Math.max(1, Math.min(99, Math.round(100 * Math.exp(-0.55 * d))));
    scored.push({ player: other, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, n);
}
