#!/usr/bin/env python3
"""Evidence-based player identity candidates. This module never merges or writes records."""
from __future__ import annotations

import re
import unicodedata
from itertools import combinations
from typing import Any

COLLEGE_LEAGUES = {"ncaa-d1", "mcla"}
PRO_LEAGUES = {"pll", "nf-nll", "nf-msl", "nf-wla", "nf-osl"}
STRICT_PRO_LEAGUES = {"pll", "nf-nll", "nf-msl"}
BOX_FAMILIES = {"rmll", "ontario", "bc", "west"}
DIVISION_TOKENS = {
    "d1", "d2", "d3", "di", "dii", "diii",
    "division1", "division2", "division3", "divisioni", "divisionii", "divisioniii",
}
NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def _ascii(value: str) -> str:
    return unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode()


def name_key(name: str) -> str:
    """Unicode-folded comparison key; suffixes and punctuation do not create new people."""
    tokens = re.findall(r"[a-z0-9]+", _ascii(name).lower())
    return "".join(token for token in tokens if token not in NAME_SUFFIXES)


def _words(value: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", _ascii(value).lower())


def source_identities(player: dict[str, Any]) -> set[str]:
    """Return genuine provider IDs, never our synthetic NetFront/MCLA name keys."""
    found: set[str] = set()
    pid = player.get("id") or ""
    match = re.fullmatch(r"p-pll-(.+)", pid)
    if match:
        found.add(f"pll:{match.group(1)}")
    match = re.fullmatch(r"p-gs-(\d+)", pid)
    if match:
        found.add(f"gamesheet:{match.group(1)}")
    for value in player.get("sourceIdentities") or []:
        if isinstance(value, str) and ":" in value:
            found.add(value)
        elif isinstance(value, dict) and value.get("source") and value.get("id") is not None:
            found.add(f"{value['source']}:{value['id']}")
    return found


def career_teams(player: dict[str, Any]) -> set[str]:
    return {str(s["teamId"]) for s in player.get("seasons") or [] if s.get("teamId")} | (
        {str(player["teamId"])} if player.get("teamId") else set()
    )


def career_leagues(player: dict[str, Any]) -> set[str]:
    return {str(s["leagueId"]) for s in player.get("seasons") or [] if s.get("leagueId")} | (
        {str(player["leagueId"])} if player.get("leagueId") else set()
    )


def years(player: dict[str, Any], league: str | None = None) -> set[int]:
    return {
        int(s["season"])
        for s in player.get("seasons") or []
        if str(s.get("season", "")).isdigit()
        and (league is None or s.get("leagueId") == league)
    }


def career_gap(a: dict[str, Any], b: dict[str, Any]) -> int | None:
    years_a, years_b = years(a), years(b)
    if not years_a or not years_b:
        return None
    return min(abs(left - right) for left in years_a for right in years_b)


def league_family(league: str) -> str:
    if league.startswith("nf-rmll"):
        return "rmll"
    if league in {"nf-ojbll", "nf-ojcll", "nf-ojll"}:
        return "ontario"
    if league == "nf-bcjall":
        return "bc"
    if league in {"nf-wcjll", "nf-pnwjll", "nf-tojll"}:
        return "west"
    return league


def _program_tokens(team_id: str, teams: dict[str, dict[str, Any]]) -> list[str]:
    team = teams.get(team_id) or {}
    return [
        token for token in _words(team.get("name") or team.get("shortName") or team_id)
        if token not in DIVISION_TOKENS
    ]


def program_key(team_id: str, teams: dict[str, dict[str, Any]],
                franchises: dict[str, str]) -> str:
    if franchises.get(team_id):
        return f"franchise:{franchises[team_id]}"
    return "".join(_program_tokens(team_id, teams))


def program_match_kind(a: str, b: str, teams: dict[str, dict[str, Any]],
                       franchises: dict[str, str]) -> str | None:
    ka, kb = program_key(a, teams, franchises), program_key(b, teams, franchises)
    if not ka or not kb:
        return None
    if ka == kb:
        if ka.startswith("franchise:"):
            return "exact"
        return "exact" if len(_program_tokens(a, teams)) >= 2 else "partial"
    if ka.startswith("franchise:") or kb.startswith("franchise:"):
        return None
    if (ka in kb or kb in ka) and min(len(ka), len(kb)) >= 6:
        both_specific = len(_program_tokens(a, teams)) >= 2 and len(_program_tokens(b, teams)) >= 2
        return "exact" if both_specific else "partial"
    return None


def compatible_program(a: str, b: str, teams: dict[str, dict[str, Any]],
                       franchises: dict[str, str]) -> bool:
    return program_match_kind(a, b, teams, franchises) is not None


def shared_programs(a: dict[str, Any], b: dict[str, Any],
                    teams: dict[str, dict[str, Any]],
                    franchises: dict[str, str]) -> set[tuple[str, str]]:
    return {
        (ta, tb)
        for ta in career_teams(a)
        for tb in career_teams(b)
        if ta != tb and compatible_program(ta, tb, teams, franchises)
    }


def overlapping_program_season(a: dict[str, Any], b: dict[str, Any],
                               teams: dict[str, dict[str, Any]],
                               franchises: dict[str, str]) -> bool:
    for sa in a.get("seasons") or []:
        for sb in b.get("seasons") or []:
            if str(sa.get("season")) != str(sb.get("season")):
                continue
            ta, tb = sa.get("teamId"), sb.get("teamId")
            if ta and tb and (ta == tb or compatible_program(ta, tb, teams, franchises)):
                return True
    return False


def same_pro_club(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """A shared pro club is a namesake risk, not proof of identity."""
    for team in career_teams(a) & career_teams(b):
        leagues_a = {
            str(s.get("leagueId")) for s in a.get("seasons") or []
            if s.get("teamId") == team and s.get("leagueId")
        }
        leagues_b = {
            str(s.get("leagueId")) for s in b.get("seasons") or []
            if s.get("teamId") == team and s.get("leagueId")
        }
        if leagues_a & leagues_b & STRICT_PRO_LEAGUES:
            return True
    return False


def _movement_evidence(a: dict[str, Any], b: dict[str, Any]) -> list[str]:
    evidence: set[str] = set()
    for la in career_leagues(a):
        for lb in career_leagues(b):
            if la == lb:
                continue
            gap = min((abs(x - y) for x in years(a, la) for y in years(b, lb)), default=999)
            if la in PRO_LEAGUES and lb in PRO_LEAGUES and gap <= 5:
                evidence.add("pro_crossover")
            if "ncaa-d1" in {la, lb} and ({la, lb} - {"ncaa-d1"}) & PRO_LEAGUES and gap <= 2:
                evidence.add("college_to_pro")
            fa, fb = league_family(la), league_family(lb)
            if fa == fb and fa in BOX_FAMILIES and gap <= 1:
                evidence.add("box_ladder")
    return sorted(evidence)


def _bio_score(a: dict[str, Any], b: dict[str, Any]) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    ba, bb = a.get("birthplace") or {}, b.get("birthplace") or {}
    city_a, city_b = _ascii(ba.get("city") or "").strip().lower(), _ascii(bb.get("city") or "").strip().lower()
    if city_a and city_b:
        if city_a == city_b:
            if not ba.get("state") or not bb.get("state") or ba.get("state") == bb.get("state"):
                score += 20
                reasons.append("same_birthplace")
        else:
            score -= 12
            reasons.append("birthplace_disagrees")
    ha, hb = name_key(a.get("highSchool") or ""), name_key(b.get("highSchool") or "")
    if ha and ha == hb:
        score += 20
        reasons.append("same_high_school")
    if a.get("classYear") and a.get("classYear") == b.get("classYear"):
        score += 8
        reasons.append("same_class_year")
    height_a, height_b = a.get("heightIn") or 0, b.get("heightIn") or 0
    if height_a and height_b:
        if abs(height_a - height_b) <= 1:
            score += 6
            reasons.append("height_agrees")
        elif abs(height_a - height_b) >= 3:
            score -= 8
            reasons.append("height_disagrees")
    weight_a, weight_b = a.get("weightLb") or 0, b.get("weightLb") or 0
    if weight_a and weight_b and abs(weight_a - weight_b) <= 10:
        score += 4
        reasons.append("weight_agrees")
    if a.get("hand") and b.get("hand"):
        if a["hand"] == b["hand"]:
            score += 5
            reasons.append("hand_agrees")
        else:
            score -= 8
            reasons.append("hand_disagrees")
    return score, reasons


def evaluate_pair(a: dict[str, Any], b: dict[str, Any],
                  teams: dict[str, dict[str, Any]],
                  franchises: dict[str, str] | None = None,
                  name_count: int = 2) -> dict[str, Any]:
    """Classify one pair. Review means a human must decide; no cluster is formed here."""
    franchises = franchises or {}
    reasons: list[str] = []
    vetoes: list[str] = []
    cannot_link = False
    same_name = bool(name_key(a.get("name") or "")) and name_key(a.get("name") or "") == name_key(b.get("name") or "")
    ids = source_identities(a) & source_identities(b)
    dob_a, dob_b = a.get("dob"), b.get("dob")
    same_dob = bool(dob_a and dob_b and dob_a == dob_b)
    shared_teams = career_teams(a) & career_teams(b)
    aliases = shared_programs(a, b, teams, franchises)
    strong_aliases = {
        (ta, tb) for ta, tb in aliases
        if program_match_kind(ta, tb, teams, franchises) == "exact"
    }
    partial_aliases = aliases - strong_aliases
    shared_club = bool(shared_teams or aliases)
    strong_shared_club = bool(shared_teams or strong_aliases)
    overlap = overlapping_program_season(a, b, teams, franchises)
    goalie_skater = "G" in {a.get("position"), b.get("position")} and a.get("position") != b.get("position")
    bio_score, bio_reasons = _bio_score(a, b)
    bio_conflicts = {"birthplace_disagrees", "height_disagrees", "hand_disagrees"} & set(bio_reasons)

    def result(decision: str, score: int) -> dict[str, Any]:
        return {
            "decision": decision,
            "score": score,
            "reasons": list(dict.fromkeys(reasons)),
            "vetoes": list(dict.fromkeys(vetoes)),
            "cannot_link": cannot_link,
            "evidence": {
                "source_ids": sorted(ids),
                "shared_teams": sorted(shared_teams),
                "shared_programs": sorted(aliases),
                "overlapping_program_season": overlap,
                "name_count": name_count,
            },
        }

    def with_bio(decision: str, score: int) -> dict[str, Any]:
        reasons.extend(bio_reasons)
        if bio_conflicts:
            reasons.append("bio_conflict_review")
            return result("review", min(score, 79))
        return result(decision, score)

    if dob_a and dob_b and dob_a != dob_b:
        vetoes.append("conflicting_dob")
        cannot_link = True
        return result("reject", 0)

    if goalie_skater:
        if ids or same_dob or shared_club or a.get("id") == b.get("id"):
            reasons.append("goalie_skater_review_only")
            if a.get("id") == b.get("id"):
                reasons.append("internal_id_collision")
            return with_bio("review", 70)
        vetoes.append("goalie_skater_without_identity_evidence")
        cannot_link = True
        return result("reject", 0)

    if ids:
        reasons.append("exact_provider_id")
        reasons.extend(bio_reasons)
        return result("auto_merge", 100)
    if not same_name:
        reasons.append("name_mismatch")
        return result("reject", 0)
    if same_dob:
        reasons.append("exact_name_dob")
        return with_bio("auto_merge", 98)

    # Two players with the same name at different college programs in one season are the
    # control case that motivated conservative matching. Provider/DOB evidence above can
    # override this heuristic; club-only evidence cannot.
    for league in COLLEGE_LEAGUES:
        if years(a, league) & years(b, league):
            vetoes.append("college_namesake_window")
            cannot_link = True
            return result("reject", 0)

    if a.get("id") == b.get("id"):
        reasons.append("internal_id_collision")
    if overlap and shared_club:
        reasons.append("overlapping_club_season")
        return with_bio("review", 75)
    if shared_teams and same_pro_club(a, b):
        reasons.append("shared_pro_career_club")
        return with_bio("review", 72)

    gap = career_gap(a, b)
    if (shared_teams or strong_aliases) and (gap is None or gap > 6):
        reasons.append("distant_career_window")
        reasons.extend(bio_reasons)
        if bio_conflicts:
            reasons.append("bio_conflict_review")
        return result("review", 70)
    if shared_teams:
        reasons.append("shared_career_club")
        return with_bio("auto_merge", 90)
    if strong_aliases:
        reasons.append("shared_program_alias")
        return with_bio("auto_merge", 86)

    score = 10
    if partial_aliases:
        score += 35
        reasons.append("partial_program_alias")
    movement = _movement_evidence(a, b)
    reasons.extend(movement)
    score += 35 if "pro_crossover" in movement else 0
    score += 35 if "college_to_pro" in movement else 0
    score += 30 if "box_ladder" in movement else 0
    score += bio_score
    reasons.extend(bio_reasons)
    if name_count > 4:
        score -= 5
        reasons.append("common_name_review")
    if reasons == ["internal_id_collision"]:
        score += 20
    if score >= 35:
        return result("review", score)
    if not reasons:
        reasons.append("name_only")
    elif not movement and not bio_reasons:
        reasons.append("name_only")
    else:
        reasons.append("insufficient_identity_evidence")
    return result("reject", score)


def candidate_pairs(players: list[dict[str, Any]]) -> list[tuple[int, int]]:
    """Generate exact-name/source-ID/internal-ID pairs without comparing every player."""
    buckets: dict[str, list[int]] = {}
    for index, player in enumerate(players):
        keys = {f"name:{name_key(player.get('name') or '')}"}
        keys |= {f"source:{value}" for value in source_identities(player)}
        keys.add(f"internal:{player.get('id')}")
        for key in keys:
            buckets.setdefault(key, []).append(index)
    pairs = {
        (left, right)
        for indices in buckets.values()
        for left, right in combinations(indices, 2)
    }
    return sorted(pairs)


def plan_auto_clusters(players: list[dict[str, Any]], decisions: list[dict[str, Any]],
                       teams: dict[str, dict[str, Any]],
                       franchises: dict[str, str] | None = None,
                       ) -> tuple[list[list[int]], list[dict[str, Any]]]:
    """Plan deterministic clusters, requiring every cross-pair to accept the merge."""
    franchises = franchises or {}
    cache = {
        (d["a_index"], d["b_index"]): d
        for d in decisions
    }
    clusters: list[list[int]] = [[index] for index in range(len(players))]
    deferred: list[dict[str, Any]] = []
    ordered = sorted(
        (d for d in decisions if d["decision"] == "auto_merge"),
        key=lambda d: (-d["score"], d["a_index"], d["b_index"]),
    )

    def cluster_of(index: int) -> int:
        return next(i for i, cluster in enumerate(clusters) if index in cluster)

    for candidate in ordered:
        left_index, right_index = candidate["a_index"], candidate["b_index"]
        left_cluster, right_cluster = cluster_of(left_index), cluster_of(right_index)
        if left_cluster == right_cluster:
            continue
        conflicts: list[dict[str, Any]] = []
        for left in clusters[left_cluster]:
            for right in clusters[right_cluster]:
                key = (min(left, right), max(left, right))
                decision = cache.get(key)
                if decision is None:
                    decision = evaluate_pair(players[key[0]], players[key[1]], teams, franchises)
                if decision["decision"] != "auto_merge":
                    conflicts.append(decision)
        if conflicts:
            vetoed = dict(candidate)
            vetoed["decision"] = "review"
            vetoed["cannot_link"] = True
            vetoed["reasons"] = candidate["reasons"] + ["cluster_pairwise_auto_merge_required"]
            vetoed["vetoes"] = sorted(
                {v for decision in conflicts for v in decision["vetoes"]}
                | {"pairwise_auto_merge_required"}
            )
            deferred.append(vetoed)
            continue
        clusters[left_cluster].extend(clusters[right_cluster])
        clusters[left_cluster].sort()
        del clusters[right_cluster]
    clusters.sort(key=lambda cluster: cluster[0])
    return clusters, deferred


def load_franchises(payload: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for group in payload.get("groups", []):
        for item in group.get("names", []):
            if item.get("teamId"):
                result[item["teamId"]] = group["id"]
    return result
