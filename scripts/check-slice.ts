/**
 * Prove one /api/slice answer equals what the browser computes from the full dataset.
 *
 *   npm run slice:check -- connor-kelly
 *
 * The point of the check: the slice replaces a scan of 26,234 players with pools built in Postgres,
 * and "close enough" is how a migration quietly changes every rank on the page. Peers and similarity
 * must be identical, not similar.
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { peerRanks } from "../src/lib/peers.ts";
import { similarTo } from "../src/lib/similar.ts";
// @ts-ignore
import handler from "../netlify/functions-build/slice.mjs";

const data = JSON.parse(readFileSync("public/data.json", "utf8"));
const slug = process.argv[2] ?? "connor-kelly";
const player = data.players.find((p: any) => p.slug === slug);
if (!player) throw new Error(`no ${slug} in the dataset`);

const wantPeers = peerRanks(player as any, data.players as any);
const wantSimilar = similarTo(player as any, 6, data.players as any);

const t0 = Date.now();
const res = await handler(new Request(`http://localhost/data/player?slug=${slug}`));
const ms = Date.now() - t0;
const raw = await res.text();
const body = JSON.parse(raw);
const gz = gzipSync(Buffer.from(raw)).length;

console.log(`status ${res.status} in ${ms} ms · ${raw.length.toLocaleString()} B json · ${gz.toLocaleString()} B gzip`);
console.log("counts", body.counts);

const show = (a: any) => JSON.stringify(a);
console.log(`peers   match: ${show(body.peers) === show(wantPeers)}`);
if (show(body.peers) !== show(wantPeers)) {
  console.log("  api  ", show(body.peers));
  console.log("  local", show(wantPeers));
}
const gotSimilar = body.similar.map((s: any) => [s.player.slug, s.score]);
const wantSim = wantSimilar.map((s: any) => [s.player.slug, s.score]);
console.log(`similar match: ${show(gotSimilar) === show(wantSim)}`);
if (show(gotSimilar) !== show(wantSim)) {
  console.log("  api  ", show(gotSimilar));
  console.log("  local", show(wantSim));
}
console.log("teammates", body.mates.length, body.mates.slice(0, 3).map((m: any) => m.name));
console.log("teams", body.teams.length, "leagues", body.leagues.length, "history", Boolean(body.history));
