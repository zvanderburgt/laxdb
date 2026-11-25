import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "extrapolate_merge_decisions", ROOT / "scripts/extrapolate_merge_decisions.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def decision(reasons=(), vetoes=(), dob_a="", dob_b="", city_a="", city_b="",
             height_a=0, height_b=0, resolver="review"):
    return {
        "decision": resolver,
        "score": 0,
        "reasons": list(reasons),
        "vetoes": list(vetoes),
        "players": [
            {"slug": "a", "name": "A", "id": "a", "dob": dob_a,
             "birthplace": city_a, "heightIn": height_a},
            {"slug": "b", "name": "B", "id": "b", "dob": dob_b,
             "birthplace": city_b, "heightIn": height_b},
        ],
    }


class RuleTests(unittest.TestCase):
    def test_sample_rules_cover_each_verdict_shape(self):
        cases = [
            (decision(["exact_name_dob"]), "R2", "merge"),
            (decision(["internal_id_collision"]), "R1", "merge"),
            (decision(["overlapping_club_season"]), "R3", "merge"),
            (decision(["same_birthplace", "height_agrees"]), "R4", "merge"),
            (decision(["partial_program_alias", "pro_crossover"]), "R5", "merge"),
            (decision(["goalie_skater_review_only"]), "R6", "merge"),
            (decision(["pro_crossover", "common_name_review"]), "R9", "needs_review"),
            (decision([], ["college_namesake_window"]), "R8", "keep_separate"),
            (decision([], ["goalie_skater_without_identity_evidence"]), "R10", "keep_separate"),
            (decision(["pro_crossover"]), "R12", "needs_review"),
            (decision(["same_high_school"]), "R13", "needs_review"),
            (decision(["name_only"], resolver="reject"), "R14", "keep_separate"),
        ]
        for source, rule, action in cases:
            with self.subTest(rule=rule):
                result = MODULE.classify(source)
                self.assertEqual((result["rule_id"], result["decision"]), (rule, action))

    def test_conflicting_dob_needs_near_date_or_city_and_height(self):
        close = decision([], ["conflicting_dob"], "2006-04-10", "2006-04-11")
        self.assertEqual(MODULE.classify(close)["rule_id"], "R7")
        supported = decision([], ["conflicting_dob"], "2004-04-21", "2003-12-31",
                             "Oakville, Ontario", "Oakville", 69, 70)
        self.assertEqual(MODULE.classify(supported)["rule_id"], "R7")
        unsupported = decision([], ["conflicting_dob"], "2004-04-21", "2003-12-31",
                               "Oakville, Ontario", "Whitby", 69, 74)
        self.assertEqual(MODULE.classify(unsupported)["rule_id"], "R11")

    def test_checklist_parser_reads_yes_no_unsure(self):
        text = """## 1. One — Strong
- A: [A](https://laxdb.netlify.app/player/a)
- B: [B](https://laxdb.netlify.app/player/b)
- Check: [+] yes  [ ] no  [ ] unsure
## 2. Two — Borderline
- A: [A](https://laxdb.netlify.app/player/c)
- B: [B](https://laxdb.netlify.app/player/d)
- Check: [ ] yes  [ + ] no  [ ] unsure
## 3. Three — Borderline
- A: [A](https://laxdb.netlify.app/player/e)
- B: [B](https://laxdb.netlify.app/player/f)
- Check: [ ] yes  [ ] no  [ + ] unsure
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checklist.md"
            path.write_text(text)
            rows = MODULE.parse_checklist(path)
        self.assertEqual([row["marked"] for row in rows], ["yes", "no", "unsure"])
        self.assertEqual([row["expected"] for row in rows], ["merge", "keep_separate", "needs_review"])


if __name__ == "__main__":
    unittest.main()
