import { useEffect, useState } from "react";
import type { Player } from "./types";
import { data } from "./data";

const KEY = "laxdb.roster.v1";
const EVENT = "laxdb:roster";

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* private mode — bookmarks just don't persist */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function savedIds() {
  return read();
}

export function isSaved(playerId: string) {
  return read().includes(playerId);
}

export function toggleSaved(playerId: string) {
  const ids = read();
  const next = ids.includes(playerId) ? ids.filter((x) => x !== playerId) : [...ids, playerId];
  write(next);
  return next.includes(playerId);
}

/** Saved players as full records, newest save first. */
export function savedPlayers(): Player[] {
  const byId = new Map(data.players.map((p) => [p.id, p]));
  return read()
    .map((id) => byId.get(id))
    .filter((p): p is Player => Boolean(p))
    .reverse();
}

/** Subscribes to roster changes so buttons and the count stay in sync. */
export function useRoster(): Player[] {
  const [players, setPlayers] = useState<Player[]>(() => savedPlayers());
  useEffect(() => {
    const sync = () => setPlayers(savedPlayers());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return players;
}
