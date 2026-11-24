import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from scripts.player_identity import (
    candidate_pairs,
    evaluate_pair,
    name_key,
    plan_auto_clusters,
    source_identities,
)


def player(pid, name="Aidan Smith", position="M", team="t-a", league="mcla",
           season: str | int = "2026", **fields):
    record = {
        "id": pid,
        "slug": pid,
        "name": name,
        "position": position,
        "teamId": team,
        "leagueId": league,
        "birthplace": {"city": "", "state": "", "country": ""},
        "seasons": [{
            "season": season,
            "teamId": team,
            "leagueId": league,
            "type": "regular",
            "gp": 10,
            "g": 1,
            "a": 1,
            "pts": 2,
        }],
    }
    record.update(fields)
    return record


def teams(*ids):
    return {tid: {"id": tid, "name": tid.replace("t-", "").replace("-", " ")}
            for tid in ids}


class NameAndSourceTests(unittest.TestCase):
    def test_name_key_folds_accents_punctuation_and_suffixes(self):
        self.assertEqual(name_key("Luc Béliveau"), name_key("luc beliveau"))
        self.assertEqual(name_key("Jo Jo Jankowski"), name_key("Jo-Jo Jankowski"))
        self.assertEqual(name_key("John Smith Jr."), name_key("John Smith"))

    def test_only_real_provider_ids_become_source_identities(self):
        self.assertIn("pll:003045", source_identities(player("p-pll-003045")))
        self.assertIn("gamesheet:123456", source_identities(player("p-gs-123456")))
        self.assertEqual(source_identities(player("p-nf-ojll-aidan-smith")), set())
        self.assertEqual(source_identities(player("p-mcla-aidan-smith-virginia")), set())


