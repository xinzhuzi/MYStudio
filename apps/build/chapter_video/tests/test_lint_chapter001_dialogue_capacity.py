from __future__ import annotations

import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path

from apps.build.chapter_video.lint_chapter001_dialogue_capacity import (
    FAST_EMOTION_HINTS,
    SLOW_EMOTION_HINTS,
    lint_dialogue_capacity,
    main,
)


def make_dialogue(char_count: int) -> str:
    return "台" * char_count


class LintChapter001DialogueCapacityTest(unittest.TestCase):
    def test_emotion_word_lists_mirror_storyboard_table_truth(self) -> None:
        # 逐字镜像代码真源 storyboard-table.ts:67-68(FAST/SLOW 词表)。
        self.assertEqual(
            FAST_EMOTION_HINTS,
            ["愤怒", "激动", "急促", "亢奋", "暴怒", "嘶吼", "怒"],
        )
        self.assertEqual(
            SLOW_EMOTION_HINTS,
            ["悲伤", "绝望", "低语", "虚弱", "哽咽", "无力", "气若游丝", "垂死"],
        )

    def test_angry_rate_four_boundary_36_pass_37_red(self) -> None:
        # 怒4:10s-1s=9s 可用 → 容量 floor(9×4)=36;36 字过,37 字红。
        passing = lint_dialogue_capacity([
            {
                "storyboardId": "sb-001",
                "durationSec": 10,
                "lines": make_dialogue(36),
                "emotion": "愤怒",
            },
        ])
        self.assertEqual(passing["violations"], [])
        self.assertEqual(passing["checked"], 1)
        self.assertEqual(passing["shots"], 1)

        failing = lint_dialogue_capacity([
            {
                "storyboardId": "sb-002",
                "durationSec": 10,
                "lines": make_dialogue(37),
                "emotion": "愤怒",
            },
        ])
        self.assertEqual(len(failing["violations"]), 1)
        violation = failing["violations"][0]
        self.assertEqual(violation["storyboardId"], "sb-002")
        self.assertEqual(violation["rate"], 4)
        self.assertEqual(violation["overheadSec"], 1.0)
        self.assertEqual(violation["availableSec"], 9.0)
        self.assertEqual(violation["capacityChars"], 36)
        self.assertEqual(violation["dialogueChars"], 37)
        self.assertEqual(violation["overflowChars"], 1)

    def test_default_emotion_falls_back_to_rate_three(self) -> None:
        # 平3:情绪缺失与未命中词表都走缺省 3 字/秒(storyboard-table.ts:74)。
        for emotion in (None, "回忆"):
            shot = {
                "storyboardId": "sb-003",
                "durationSec": 10,
                "lines": make_dialogue(27),
            }
            if emotion is not None:
                shot["emotion"] = emotion
            passing = lint_dialogue_capacity([shot])
            self.assertEqual(passing["violations"], [])

            shot["lines"] = make_dialogue(28)
            failing = lint_dialogue_capacity([shot])
            self.assertEqual(len(failing["violations"]), 1)
            self.assertEqual(failing["violations"][0]["rate"], 3)
            self.assertEqual(failing["violations"][0]["capacityChars"], 27)
            self.assertEqual(failing["violations"][0]["overflowChars"], 1)

    def test_slow_rate_two_boundary(self) -> None:
        # 悲2:低语 10s-1s=9s → 容量 18;18 字过,19 字红。
        shot = {
            "storyboardId": "sb-004",
            "durationSec": 10,
            "lines": make_dialogue(18),
            "emotion": "低语",
        }
        passing = lint_dialogue_capacity([shot])
        self.assertEqual(passing["violations"], [])

        shot["lines"] = make_dialogue(19)
        failing = lint_dialogue_capacity([shot])
        self.assertEqual(len(failing["violations"]), 1)
        self.assertEqual(failing["violations"][0]["rate"], 2)
        self.assertEqual(failing["violations"][0]["capacityChars"], 18)
        self.assertEqual(failing["violations"][0]["overflowChars"], 1)

    def test_overhead_override_listener_reaction_shot(self) -> None:
        # 逐镜开销覆写:听者反应镜 overhead=3 → 可用 7s×3=21;21 字过,22 字红。
        shot = {
            "storyboardId": "sb-005",
            "durationSec": 10,
            "lines": make_dialogue(21),
            "emotion": "平常",
            "nonspeechOverheadSec": 3,
        }
        passing = lint_dialogue_capacity([shot])
        self.assertEqual(passing["violations"], [])

        shot["lines"] = make_dialogue(22)
        failing = lint_dialogue_capacity([shot])
        self.assertEqual(len(failing["violations"]), 1)
        violation = failing["violations"][0]
        self.assertEqual(violation["overheadSec"], 3.0)
        self.assertEqual(violation["availableSec"], 7.0)
        self.assertEqual(violation["capacityChars"], 21)
        self.assertEqual(violation["overflowChars"], 1)

    def test_empty_lines_shot_is_skipped_not_checked(self) -> None:
        # 空台词镜记 skipped 不查;即使时长缺失,空台词仍优先 skipped。
        report = lint_dialogue_capacity([
            {"storyboardId": "sb-006", "durationSec": 10, "lines": "", "emotion": "愤怒"},
            {"storyboardId": "sb-007", "durationSec": 10, "lines": None},
            {"storyboardId": "sb-008", "lines": ""},
        ])
        self.assertEqual(report["violations"], [])
        self.assertEqual(report["checked"], 0)
        self.assertEqual(
            [item["storyboardId"] for item in report["skipped"]],
            ["sb-006", "sb-007", "sb-008"],
        )

    def test_missing_or_nonpositive_duration_with_dialogue_is_violation(self) -> None:
        # durationSec 缺失或 ≤0 且有台词 → 红并记「缺有效时长无法核容」。
        for duration in (None, 0, -2):
            shot = {
                "storyboardId": "sb-009",
                "lines": make_dialogue(5),
                "emotion": "愤怒",
            }
            if duration is not None:
                shot["durationSec"] = duration
            report = lint_dialogue_capacity([shot])
            self.assertEqual(len(report["violations"]), 1)
            violation = report["violations"][0]
            self.assertIn("缺有效时长无法核容", violation["reason"])
            self.assertEqual(violation["storyboardId"], "sb-009")
            self.assertEqual(violation["dialogueChars"], 5)

    def test_report_is_advisory_only_and_never_mutates_input(self) -> None:
        # 提案二禁止路径验收:lint 只出建议字符串,零改写输入;
        # 模块不存在任何 setter/fix 入口(机械翻倍/提速在自动逻辑中不可达)。
        import apps.build.chapter_video.lint_chapter001_dialogue_capacity as module

        shots = [
            {
                "storyboardId": "sb-010",
                "durationSec": 10,
                "lines": make_dialogue(40),
                "emotion": "愤怒",
                "nonspeechOverheadSec": 1,
            },
        ]
        snapshot = copy.deepcopy(shots)
        report = lint_dialogue_capacity(shots)
        self.assertEqual(shots, snapshot)

        self.assertEqual(len(report["violations"]), 1)
        for violation in report["violations"]:
            self.assertTrue(all(isinstance(remedy, str) for remedy in violation["remedies"]))
            self.assertNotIn("autoFix", violation)

        forbidden_prefixes = (
            "set_",
            "fix_",
            "repair_",
            "apply_",
            "double_",
            "extend_",
            "shorten_",
            "speed_",
            "mutate_",
        )
        forbidden = [
            name
            for name, value in vars(module).items()
            if callable(value) and name.startswith(forbidden_prefixes)
        ]
        self.assertEqual(forbidden, [])

    def test_main_exit_codes_and_both_json_shapes(self) -> None:
        # main():无违例退出 0(裸数组形态),有违例退出 1({shots:[...]} 形态)。
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            clean_path = root / "clean.json"
            clean_path.write_text(
                json.dumps([
                    {
                        "storyboardId": "sb-011",
                        "durationSec": 10,
                        "lines": make_dialogue(27),
                        "emotion": "平静",
                    },
                ], ensure_ascii=False),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = main([str(clean_path)])
            self.assertEqual(exit_code, 0)
            clean_report = json.loads(stdout.getvalue())
            self.assertEqual(clean_report["violations"], [])
            self.assertEqual(clean_report["checked"], 1)

            dirty_path = root / "dirty.json"
            dirty_path.write_text(
                json.dumps({
                    "shots": [
                        {
                            "storyboardId": "sb-012",
                            "durationSec": 10,
                            "lines": make_dialogue(40),
                            "emotion": "愤怒",
                        },
                    ],
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = main([str(dirty_path)])
            self.assertEqual(exit_code, 1)
            dirty_report = json.loads(stdout.getvalue())
            self.assertEqual(len(dirty_report["violations"]), 1)
            self.assertEqual(dirty_report["violations"][0]["storyboardId"], "sb-012")


if __name__ == "__main__":
    unittest.main()
