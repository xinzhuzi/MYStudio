from __future__ import annotations

import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path

from apps.build.chapter_video.lint_chapter001_dialogue_capacity import (
    MISSING_DURATION_REASON,
)
from apps.build.chapter_video.review_chapter001_duration_chain import (
    DECISION_OPTIONS,
    TOLERANCE_ABS_SEC,
    TOLERANCE_RATIO,
    adapt_workflow_shots,
    main,
    review_duration_chain,
    scene_four_tuple,
    shot_forward_sec,
)


def make_dialogue(char_count: int) -> str:
    return "台" * char_count


def make_shot(
    scene_no=1,
    char_count=12,
    duration=None,
    emotion=None,
    overhead=None,
    shot_id=None,
):
    shot = {
        "storyboardId": shot_id or f"sb-{scene_no}-{char_count}",
        "sceneNo": scene_no,
        "lines": make_dialogue(char_count),
    }
    if duration is not None:
        shot["durationSec"] = duration
    if emotion is not None:
        shot["emotion"] = emotion
    if overhead is not None:
        shot["nonspeechOverheadSec"] = overhead
    return shot


def make_budget(scene_no, budget_sec, basis=None):
    entry = {"sceneNo": scene_no, "budgetSec": budget_sec}
    if basis is not None:
        entry["basis"] = basis
    return entry