class PairDecisionTests(unittest.TestCase):
    def test_exact_name_and_dob_is_auto_merge(self):
        a = player("a", league="nf-ojll", team="t-a", dob="2001-02-03")
        b = player("b", league="nf-msl", team="t-b", season="2025", dob="2001-02-03")
        result = evaluate_pair(a, b, teams("t-a", "t-b"))
        self.assertEqual(result["decision"], "auto_merge")
        self.assertIn("exact_name_dob", result["reasons"])

    def test_conflicting_dob_is_a_cannot_link_veto(self):
        a = player("a", dob="2001-02-03")
        b = player("b", season="2025", dob="2002-02-03")
        result = evaluate_pair(a, b, teams("t-a"))
        self.assertEqual(result["decision"], "reject")
        self.assertTrue(result["cannot_link"])
        self.assertIn("conflicting_dob", result["vetoes"])

    def test_same_college_name_in_one_season_at_different_schools_is_rejected(self):
        a = player("a", team="t-school-a", league="mcla")
        b = player("b", team="t-school-b", league="mcla")
        result = evaluate_pair(a, b, teams("t-school-a", "t-school-b"))
        self.assertEqual(result["decision"], "reject")
        self.assertTrue(result["cannot_link"])
        self.assertIn("college_namesake_window", result["vetoes"])

    def test_same_club_in_full_career_is_evidence_even_when_not_current(self):
        a = player("a", team="t-new-a", league="nf-msl", season="2026")
        a["seasons"].append({"season": "2023", "teamId": "t-shared", "leagueId": "nf-ojll"})
        b = player("b", team="t-new-b", league="nf-wla", season="2025")
        b["seasons"].append({"season": "2024", "teamId": "t-shared", "leagueId": "nf-ojll"})
        result = evaluate_pair(a, b, teams("t-new-a", "t-new-b", "t-shared"))
        self.assertEqual(result["decision"], "auto_merge")
        self.assertIn("shared_career_club", result["reasons"])

    def test_shared_club_with_overlapping_rows_needs_review(self):
        a = player("a", team="t-shared", league="nf-ojll", season="2025")
        b = player("b", team="t-other", league="nf-msl", season="2026")
        b["seasons"].append({"season": "2025", "teamId": "t-shared", "leagueId": "nf-ojll"})
        result = evaluate_pair(a, b, teams("t-shared", "t-other"))
        self.assertEqual(result["decision"], "review")
        self.assertIn("overlapping_club_season", result["reasons"])

    def test_goalie_skater_shadow_is_review_only_even_with_dob(self):
        a = player("p-nf-x-aidan-smith", position="G", dob="2001-02-03")
        b = player("p-nf-x-aidan-smith", position="R", season="2025", dob="2001-02-03")
        result = evaluate_pair(a, b, teams("t-a"))
        self.assertEqual(result["decision"], "review")
        self.assertIn("goalie_skater_review_only", result["reasons"])

    def test_division_marker_does_not_split_a_program(self):
        a = player("a", team="t-mcla-vt", season="2026")
        b = player("b", team="t-mcla-vt-dii", season="2025")
        context = {
            "t-mcla-vt": {"id": "t-mcla-vt", "name": "Virginia Tech Hokies"},
            "t-mcla-vt-dii": {"id": "t-mcla-vt-dii", "name": "Virginia Tech DII Hokies"},
        }
        result = evaluate_pair(a, b, context)
        self.assertEqual(result["decision"], "auto_merge")
        self.assertIn("shared_program_alias", result["reasons"])

    def test_partial_team_name_is_not_enough_for_auto_merge(self):
        a = player("a", name="Connor Watson", team="t-wla-thunder", league="nf-wla", season="2025")
        b = player("b", name="Connor Watson", team="t-nll-halifax", league="nf-nll", season="2024", position="R")
        context = {
            "t-wla-thunder": {"id": "t-wla-thunder", "name": "Thunder"},
            "t-nll-halifax": {"id": "t-nll-halifax", "name": "Halifax Thunderbirds"},
        }
        result = evaluate_pair(a, b, context)
        self.assertEqual(result["decision"], "review")
        self.assertIn("partial_program_alias", result["reasons"])

    def test_common_name_does_not_globally_disable_cross_league_review(self):
        a = player("a", name="Tye Kurtz", team="t-pll", league="pll", season="2026")
        b = player("b", name="Tye Kurtz", team="t-nll", league="nf-nll", season="2025", position="R")
        result = evaluate_pair(a, b, teams("t-pll", "t-nll"), name_count=6)
        self.assertEqual(result["decision"], "review")
        self.assertIn("pro_crossover", result["reasons"])
        self.assertFalse(result["cannot_link"])

    def test_bio_conflicts_downgrade_otherwise_strong_matches(self):
        a = player("a", dob="2001-02-03", heightIn=71,
                   birthplace={"city": "Woodbine", "state": "MD", "country": "USA"})
        b = player("b", season="2025", dob="2001-02-03", heightIn=65,
                   birthplace={"city": "Ohsweken", "state": "ON", "country": "CAN"})
        result = evaluate_pair(a, b, teams("t-a"))
        self.assertEqual(result["decision"], "review")
        self.assertIn("bio_conflict_review", result["reasons"])
        self.assertIn("birthplace_disagrees", result["reasons"])
        self.assertIn("height_disagrees", result["reasons"])

    def test_shared_club_with_bio_conflict_needs_review(self):
        a = player("a", team="t-shared", league="nf-ojll", season="2024", heightIn=60)
        b = player("b", team="t-shared", league="nf-ojll", season="2025", heightIn=76)
        result = evaluate_pair(a, b, teams("t-shared"))
        self.assertEqual(result["decision"], "review")
        self.assertIn("bio_conflict_review", result["reasons"])

    def test_strong_program_alias_with_bio_conflict_needs_review(self):
        a = player("a", team="t-mcla-vt", season="2026", heightIn=70)
        b = player("b", team="t-mcla-vt-dii", season="2025", heightIn=78)
        context = {
            "t-mcla-vt": {"id": "t-mcla-vt", "name": "Virginia Tech Hokies"},
            "t-mcla-vt-dii": {"id": "t-mcla-vt-dii", "name": "Virginia Tech DII Hokies"},
        }
        result = evaluate_pair(a, b, context)
        self.assertEqual(result["decision"], "review")
        self.assertIn("bio_conflict_review", result["reasons"])

    def test_same_club_six_years_apart_is_auto_merge(self):
        a = player("a", team="t-shared", league="nf-ojll", season="2020")
        b = player("b", team="t-shared", league="nf-ojll", season="2026")
        self.assertEqual(evaluate_pair(a, b, teams("t-shared"))["decision"], "auto_merge")

    def test_same_club_far_apart_needs_review(self):
        a = player("a", team="t-shared", league="nf-ojll", season="2019")
        b = player("b", team="t-shared", league="nf-ojll", season="2026")
        result = evaluate_pair(a, b, teams("t-shared"))
        self.assertEqual(result["decision"], "review")
        self.assertIn("distant_career_window", result["reasons"])

    def test_shared_club_without_dated_seasons_needs_review(self):
        a = player("a", team="t-shared", league="nf-ojll", season="2024")
        b = player("b", team="t-shared", league="nf-ojll", season="2025")
        b["seasons"] = []
        result = evaluate_pair(a, b, teams("t-shared"))
        self.assertEqual(result["decision"], "review")
        self.assertIn("distant_career_window", result["reasons"])

    def test_curated_franchise_match_with_single_word_name_is_strong(self):
        a = player("a", team="t-old", league="nf-wla", season="2024")
        b = player("b", team="t-new", league="nf-wsl", season="2025")
        context = {
            "t-old": {"id": "t-old", "name": "Thunder"},
            "t-new": {"id": "t-new", "name": "Thunder"},
        }
        result = evaluate_pair(a, b, context, franchises={"t-old": "f1", "t-new": "f1"})
        self.assertEqual(result["decision"], "auto_merge")
        self.assertIn("shared_program_alias", result["reasons"])

    def test_single_word_club_alias_is_not_strong_program_evidence(self):
        a = player("a", team="t-a-thunder", league="nf-wla", season="2024")
        b = player("b", team="t-b-thunder", league="nf-osl", season="2025")
        context = {
            "t-a-thunder": {"id": "t-a-thunder", "name": "Thunder"},
            "t-b-thunder": {"id": "t-b-thunder", "name": "Thunder"},
        }
        result = evaluate_pair(a, b, context)
        self.assertEqual(result["decision"], "review")
        self.assertIn("partial_program_alias", result["reasons"])

    def test_multi_token_program_alias_is_strong(self):
        a = player("a", team="t-ucsb", league="ncaa-d1", season="2024")
        b = player("b", team="t-sb", league="ncaa-d1", season="2025")
        context = {
            "t-ucsb": {"id": "t-ucsb", "name": "UC Santa Barbara"},
            "t-sb": {"id": "t-sb", "name": "Santa Barbara"},
        }
        result = evaluate_pair(a, b, context)
        self.assertEqual(result["decision"], "auto_merge")
        self.assertIn("shared_program_alias", result["reasons"])

    def test_same_pro_club_across_seasons_needs_review(self):
        a = player("a", team="t-nll-club", league="nf-nll", season="2024")
        b = player("b", team="t-nll-club", league="nf-nll", season="2026")
        result = evaluate_pair(a, b, teams("t-nll-club"))
        self.assertEqual(result["decision"], "review")
        self.assertIn("shared_pro_career_club", result["reasons"])

    def test_college_namesakes_are_vetoed_even_with_a_shared_junior_club(self):
        a = player("a", team="t-college-a", league="mcla", season="2025")
        a["seasons"].append({"season": "2024", "teamId": "t-junior", "leagueId": "nf-ojll"})
        b = player("b", team="t-college-b", league="mcla", season="2025")
        b["seasons"].append({"season": "2024", "teamId": "t-junior", "leagueId": "nf-ojll"})
        context = teams("t-college-a", "t-college-b", "t-junior")
        result = evaluate_pair(a, b, context)
        self.assertEqual(result["decision"], "reject")
        self.assertIn("college_namesake_window", result["vetoes"])

    def test_numeric_and_string_seasons_overlap(self):
        a = player("a", team="t-shared", league="nf-ojll", season=2025)
        b = player("b", team="t-shared", league="nf-ojll", season="2025")
        result = evaluate_pair(a, b, teams("t-shared"))
        self.assertEqual(result["decision"], "review")
        self.assertIn("overlapping_club_season", result["reasons"])

    def test_name_alone_is_not_enough(self):
        a = player("a", team="t-a", league="nf-ojll")
        b = player("b", team="t-b", league="nf-wla", season="2025")
        result = evaluate_pair(a, b, teams("t-a", "t-b"))
        self.assertEqual(result["decision"], "reject")
        self.assertIn("name_only", result["reasons"])

    def test_evaluation_does_not_mutate_records(self):
        a = player("a", dob="2001-02-03")
        b = player("b", season="2025", dob="2001-02-03")
        before = copy.deepcopy((a, b))
        evaluate_pair(a, b, teams("t-a"))
        self.assertEqual((a, b), before)


