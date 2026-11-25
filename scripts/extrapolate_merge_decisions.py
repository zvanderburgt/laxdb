#!/usr/bin/env python3
"""Extrapolate the human checklist verdicts to every remaining duplicate candidate.

Reads the pre-merge audit for the sampled pairs, derives explicit rules that reproduce
all sample verdicts, applies them to the post-merge audit, and emits a CSV plus a rule
sheet. It never changes player data.
"""
from __future__ import annotations

import argparse
import csv
from datetime import date
import json
from pathlib import Path
import re
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / ".scratch/duplicate-resolver"
DEFAULT_CHECKLIST = SCRATCH / "checklist-marked.md"

RULES = {
    "R1": ("merge", 0.94, "Same internal id, exact provider id, career club, or full program alias"),
    "R2": ("merge", 0.97, "Exact normalized name plus matching date of birth"),
    "R3": ("merge", 0.84, "Shared club with overlapping seasons, outside the college-namesake block"),
    "R4": ("merge", 0.82, "Matching birthplace plus at least one additional bio field"),
    "R5": ("merge", 0.76, "Partial program alias plus pro or college crossover"),
    "R6": ("merge", 0.84, "Goalie/skater shadow with identity evidence"),
    "R7": ("merge", 0.78, "Conflicting DOB but near-date or same-city plus height support"),
    "R8": ("keep_separate", 0.95, "Two college programs in one season: namesake window"),
    "R9": ("needs_review", 0.55, "Common-name crossover without club or bio evidence"),
    "R10": ("keep_separate", 0.95, "Goalie/skater pair without identity evidence"),
    "R11": ("keep_separate", 0.88, "Conflicting DOB without independent support"),
    "R12": ("needs_review", 0.50, "Movement evidence only; no identity support"),
    "R13": ("needs_review", 0.45, "Review evidence not covered by a sampled rule"),
    "R14": ("keep_separate", 0.90, "Name-only or insufficient identity evidence"),
}

MOVE_REASONS = {"pro_crossover", "college_to_pro", "box_ladder"}
BIO_SUPPORT = {"height_agrees", "weight_agrees", "hand_agrees", "same_high_school"}


def pair_key(decision: dict[str, Any]) -> str:
    return "|".join(sorted(player["slug"] for player in decision["players"]))


def parse_checklist(path: Path) -> list[dict[str, Any]]:
    text = path.read_text()
    items = []
    for match in re.finditer(r"(?ms)^## (\d+)\. (.+?)\n(.*?)(?=^## \d+\. |\Z)", text):
        number, title, body = int(match.group(1)), match.group(2).strip(), match.group(3)
        slugs = re.findall(r"https://laxdb\.netlify\.app/player/([a-z0-9-]+)", body)
        marked = next((name for name in ("yes", "no", "unsure")
                       if re.search(rf"\[\s*\+\s*\]\s*{name}", body, re.I)), "unmarked")
        items.append({
            "number": number,
            "title": title,
            "pair": "|".join(sorted(slugs[:2])),
            "marked": marked,
            "expected": {"yes": "merge", "no": "keep_separate", "unsure": "needs_review"}.get(marked, "unmarked"),
        })
    return items


def dob_distance(left: str, right: str) -> int | None:
    try:
        return abs((date.fromisoformat(left) - date.fromisoformat(right)).days)
    except (TypeError, ValueError):
        return None


def city_of(player: dict[str, Any]) -> str:
    return (player.get("birthplace") or "").split(",")[0].strip().casefold()


