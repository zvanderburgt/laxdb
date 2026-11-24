#!/usr/bin/env python3
"""Audit player identity without modifying data or applying any merge.

Outputs a complete auto/review JSON plan plus a stratified Markdown review sheet.
There is intentionally no --apply option. Player indices, not ids, identify records because
some synthetic source ids collide in the current dataset.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
from typing import Any

from player_identity import (
    candidate_pairs,
    evaluate_pair,
    load_franchises,
    name_key,
    plan_auto_clusters,
)

ROOT = Path(__file__).resolve().parents[1]
LIVE = "https://laxdb.netlify.app"


def load_legacy(path: Path):
    spec = importlib.util.spec_from_file_location("laxdb_legacy_identity", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.argv = [str(path)]
    spec.loader.exec_module(module)
    return module


def same_file(left: Path, right: Path) -> bool:
    """Detect a pathname alias, including hard links to an existing file."""
    try:
        return left.samefile(right)
    except (FileNotFoundError, OSError):
        return left.resolve() == right.resolve()


def player_summary(player: dict[str, Any], teams: dict[str, dict[str, Any]]) -> dict[str, Any]:
    seasons = player.get("seasons") or []
    years = sorted({str(s.get("season")) for s in seasons if s.get("season")})
    clubs = sorted({
        (teams.get(s.get("teamId")) or {}).get("name") or s.get("teamId")
        for s in seasons if s.get("teamId")
    })
    birthplace = player.get("birthplace") or {}
    return {
        "id": player.get("id"),
        "slug": player.get("slug"),
        "url": f"{LIVE}/player/{player.get('slug')}",
        "name": player.get("name"),
        "position": player.get("position"),
        "dob": player.get("dob") or "",
        "heightIn": player.get("heightIn") or 0,
        "weightLb": player.get("weightLb") or 0,
        "hand": player.get("hand") or "",
        "birthplace": ", ".join(x for x in [birthplace.get("city"), birthplace.get("state")] if x),
        "highSchool": player.get("highSchool") or "",
        "classYear": player.get("classYear"),
        "years": years,
        "clubs": clubs,
        "seasonRows": len(seasons),
    }


def signature(decision: dict[str, Any]) -> str:
    if decision.get("vetoes"):
        return decision["vetoes"][0]
    return (decision.get("reasons") or ["unclassified"])[0]


def stratified(decisions: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for decision in decisions:
        groups[signature(decision)].append(decision)
    for group in groups.values():
        group.sort(key=lambda d: (
            not d["cannot_link"], -d["score"],
            d["players"][0]["name"], d["players"][1]["name"], d["a_index"], d["b_index"],
        ))
    output: list[dict[str, Any]] = []
    keys = sorted(groups)
    while len(output) < limit and any(groups.values()):
        for key in keys:
            if groups[key] and len(output) < limit:
                output.append(groups[key].pop(0))
    return output


def format_player(player: dict[str, Any]) -> str:
    span = f"{player['years'][0]}–{player['years'][-1]}" if player["years"] else "no seasons"
    bio = []
    if player["dob"]:
        bio.append(f"DOB {player['dob']}")
    if player["heightIn"]:
        bio.append(f"{player['heightIn']}in")
    if player["weightLb"]:
        bio.append(f"{player['weightLb']}lb")
    if player["hand"]:
        bio.append(f"hand {player['hand']}")
    if player["birthplace"]:
        bio.append(player["birthplace"])
    if player["highSchool"]:
        bio.append(f"HS {player['highSchool']}")
    clubs = "; ".join(player["clubs"])
    return (f"[{player['name']}]({player['url']}) · `{player['id']}` · {player['position']} · "
            f"{span} · {clubs}" + (f" · {'; '.join(bio)}" if bio else ""))


def markdown_section(title: str, decisions: list[dict[str, Any]], sample_size: int,
                     total_count: int | None = None) -> list[str]:
    lines = [f"## {title}", ""]
    if not decisions:
        return lines + ["None.", ""]
    total = len(decisions) if total_count is None else total_count
    lines.append(f"Showing up to {min(sample_size, len(decisions))} of {total}, stratified by reason.")
    lines.append("")
    for decision in stratified(decisions, sample_size):
        a, b = decision["players"]
        lines.append(f"### {a['name']} ↔ {b['name']} — {decision['decision']} · {decision['score']}")
        lines.append(f"- **A:** {format_player(a)}")
        lines.append(f"- **B:** {format_player(b)}")
        lines.append(f"- **Evidence:** {', '.join(decision['reasons']) or 'none'}")
        if decision.get("vetoes"):
            lines.append(f"- **Vetoes:** {', '.join(decision['vetoes'])}")
        legacy = decision.get("legacy_would_merge")
        lines.append(f"- **Current rule:** {'not checked' if legacy is None else 'merge' if legacy else 'keep separate'}")
        lines.append("")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "public/data.json")
    parser.add_argument("--franchises", type=Path, default=ROOT / "public/franchises.json")
    parser.add_argument("--json-out", type=Path, default=ROOT / ".scratch/duplicate-resolver/audit.json")
    parser.add_argument("--markdown-out", type=Path, default=ROOT / ".scratch/duplicate-resolver/review.md")
    parser.add_argument("--sample-size", type=int, default=24)
    parser.add_argument("--no-legacy", action="store_true")
    args = parser.parse_args()
    if same_file(args.json_out, args.data) or same_file(args.markdown_out, args.data):
        parser.error("refusing to overwrite the source dataset")
    if same_file(args.json_out, args.markdown_out):
        parser.error("JSON and Markdown reports must use different paths")

    source_bytes = args.data.read_bytes()
    data = json.loads(source_bytes)
    players = data["players"]
    teams = {team["id"]: team for team in data["teams"]}
    franchises = load_franchises(json.loads(args.franchises.read_text())) if args.franchises.exists() else {}
    name_counts = Counter(name_key(player.get("name") or "") for player in players)

    decisions: list[dict[str, Any]] = []
    for left, right in candidate_pairs(players):
        decision = evaluate_pair(
            players[left], players[right], teams, franchises,
            name_count=name_counts[name_key(players[left].get("name") or "")],
        )
        decision.update(a_index=left, b_index=right)
        decisions.append(decision)

    if not args.no_legacy:
        legacy = load_legacy(ROOT / "scripts/fetch-real-data.py")
        legacy_teams = {tid: team.get("name", "") for tid, team in teams.items()}
        legacy_groups: dict[str, int] = Counter(legacy.name_key(player.get("name") or "") for player in players)
        for decision in decisions:
            a, b = players[decision["a_index"]], players[decision["b_index"]]
            strict = legacy_groups[legacy.name_key(a.get("name") or "")] > 4
            legacy_candidate = legacy.name_key(a.get("name") or "") == legacy.name_key(b.get("name") or "")
            decision["legacy_candidate"] = legacy_candidate
            decision["legacy_would_merge"] = legacy_candidate and legacy.same_person(a, b, legacy_teams, strict)
    else:
        for decision in decisions:
            decision["legacy_would_merge"] = None

    clusters, deferred = plan_auto_clusters(players, decisions, teams, franchises)
    deferred_keys = {(d["a_index"], d["b_index"]) for d in deferred}
    auto = [d for d in decisions if d["decision"] == "auto_merge" and (d["a_index"], d["b_index"]) not in deferred_keys]
    review = [d for d in decisions if d["decision"] == "review"] + deferred
    rejected = [d for d in decisions if d["decision"] == "reject"]
    for decision in decisions:
        decision["players"] = [
            player_summary(players[decision["a_index"]], teams),
            player_summary(players[decision["b_index"]], teams),
        ]
    for decision in deferred:
        decision["players"] = [
            player_summary(players[decision["a_index"]], teams),
            player_summary(players[decision["b_index"]], teams),
        ]

    goalie_review = [d for d in review if "goalie_skater_review_only" in d["reasons"]]
    other_review = [d for d in review if "goalie_skater_review_only" not in d["reasons"]]
    rejected_controls = stratified(rejected, 100)
    planned_clusters = [cluster for cluster in clusters if len(cluster) > 1]
    summary = {
        "players": len(players),
        "candidate_pairs": len(decisions),
        "decisions": {
            "auto_merge": len(auto),
            "review": len(review),
            "reject": len(rejected),
        },
        "legacy_would_merge": sum(bool(d["legacy_would_merge"]) for d in decisions),
        "auto_clusters": len(planned_clusters),
        "auto_records_folded_if_approved": sum(len(cluster) - 1 for cluster in planned_clusters),
        "cluster_joins_deferred": len(deferred),
        "goalie_skater_review_only": len(goalie_review),
        "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
    }
    payload = {
        "summary": summary,
        "auto_merge": auto,
        "review": review,
        "rejected": rejected,
        "rejected_controls": rejected_controls,
        "auto_clusters": planned_clusters,
    }
    args.json_out.parent.mkdir(parents=True, exist_ok=True)
    args.markdown_out.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        "# Player duplicate audit — review only",
        "",
        "No player data was changed. `auto_merge` means eligible for a later approved plan, not already merged.",
        "",
        f"- Players: **{len(players):,}**",
        f"- Candidate pairs: **{len(decisions):,}**",
        f"- Strong matches: **{len(auto):,}**",
        f"- Needs review: **{len(review):,}** ({len(goalie_review):,} goalie/skater)",
        f"- Rejected: **{len(rejected):,}**",
        f"- Current-rule merges among candidates: **{summary['legacy_would_merge']:,}**",
        f"- Cluster joins deferred by pairwise auto-merge checks: **{len(deferred):,}**",
        "",
    ]
    lines += markdown_section("Strong matches", auto, args.sample_size)
    lines += markdown_section("Borderline matches", other_review, args.sample_size)
    lines += markdown_section("Goalie/skater review — never auto-merge in this pass", goalie_review, args.sample_size)
    lines += markdown_section(
        "Rejected controls", rejected_controls, args.sample_size, total_count=len(rejected)
    )
    args.markdown_out.write_text("\n".join(lines))

    summary["source_data_modified"] = False
    args.json_out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    summary["source_data_modified"] = args.data.read_bytes() != source_bytes
    if summary["source_data_modified"]:
        args.json_out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        print("ERROR: source dataset changed during audit", file=sys.stderr)
        return 1
    print(json.dumps(summary, indent=2))
    print(f"JSON: {args.json_out}")
    print(f"Review: {args.markdown_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
