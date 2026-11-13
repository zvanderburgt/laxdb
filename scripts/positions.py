#!/usr/bin/env python3
"""Box positions: the shared vocabulary every importer stamps onto a player.

Our box feeds (stats.netfrontsports.com) print a skater as a skater — "Runner" — and
never say whether he is a forward, a transition player or a defender. Two sources do:

  GameSheet   `players/standings/{season}` → `positions: ["forward"]` (also "defence",
              "transition", "runner"); the per-club entry repeats it
  Digitalshift rendered roster → `POS` column: F, D, T, G, R, "T/D"

Both are free text, so the codes are normalised here, once, and shared. Codes match the
field leagues' (`src/lib/types.ts`): F Forward, T Transition, D Defense, G Goalie,
R Runner (a skater whose position is genuinely not published).

Ledger, not overwrite: a position we already hold is never replaced, and a box player
left on the legacy "F" (which used to mean "runner") is migrated to "R" so the label
does not start claiming every Ontario skater is a forward.
"""
from __future__ import annotations

POS_LABEL = {
    "A": "Attack", "M": "Midfield", "D": "Defense", "G": "Goalie",
    "FO": "Faceoff", "LSM": "LSM",
    "F": "Forward", "T": "Transition", "R": "Runner",
}

_FROM_FEED = {
    "forward": "F", "forwards": "F", "attack": "F", "attackman": "F",
    "left_wing": "F", "right_wing": "F", "offence": "F", "offense": "F",
    "defence": "D", "defense": "D", "defender": "D", "defenceman": "D",
    "transition": "T", "t/d": "T", "td": "T", "d/t": "T",
    "runner": "R", "skater": "R", "field": "R",
    "goalie": "G", "goalkeeper": "G", "goaltender": "G", "g": "G",
}

# when one player carries two, the more specific label wins: a transition player is
# listed "defence, transition" on GameSheet and "T/D" on Digitalshift
_PRIORITY = ["T", "D", "F", "R", "G"]

# rank used when two sources disagree inside the same season — a goalie listing is a
# hard fact, "runner" is the absence of one
_SPECIFIC = {"G": 0, "T": 1, "D": 2, "F": 3, "R": 4}

# a code we may replace: nothing, a legacy "F", or a bare runner
_UNKNOWN = ("", "R", "F")


def code(value: str) -> str | None:
    """One feed token -> one of our position codes (None if it says nothing)."""
    v = (value or "").strip().lower().replace(".", "")
    if not v:
        return None
    if v in _FROM_FEED:
        return _FROM_FEED[v]
    if "/" in v:
        parts = [code(p) for p in v.split("/")]
        parts = [p for p in parts if p]
        return pick(parts) if parts else None
    if v.upper() in POS_LABEL:
        return v.upper()
    return None


def pick(codes: list[str]) -> str:
    for p in _PRIORITY:
        if p in codes:
            return p
    return codes[0]


def resolve(values) -> str | None:
    """Every position token a source printed -> the one code we show."""
    codes = [c for c in (code(v) for v in values or []) if c]
    if not codes:
        return None
    skaters = [c for c in codes if c != "G"]
    return pick(skaters) if skaters else "G"


def stamp(data: dict, found: dict[str, list[tuple[str, str, str]]], apply: bool = False) -> dict:
    """Write resolved positions onto box players.

    `found` maps player id -> [(date, code, source)]. The newest dated row wins, which is
    what keeps a player on the position his current club lists him at rather than a
    Junior C line from three seasons ago. Only box leagues are touched: a college
    "Midfield" is not a box forward.
    """
    leagues = {l["id"]: l for l in data["leagues"]}
    stats = {"box_players": 0, "migrated": 0, "from_forward": 0, "from_transition": 0,
             "from_defense": 0, "from_runner": 0, "goalie_confirmed": 0, "already": 0}

    for p in data["players"]:
        league = leagues.get(p["leagueId"]) or {}
        if league.get("type") != "box":
            continue
        stats["box_players"] += 1
        cur = p.get("position") or ""

        # the newest season wins, and inside one season the more specific label wins:
        # Digitalshift's current roster says "D" where GameSheet still says "runner"
        rows = sorted(found.get(p["id"]) or [],
                      key=lambda r: (str(r[0])[:4], -_SPECIFIC.get(r[1], 9)), reverse=True)
        best = rows[0] if rows else None

        if best and best[1] == "G":
            if cur == "G":
                stats["goalie_confirmed"] += 1
            # a goalie is already known from the feed's own goalie table
            p["position"], p["positionName"] = "G", POS_LABEL["G"]
            continue

        if cur == "G":
            stats["already"] += 1
            continue

        if best and cur in _UNKNOWN:
            p["position"] = best[1]
            p["positionName"] = POS_LABEL[best[1]]
            stats[{"F": "from_forward", "T": "from_transition", "D": "from_defense",
                   "R": "from_runner"}[best[1]]] += 1
            continue

        if cur == "F":
            # legacy default: "F" used to be printed as "Runner", so relabel it rather
            # than promote 3,000 players to forward on no evidence
            p["position"] = "R"
            p["positionName"] = POS_LABEL["R"]
            stats["migrated"] += 1
            continue

        stats["already"] += 1

    return stats