class ReviewChapter001DurationChainTest(unittest.TestCase):
    def test_reuses_lint_module_truth_no_third_mirror(self) -> None:
        # 约束②:语速/开销数值零新立——resolve_rate/resolve_overhead_sec/
        # dialogue_chars/缺有效时长判定必须逐名复用 lint 模块本体(is 同一函数对象),
        # 不在本文件做第三处镜像。
        import apps.build.chapter_video.lint_chapter001_dialogue_capacity as lint_module
        import apps.build.chapter_video.review_chapter001_duration_chain as review_module

        self.assertIs(review_module.resolve_rate, lint_module.resolve_rate)
        self.assertIs(review_module.resolve_overhead_sec, lint_module.resolve_overhead_sec)
        self.assertIs(review_module.dialogue_chars, lint_module.dialogue_chars)
        self.assertIs(review_module.is_valid_duration, lint_module.is_valid_duration)
        self.assertIs(
            review_module.DEFAULT_NONSPEECH_OVERHEAD_SEC,
            lint_module.DEFAULT_NONSPEECH_OVERHEAD_SEC,
        )

    def test_shot_forward_mirrors_compute_duration_sec(self) -> None:
        # 第③级正推折算=ceil(字数/语速)+开销(storyboard-table.ts:78-81 的 python 镜像,
        # 数值全部经 lint 模块复用):平3 12字→ceil(4)+1=5.0;13字→ceil(4.33)+1=6.0;
        # 悲2 8字→5.0;怒4 36字→10.0;开销覆写 2.5→ceil(4)+2.5=6.5;空台词→None。
        self.assertEqual(shot_forward_sec(make_shot(1, 12)), 5.0)
        self.assertEqual(shot_forward_sec(make_shot(1, 13)), 6.0)
        self.assertEqual(shot_forward_sec(make_shot(1, 8, emotion="低语")), 5.0)
        self.assertEqual(shot_forward_sec(make_shot(1, 36, emotion="愤怒")), 10.0)
        self.assertEqual(shot_forward_sec(make_shot(1, 12, overhead=2.5)), 6.5)
        self.assertIsNone(shot_forward_sec(make_shot(1, 0, duration=6)))

    def test_scene_four_tuple_tolerance_max_of_five_or_ten_percent(self) -> None:
        # 容差=两者取大(5 秒或 10%×预算值),偏差取绝对值双向判(提案一 :26):
        # 预算100→容差10:偏7容内、偏11超限;预算30→容差5(5>3):偏4容内、偏6超限;
        # 预算40:偏-4容内、偏-6.5超限(成稿短于预算同样要人裁)。
        self.assertEqual(TOLERANCE_ABS_SEC, 5.0)
        self.assertEqual(TOLERANCE_RATIO, 0.10)

        within = scene_four_tuple(100, 107)
        self.assertEqual(within["toleranceSec"], 10.0)
        self.assertEqual(within["deviationSec"], 7.0)
        self.assertEqual(within["verdict"], "withinTolerance")

        over = scene_four_tuple(100, 111)
        self.assertEqual(over["deviationSec"], 11.0)
        self.assertEqual(over["verdict"], "overLimit")

        small_budget_within = scene_four_tuple(30, 34)
        self.assertEqual(small_budget_within["toleranceSec"], 5.0)
        self.assertEqual(small_budget_within["verdict"], "withinTolerance")

        small_budget_over = scene_four_tuple(30, 36)
        self.assertEqual(small_budget_over["verdict"], "overLimit")

        self.assertEqual(scene_four_tuple(40, 36)["verdict"], "withinTolerance")
        negative_over = scene_four_tuple(40, 33.5)
        self.assertEqual(negative_over["deviationSec"], -6.5)
        self.assertEqual(negative_over["verdict"], "overLimit")

    def test_missing_or_invalid_budget_degrades_without_guessing(self) -> None:
        # 预算缺失/非法:四元组降级登记(verdict=missingBudget/invalidBudget,
        # 容差与偏差留 None 待人补),工具不猜预算值、不代填容差。
        missing = scene_four_tuple(None, 10.0)
        self.assertEqual(missing["verdict"], "missingBudget")
        self.assertIsNone(missing["toleranceSec"])
        self.assertIsNone(missing["deviationSec"])

        for bad_budget in (-3, "40", True, None):
            if bad_budget is None:
                continue
            invalid = scene_four_tuple(bad_budget, 10.0)
            self.assertEqual(invalid["verdict"], "invalidBudget")
            self.assertIsNone(invalid["toleranceSec"])

    def test_over_limit_scene_gets_three_choice_decision_slot(self) -> None:
        # 验收口径:超限场有人工三选一的决定记录。工具只登记记录位与选项,
        # decision 恒为 None(只登记不代决);容差内场不给决定位。
        shots = [
            make_shot(1, 36, emotion="愤怒", shot_id="sb-a1"),
            make_shot(1, 36, emotion="愤怒", shot_id="sb-a2"),
            make_shot(1, 36, emotion="愤怒", shot_id="sb-a3"),
            make_shot(1, 36, emotion="愤怒", shot_id="sb-a4"),
            make_shot(1, 13, overhead=1.5, shot_id="sb-a5"),
        ]
        budgets = [make_budget(1, 40)]
        report = review_duration_chain(shots, budgets)
        scene = report["scenes"][0]
        self.assertEqual(scene["reviewSec"], 46.5)
        self.assertEqual(scene["deviationSec"], 6.5)
        self.assertEqual(scene["verdict"], "overLimit")
        self.assertIsNone(scene["decision"])
        self.assertEqual(scene["decisionOptions"], ["保留内容并延长", "授权精简", "调整场次预算"])
        self.assertEqual(DECISION_OPTIONS, ["保留内容并延长", "授权精简", "调整场次预算"])

        # 容差内对照:复核值 5.0,预算 8 → 偏差 -3 ≤ 容差 5 → withinTolerance。
        within_report = review_duration_chain(
            [make_shot(1, 12, shot_id="sb-b1")], [make_budget(1, 8)]
        )
        within_scene = within_report["scenes"][0]
        self.assertEqual(within_scene["verdict"], "withinTolerance")
        self.assertNotIn("decision", within_scene)

    def test_scene_review_sums_shot_forwards_with_breakdown(self) -> None:
        # 第②级成稿复核值=Σ镜正推值(数字可向下拆、向上溯源到 lint 镜像真源);
        # 空台词镜不计入复核值、记 skipped。
        shots = [
            make_shot(1, 12, shot_id="sb-c1"),
            make_shot(1, 8, emotion="低语", shot_id="sb-c2"),
            make_shot(1, 0, duration=6, shot_id="sb-c3"),
        ]
        report = review_duration_chain(shots, [make_budget(1, 12)])
        scene = report["scenes"][0]
        self.assertEqual(scene["reviewSec"], 10.0)
        self.assertEqual(scene["deviationSec"], -2.0)
        self.assertEqual(scene["verdict"], "withinTolerance")
        self.assertEqual(scene["budgetSec"], 12)
        self.assertEqual(scene["shotCount"], 3)
        self.assertEqual(scene["skippedShots"], 1)
        self.assertEqual(
            scene["shotForwardBreakdown"],
            [
                {"storyboardId": "sb-c1", "forwardSec": 5.0},
                {"storyboardId": "sb-c2", "forwardSec": 5.0},
            ],
        )
        self.assertEqual(
            [item["storyboardId"] for item in report["skippedShots"]], ["sb-c3"]
        )

    def test_shot_level_check_fits_under_forward_and_missing_duration(self) -> None:
        # 第③级逐镜核对:duration≥正推值=fits;低于正推值=underForward 违例;
        # 缺时长有台词=missingDuration 违例(话术复用 lint 模块),但其正推值
        # 仍计入场级复核(复核只依赖台词与语速,不依赖名义时长)。
        shots = [
            make_shot(1, 12, duration=4, shot_id="sb-d1"),
            make_shot(1, 12, duration=7, shot_id="sb-d2"),
            make_shot(1, 12, shot_id="sb-d3"),
        ]
        report = review_duration_chain(shots, [make_budget(1, 40)])
        self.assertEqual(report["scenes"][0]["reviewSec"], 15.0)

        verdicts = {shot["storyboardId"]: shot for shot in report["shots"]}
        self.assertEqual(verdicts["sb-d1"]["verdict"], "underForward")
        self.assertEqual(verdicts["sb-d1"]["forwardSec"], 5.0)
        self.assertEqual(verdicts["sb-d1"]["durationSec"], 4.0)
        self.assertEqual(verdicts["sb-d1"]["deltaSec"], -1.0)
        self.assertEqual(verdicts["sb-d2"]["verdict"], "fits")
        self.assertEqual(verdicts["sb-d2"]["deltaSec"], 2.0)
        self.assertEqual(verdicts["sb-d3"]["verdict"], "missingDuration")
        self.assertEqual(verdicts["sb-d3"]["forwardSec"], 5.0)
        self.assertIsNone(verdicts["sb-d3"]["deltaSec"])

        kinds = {violation["storyboardId"]: violation["kind"] for violation in report["violations"]}
        self.assertEqual(
            kinds,
            {"sb-d1": "underForward", "sb-d3": "missingDuration"},
        )
        self.assertIn(MISSING_DURATION_REASON, verdicts["sb-d3"].get("reason", ""))

    def test_missing_budget_and_orphan_budget_flagged(self) -> None:
        # 链路断口双向登记:成稿有场无预算→missingBudget;预算有场无成稿→
        # budgetWithoutScript;预算值非法→invalidBudget。均亮红不猜测。
        shots = [
            make_shot(1, 12, duration=5, shot_id="sb-e1"),
            make_shot(2, 12, duration=5, shot_id="sb-e2"),
        ]
        # 场1:复核值 5.0,预算 8 → 偏差 -3 ≤ 容差 5 → withinTolerance。
        budgets = [make_budget(1, 8), make_budget(2, -3), make_budget(9, 50)]
        report = review_duration_chain(shots, budgets)
        scenes = {scene["sceneNo"]: scene for scene in report["scenes"]}
        self.assertEqual(scenes[1]["verdict"], "withinTolerance")
        self.assertEqual(scenes[2]["verdict"], "invalidBudget")
        self.assertEqual(report["budgetWithoutScript"], [9])

    def test_advisory_only_never_mutates_inputs_or_decides(self) -> None:
        # 约束①/提案一铁律:报告 advisory、零改写输入;严禁自动加快语速消化
        # 超限——模块不存在任何 setter/fix/speed 类入口(禁止路径不可达)。
        import apps.build.chapter_video.review_chapter001_duration_chain as module

        # 复核值 10.0(怒4 36字),预算 4 → 偏差 6 > 容差 5 → 超限场带决定位。
        shots = [make_shot(1, 36, emotion="愤怒", duration=4, shot_id="sb-f1")]
        budgets = [make_budget(1, 4)]
        shots_snapshot = copy.deepcopy(shots)
        budgets_snapshot = copy.deepcopy(budgets)
        report = review_duration_chain(shots, budgets)
        self.assertEqual(shots, shots_snapshot)
        self.assertEqual(budgets, budgets_snapshot)
        self.assertTrue(report["advisory"])
        self.assertIsNone(report["scenes"][0]["decision"])

        forbidden_prefixes = (
            "set_",
            "fix_",
            "repair_",
            "apply_",
            "double_",
            "extend_",
            "shorten_",
            "speed_",
            "rate_",
            "mutate_",
        )
        forbidden = [
            name
            for name, value in vars(module).items()
            if callable(value) and name.startswith(forbidden_prefixes)
        ]
        self.assertEqual(forbidden, [])

    def test_source_of_truth_declares_every_level(self) -> None:
        # 验收口径:任何一级的数字能向上追溯到它的真源声明——报告内嵌
        # sourceOfTruth 块,逐级(场预算/成稿复核/镜级正推/语速/开销/容差/第④级)非空。
        report = review_duration_chain(
            [make_shot(1, 12, duration=5, shot_id="sb-g1")], [make_budget(1, 8)]
        )
        truth = report["sourceOfTruth"]
        for key in (
            "sceneBudget",
            "sceneReview",
            "shotForward",
            "rate",
            "nonspeechOverhead",
            "tolerance",
            "level4RealWriteback",
        ):
            self.assertIsInstance(truth[key], str)
            self.assertTrue(truth[key].strip())
        self.assertIn("h3DurationUs", truth["level4RealWriteback"])
        self.assertIn("lint_chapter001_dialogue_capacity", truth["shotForward"])

    def test_adapt_workflow_shots_maps_canonical_shape(self) -> None:
        # 成稿剧本解析先例(build_chapter001_workflow.py:2541-2556 七元组投影,
        # 台词=元组 index 3 同 :2503-2508 source_dialogue_units):text→lines、
        # duration→durationSec、sceneNo 保留;无情绪字段→平3缺省;非字符串台词
        # 按空台词处理(dialogue_chars 语义)。
        canonical = [
            {
                "sceneNo": 1,
                "scene": "灵矿河滩",
                "desc": "晨雾矿道",
                "speaker": "旁白",
                "text": "河雾漫过矿道",
                "sound": "风声",
                "assets": ["灵矿"],
                "duration": 6,
                "characters": [],
            },
            {
                "sceneNo": 2,
                "scene": "悦来客栈",
                "desc": "柜前",
                "speaker": "掌柜",
                "text": None,
                "sound": "算盘声",
                "assets": ["悦来客栈"],
                "duration": 5,
                "characters": [],
            },
        ]
        adapted = adapt_workflow_shots(canonical)
        self.assertEqual(adapted[0]["storyboardId"], "chapter-001-shot-1")
        self.assertEqual(adapted[0]["lines"], "河雾漫过矿道")
        self.assertEqual(adapted[0]["durationSec"], 6)
        self.assertEqual(adapted[0]["sceneNo"], 1)
        self.assertNotIn("emotion", adapted[0])
        self.assertEqual(shot_forward_sec(adapted[0]), 3.0)
        self.assertEqual(adapted[1]["storyboardId"], "chapter-001-shot-2")
        self.assertEqual(adapted[1]["lines"], "")
        self.assertIsNone(shot_forward_sec(adapted[1]))

    def test_main_cli_exit_codes_and_both_json_shapes(self) -> None:
        # main():预算为 {scenes:[...]}、成稿为 {shots:[...]}/裸数组两形态;
        # 干净链 exit 0,超限或违例 exit 1,坏 JSON exit 2;stdout 输出 JSON 报告,
        # 场级四元组键齐、预算估算依据(basis)原样回显。
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            budget_path = root / "budget.json"
            budget_path.write_text(
                json.dumps(
                    {
                        "scenes": [
                            make_budget(1, 8, basis={"actionLoad": "高", "dialogueDensity": "中", "pauses": "少"})
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            script_path = root / "script.json"
            script_path.write_text(
                json.dumps({"shots": [make_shot(1, 12, duration=5, shot_id="sb-cli-1")]}, ensure_ascii=False),
                encoding="utf-8",
            )

            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = main([str(budget_path), str(script_path)])
            self.assertEqual(exit_code, 0)
            clean_report = json.loads(stdout.getvalue())
            scene = clean_report["scenes"][0]
            for key in ("budgetSec", "reviewSec", "deviationSec", "verdict"):
                self.assertIn(key, scene)
            self.assertEqual(scene["basis"], {"actionLoad": "高", "dialogueDensity": "中", "pauses": "少"})
            self.assertEqual(clean_report["shots"][0]["forwardSec"], 5.0)
            self.assertEqual(clean_report["shots"][0]["deltaSec"], 0.0)

            bare_script_path = root / "script-bare.json"
            bare_script_path.write_text(
                json.dumps([make_shot(1, 12, duration=5, shot_id="sb-cli-2")], ensure_ascii=False),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = main([str(budget_path), str(bare_script_path)])
            self.assertEqual(exit_code, 0)

            dirty_budget_path = root / "dirty-budget.json"
            dirty_budget_path.write_text(
                json.dumps([make_budget(1, 4)], ensure_ascii=False), encoding="utf-8"
            )
            dirty_script_path = root / "dirty-script.json"
            dirty_script_path.write_text(
                json.dumps(
                    {"shots": [make_shot(1, 36, duration=4, emotion="愤怒", shot_id="sb-cli-3")]},
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = main([str(dirty_budget_path), str(dirty_script_path)])
            self.assertEqual(exit_code, 1)
            dirty_report = json.loads(stdout.getvalue())
            self.assertEqual(dirty_report["scenes"][0]["verdict"], "overLimit")
            self.assertIsNone(dirty_report["scenes"][0]["decision"])
            self.assertEqual(dirty_report["violations"][0]["kind"], "underForward")

            bad_path = root / "bad.json"
            bad_path.write_text("{not json", encoding="utf-8")
            stderr = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(stderr):
                exit_code = main([str(bad_path), str(script_path)])
            self.assertEqual(exit_code, 2)

    def test_shot_without_scene_no_cannot_be_grouped(self) -> None:
        # 缺场次号无法归场:记违例、不进任何场的四元组(不猜场)。
        shot = make_shot(1, 12, duration=5, shot_id="sb-h1")
        del shot["sceneNo"]
        report = review_duration_chain([shot], [make_budget(1, 8)])
        self.assertEqual(report["scenes"], [])
        self.assertEqual(report["violations"][0]["kind"], "missingSceneNo")
        self.assertEqual(report["budgetWithoutScript"], [1])


if __name__ == "__main__":
    unittest.main()