def classify(decision: dict[str, Any]) -> dict[str, Any]:
    reasons = set(decision.get("reasons") or [])
    vetoes = set(decision.get("vetoes") or [])
    a, b = decision["players"]
    rule = None
    rationale = ""

    if "college_namesake_window" in vetoes:
        rule, rationale = "R8", "Same name at two college programs in the same season"
    elif "goalie_skater_without_identity_evidence" in vetoes:
        rule, rationale = "R10", "Goalie and skater with no club, DOB, or id evidence"
    elif "conflicting_dob" in vetoes:
        days = dob_distance(a.get("dob") or "", b.get("dob") or "")
        same_city = bool(city_of(a)) and city_of(a) == city_of(b)
        heights = (a.get("heightIn") or 0, b.get("heightIn") or 0)
        close_height = all(heights) and abs(heights[0] - heights[1]) <= 1
        if (days is not None and days <= 1) or (same_city and close_height):
            rule = "R7"
            rationale = (f"DOB differs by {days} day(s), but " +
                         ("same city and height" if same_city and close_height else "near-identical DOB"))
        else:
            rule = "R11"
            rationale = f"DOB differs by {days if days is not None else 'unknown'} day(s) without support"
    elif "exact_name_dob" in reasons:
        rule, rationale = "R2", "Exact name and DOB; bio disagreements do not outweigh the DOB"
    elif reasons & {"internal_id_collision", "shared_career_club", "shared_program_alias"}:
        rule, rationale = "R1", "Shared id, full club history, or full program alias"
    elif "goalie_skater_review_only" in reasons:
        rule, rationale = "R6", "Goalie/runner records describe the same club path"
    elif "overlapping_club_season" in reasons:
        rule, rationale = "R3", "Both records share a club-season"
    elif "partial_program_alias" in reasons and reasons & MOVE_REASONS:
        rule, rationale = "R5", "Partial program alias plus a credible career crossover"
    elif "same_birthplace" in reasons and reasons & BIO_SUPPORT:
        rule, rationale = "R4", "Birthplace matches and another bio field agrees"
    elif "common_name_review" in reasons and reasons & MOVE_REASONS:
        rule, rationale = "R9", "Common name and crossover only; no club or bio tie"
    elif reasons & MOVE_REASONS:
        rule, rationale = "R12", "Career movement without a club or bio tie"
    elif decision.get("decision") == "review":
        rule, rationale = "R13", "Review evidence does not match a sampled rule"
    else:
        rule, rationale = "R14", "Name-only or insufficient identity evidence"

    action, confidence, _ = RULES[rule]
    return {
        "decision": action,
        "rule_id": rule,
        "confidence": confidence,
        "rationale": rationale,
        "needs_review": action == "needs_review" or confidence < 0.60,
    }