class CandidateAndClusterTests(unittest.TestCase):
    def test_candidate_generation_uses_source_and_internal_ids(self):
        a = player("p-pll-123", name="Michael Smith")
        b = player("other-internal-id", name="Mike Smith", sourceIdentities=["pll:123"])
        c = player("p-nf-x-luc-beliveau", name="Luc Béliveau")
        d = player("p-nf-x-luc-beliveau", name="Luc Beliveau")
        unrelated = player("unrelated", name="Different Person")
        pairs = candidate_pairs([a, b, c, d, unrelated])
        self.assertIn((0, 1), pairs)
        self.assertIn((2, 3), pairs)
        self.assertNotIn((0, 4), pairs)

    def test_cluster_join_defers_when_any_cross_pair_has_a_veto(self):
        a = player("a", team="t-shared", league="nf-ojll", season="2022", dob="2001-01-01")
        b = player("b", team="t-shared", league="nf-ojll", season="2023")
        c = player("c", team="t-shared", league="nf-ojll", season="2024", dob="2002-01-01")
        players = [a, b, c]
        context = teams("t-shared")
        decisions = []
        for left, right in candidate_pairs(players):
            decision = evaluate_pair(players[left], players[right], context)
            decision.update(a_index=left, b_index=right)
            decisions.append(decision)
        clusters, deferred = plan_auto_clusters(players, decisions, context)
        self.assertEqual(clusters, [[0, 1], [2]])
        self.assertEqual(len(deferred), 1)
        self.assertIn("conflicting_dob", deferred[0]["vetoes"])
        by_pair = {(d["a_index"], d["b_index"]): d for d in decisions}
        for cluster in clusters:
            for left in cluster:
                for right in cluster:
                    if left < right:
                        self.assertEqual(by_pair[(left, right)]["decision"], "auto_merge")

    def test_cluster_defers_goalie_skater_transitive_join(self):
        a = player("a", team="t-shared", league="nf-ojll", season="2022", position="G")
        b = player("b", team="t-shared", league="nf-ojll", season="2023", position="G")
        c = player("c", team="t-shared", league="nf-ojll", season="2024", position="R")
        players = [a, b, c]
        context = teams("t-shared")
        decisions = []
        for left, right in candidate_pairs(players):
            decision = evaluate_pair(players[left], players[right], context)
            decision.update(a_index=left, b_index=right)
            decisions.append(decision)
        clusters, deferred = plan_auto_clusters(players, decisions, context)
        self.assertEqual(clusters, [[0, 1], [2]])
        self.assertFalse(deferred)
        self.assertEqual(
            [d["decision"] for d in decisions if 2 in (d["a_index"], d["b_index"])],
            ["review", "review"],
        )

    def test_cluster_cannot_chain_through_a_rejected_cross_pair(self):
        a = player("p-pll-123", name="Mike Smith", team="t-a", league="pll", season="2022")
        b = player("b", name="Michael Smith", team="t-shared", league="nf-ojll", season="2023",
                   sourceIdentities=["pll:123"])
        c = player("c", name="Michael Smith", team="t-shared", league="nf-ojll", season="2024")
        players = [a, b, c]
        context = teams("t-a", "t-shared")
        decisions = []
        for left, right in candidate_pairs(players):
            decision = evaluate_pair(players[left], players[right], context)
            decision.update(a_index=left, b_index=right)
            decisions.append(decision)
        self.assertEqual(decisions[0]["decision"], "auto_merge")
        clusters, deferred = plan_auto_clusters(players, decisions, context)
        self.assertNotEqual(clusters, [[0, 1, 2]])
        self.assertTrue(any("pairwise_auto_merge_required" in d["vetoes"] for d in deferred))

    def test_cli_writes_review_artifacts_without_changing_source_data(self):
        a = player("a", team="t-shared", league="nf-ojll", season="2022", dob="2001-01-01")
        b = player("b", team="t-shared", league="nf-ojll", season="2023")
        c = player("c", name="Luc Béliveau", team="t-other", league="nf-ojll", season="2024")
        d = player("c", name="Luc Beliveau", team="t-other", league="nf-ojll", season="2024", position="G")
        payload = {"players": [a, b, c, d], "teams": list(teams("t-shared", "t-other").values())}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "data.json"
            report = root / "audit.json"
            markdown = root / "review.md"
            source.write_text(json.dumps(payload))
            before = source.read_bytes()
            subprocess.run([
                sys.executable, "scripts/audit-player-duplicates.py",
                "--data", str(source), "--json-out", str(report),
                "--markdown-out", str(markdown), "--no-legacy", "--sample-size", "4",
            ], check=True, capture_output=True, text=True)
            self.assertEqual(source.read_bytes(), before)
            result = json.loads(report.read_text())
            self.assertEqual(result["summary"]["players"], 4)
            self.assertFalse(result["summary"]["source_data_modified"])
            self.assertGreaterEqual(result["summary"]["decisions"]["review"], 1)
            self.assertIn("review", result)
            self.assertIn("rejected_controls", result)
            self.assertIn("Goalie/skater", markdown.read_text())

    def test_markdown_reports_the_full_rejected_total(self):
        players = [
            player(f"p-{index}", team=f"t-school-{index}", league="mcla", season="2026")
            for index in range(15)
        ]
        payload = {
            "players": players,
            "teams": [{"id": f"t-school-{index}", "name": f"School {index}"} for index in range(15)],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "data.json"
            markdown = root / "review.md"
            source.write_text(json.dumps(payload))
            subprocess.run([
                sys.executable, "scripts/audit-player-duplicates.py",
                "--data", str(source), "--json-out", str(root / "audit.json"),
                "--markdown-out", str(markdown), "--no-legacy", "--sample-size", "1",
            ], check=True, capture_output=True, text=True)
            self.assertIn("Showing up to 1 of 105", markdown.read_text())

    def test_cli_refuses_hard_link_alias_of_the_source(self):
        payload = {"players": [player("a")], "teams": [{"id": "t-a", "name": "Team A"}]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "data.json"
            source.write_text(json.dumps(payload))
            linked_output = root / "audit.json"
            os.link(source, linked_output)
            before = source.read_bytes()
            completed = subprocess.run([
                sys.executable, "scripts/audit-player-duplicates.py",
                "--data", str(source), "--json-out", str(linked_output),
                "--markdown-out", str(root / "review.md"), "--no-legacy",
            ], capture_output=True, text=True)
            self.assertNotEqual(completed.returncode, 0)
            self.assertEqual(source.read_bytes(), before)

    def test_cli_refuses_to_use_one_path_for_both_reports(self):
        payload = {"players": [player("a")], "teams": [{"id": "t-a", "name": "Team A"}]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "data.json"
            output = root / "report.json"
            source.write_text(json.dumps(payload))
            completed = subprocess.run([
                sys.executable, "scripts/audit-player-duplicates.py",
                "--data", str(source), "--json-out", str(output),
                "--markdown-out", str(output), "--no-legacy",
            ], capture_output=True, text=True)
            self.assertNotEqual(completed.returncode, 0)
            self.assertFalse(output.exists())

    def test_cli_refuses_to_overwrite_the_source_dataset(self):
        payload = {"players": [player("a")], "teams": [{"id": "t-a", "name": "Team A"}]}
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "data.json"
            source.write_text(json.dumps(payload))
            before = source.read_bytes()
            completed = subprocess.run([
                sys.executable, "scripts/audit-player-duplicates.py",
                "--data", str(source), "--json-out", str(source),
                "--markdown-out", str(Path(directory) / "review.md"), "--no-legacy",
            ], capture_output=True, text=True)
            self.assertNotEqual(completed.returncode, 0)
            self.assertEqual(source.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