def flatten(decision: dict[str, Any], verdict: dict[str, Any]) -> dict[str, Any]:
    a, b = decision["players"]
    return {
        "candidate_id": pair_key(decision),
        "a_slug": a["slug"],
        "a_name": a["name"],
        "a_id": a["id"],
        "b_slug": b["slug"],
        "b_name": b["name"],
        "b_id": b["id"],
        "resolver_decision": decision["decision"],
        "resolver_score": decision["score"],
        "reasons": ";".join(decision.get("reasons") or []),
        "vetoes": ";".join(decision.get("vetoes") or []),
        "decision": verdict["decision"],
        "rule_id": verdict["rule_id"],
        "confidence": f"{verdict['confidence']:.2f}",
        "rationale": verdict["rationale"],
        "needs_review": "yes" if verdict["needs_review"] else "no",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checklist", type=Path, default=DEFAULT_CHECKLIST)
    parser.add_argument("--sample-audit", type=Path, default=SCRATCH / "audit.json")
    parser.add_argument("--candidates", type=Path, default=SCRATCH / "audit-after.json")
    parser.add_argument("--out", type=Path, default=SCRATCH / "merge_decisions_extrapolated.csv")
    parser.add_argument("--rules-out", type=Path, default=SCRATCH / "merge_rules.md")
    parser.add_argument("--sample-out", type=Path, default=SCRATCH / "sample_decision_matrix.csv")
    parser.add_argument("--review-out", type=Path, default=SCRATCH / "merge_decisions_needs_review.csv")
    parser.add_argument("--summary-out", type=Path, default=SCRATCH / "merge_decisions_summary.json")
    parser.add_argument("--spot-check", type=int, default=5)
    args = parser.parse_args()

    samples = parse_checklist(args.checklist)
    sample_audit = json.loads(args.sample_audit.read_text())
    sample_rows = {
        pair_key(decision): decision
        for decision in sample_audit["auto_merge"] + sample_audit["review"] + sample_audit["rejected"]
    }
    candidate_audit = json.loads(args.candidates.read_text())
    candidates = (candidate_audit["auto_merge"] + candidate_audit["review"] + candidate_audit["rejected"])

    print(f"sample decisions: {args.checklist} ({len(samples)} rows)")
    print(f"sample feature audit: {args.sample_audit} ({len(sample_rows)} candidate pairs)")
    print(f"remaining candidates: {args.candidates} ({len(candidates)} rows)")

    reproduced = {}
    sample_sources = {}
    conflicts = []
    for sample in samples:
        source = sample_rows.get(sample["pair"])
        if source is None:
            conflicts.append(f"#{sample['number']} {sample['title']}: sample pair not found in feature audit")
            continue
        verdict = classify(source)
        reproduced[sample["number"]] = verdict
        sample_sources[sample["number"]] = source
        if verdict["decision"] != sample["expected"]:
            conflicts.append(
                f"#{sample['number']} {sample['title']}: expected {sample['expected']}, "
                f"got {verdict['decision']} via {verdict['rule_id']}"
            )

    if conflicts:
        print("\nSAMPLE CONFLICTS")
        for conflict in conflicts:
            print("  " + conflict)
    else:
        print(f"sample reproduction: 100% ({len(reproduced)}/{len(samples)})")

    decided_pairs = {sample["pair"] for sample in samples}
    remaining = [decision for decision in candidates if pair_key(decision) not in decided_pairs]
    expected_remaining = len(candidates) - sum(1 for pair in decided_pairs if any(pair_key(d) == pair for d in candidates))
    rows = []
    for decision in remaining:
        rows.append(flatten(decision, classify(decision)))

    ids = [row["candidate_id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate candidate ids in output")
    if len(rows) != expected_remaining:
        raise SystemExit(f"row count {len(rows)} != remaining candidates {expected_remaining}")
    if conflicts:
        raise SystemExit("refusing to write while a sample verdict is not reproduced")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    columns = list(rows[0]) if rows else [
        "candidate_id", "a_slug", "a_name", "a_id", "b_slug", "b_name", "b_id",
        "resolver_decision", "resolver_score", "reasons", "vetoes", "decision",
        "rule_id", "confidence", "rationale", "needs_review",
    ]
    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)

    sample_matrix = []
    for sample in samples:
        source = sample_sources.get(sample["number"])
        verdict = reproduced.get(sample["number"])
        if source is None or verdict is None:
            continue
        sample_matrix.append({
            "number": sample["number"],
            "title": sample["title"],
            "marked": sample["marked"],
            "expected": sample["expected"],
            "actual": verdict["decision"],
            "reproduced": "yes" if verdict["decision"] == sample["expected"] else "NO",
            "rule_id": verdict["rule_id"],
            "confidence": f"{verdict['confidence']:.2f}",
            "candidate_id": sample["pair"],
            "resolution": source.get("decision", ""),
            "reasons": ";".join(source.get("reasons") or []),
            "vetoes": ";".join(source.get("vetoes") or []),
        })
    with args.sample_out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(sample_matrix[0]))
        writer.writeheader()
        writer.writerows(sample_matrix)

    review_rows = [row for row in rows if row["needs_review"] == "yes"]
    with args.review_out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(review_rows)

    decision_counts: dict[str, int] = {}
    rule_counts: dict[str, int] = {}
    for row in rows:
        decision_counts[row["decision"]] = decision_counts.get(row["decision"], 0) + 1
        rule_counts[row["rule_id"]] = rule_counts.get(row["rule_id"], 0) + 1

    summary = {
        "samples": len(samples),
        "samples_reproduced": sum(1 for row in sample_matrix if row["reproduced"] == "yes"),
        "sample_conflicts": conflicts,
        "candidates": len(candidates),
        "already_decided": len(candidates) - len(remaining),
        "remaining": len(rows),
        "decisions": decision_counts,
        "rules": rule_counts,
        "needs_review": len(review_rows),
        "output": str(args.out),
        "review_output": str(args.review_out),
    }
    args.summary_out.write_text(json.dumps(summary, indent=2) + "\n")

    rule_lines = [
        "# Extrapolated duplicate rules",
        "",
        "Derived from the 15 reviewed checklist pairs. Sample reproduction is asserted before output.",
        "",
        "| Rule | Decision | Confidence | Condition | Matched remaining |",
        "| --- | --- | --- | --- | --- |",
    ]
    for rule_id, (action, confidence, condition) in RULES.items():
        rule_lines.append(f"| {rule_id} | {action} | {confidence:.2f} | {condition} | {rule_counts.get(rule_id, 0)} |")
    rule_lines += [
        "",
        "Sample decisions reproduced: " + ("100%" if not conflicts else "CONFLICT"),
        "",
    ]
    args.rules_out.write_text("\n".join(rule_lines))

    print(f"\nwrote {len(rows)} decisions -> {args.out}")
    print(f"wrote rule table -> {args.rules_out}")
    print("decisions:", ", ".join(f"{key} {value}" for key, value in sorted(decision_counts.items())))
    print("rules:", ", ".join(f"{key} {value}" for key, value in sorted(rule_counts.items())))

    print(f"\nspot checks ({args.spot_check} per decision class):")
    for action in ("merge", "keep_separate", "needs_review"):
        print(f"\n[{action}]")
        count = 0
        for row in rows:
            if row["decision"] != action:
                continue
            print(f"  {row['rule_id']} {row['candidate_id']} · {row['a_name']} / {row['b_name']} · {row['rationale']}")
            count += 1
            if count >= args.spot_check:
                break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
