from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

from apps.build.chapter_video.takeover_chapter001_finished_script import (
    DEFAULT_ROUND1_REPORT_PATH,
    DEFAULT_ROUND2_REPORT_PATH,
    MATERIAL_ITEMS,
    analyze_script,
    main,
)


def write(path: Path, content: str) -> Path:
    path.write_text(content, encoding="utf-8")
    return path


JSON_ROWS = [
    {"sceneNo": 1, "scene": "灵矿河滩", "speaker": "旁白", "text": "雾锁河滩。", "assets": ["赤练蛇皮鞭"], "duration": 6},
    {"sceneNo": 1, "scene": "灵矿河滩", "speaker": "独孤剑尘", "text": "这矿迟早要出事。", "assets": [], "duration": 5},
    {"sceneNo": 2, "scene": "悦来客栈", "speaker": "掌柜", "text": "客官打尖还是住店?", "assets": ["绿锈铜钱"], "duration": 5},
]

TUPLE_ROWS = [
    ["灵矿河滩", "晨雾矿道", "旁白", "雾锁河滩。", "河雾低涌", ["赤练蛇皮鞭"], 6],
    ["悦来客栈", "柜前", "掌柜", "客官打尖还是住店?", "算盘声", ["绿锈铜钱"], 5],
]

TEXT_SCRIPT = "\n".join([
    "1-1 灵矿河滩 晨",
    "独孤剑尘:这矿迟早要出事。",
    "旁白:雾锁河滩,监工的鞭梢破开晨雾。",
    "1-2 悦来客栈",
    "掌柜:客官,打尖还是住店?",
])


class TakeoverChapter001FinishedScriptTest(unittest.TestCase):
    def test_material_items_match_proposal_six(self) -> None:
        # 提案四 :122 尚缺生产资料清单六项(工单同名列举一致;工单「七项」计数与
        # 两处一致的六项名单不符,按名单落六项,不硬造第七项)。
        self.assertEqual(
            [item["key"] for item in MATERIAL_ITEMS],
            [
                "characterStateSheet",
                "sceneProductionSheet",
                "durationEstimate",
                "assetRequirements",
                "continuityBasis",
                "shotList",
            ],
        )
        self.assertEqual(
            [item["label"] for item in MATERIAL_ITEMS],
            ["角色状态表", "场次制片表", "时长初估", "资产需求", "连续性依据", "镜头清单"],
        )

    def test_duration_estimate_item_aligns_with_a2_tool(self) -> None:
        # 约束④:时长初估与 A2 工具口径对齐——容差数值经 import 复用(同对象),
        # 条目说明互引 A2 文件与字段名,不另立数值。
        import apps.build.chapter_video.review_chapter001_duration_chain as review_module
        import apps.build.chapter_video.takeover_chapter001_finished_script as takeover_module

        self.assertIs(takeover_module.TOLERANCE_ABS_SEC, review_module.TOLERANCE_ABS_SEC)
        self.assertIs(takeover_module.TOLERANCE_RATIO, review_module.TOLERANCE_RATIO)
        note = next(item["note"] for item in MATERIAL_ITEMS if item["key"] == "durationEstimate")
        self.assertIn("review_chapter001_duration_chain", note)
        for field in ("budgetSec", "reviewSec", "deviationSec", "verdict"):
            self.assertIn(field, note)

    def test_round1_json_rows_report_structure(self) -> None:
        # Round1=只产接管检查报告,不生成任何生产物:读取范围/识别情况/完整性疑点/
        # 已明确角色场景道具/逐场缺项清单六项全缺(裸剧本默认)。
        result = analyze_script(JSON_ROWS, format="json")
        self.assertEqual(result["recognition"]["scenes"], 2)
        self.assertEqual(result["recognition"]["dialogueUnits"], 3)
        self.assertEqual(result["identified"]["characters"], ["掌柜", "旁白", "独孤剑尘"])
        self.assertEqual(result["identified"]["props"], ["绿锈铜钱", "赤练蛇皮鞭"])
        self.assertEqual(result["identified"]["scenes"], ["灵矿河滩", "悦来客栈"])
        missing = result["missingProductionMaterials"]
        self.assertEqual([entry["sceneNo"] for entry in missing], [1, 2])
        for entry in missing:
            self.assertEqual(
                [item["key"] for item in entry["missingItems"] if item["status"] == "missing"],
                [item["key"] for item in MATERIAL_ITEMS],
            )
        self.assertTrue(result["noProductionArtifacts"])

    def test_round1_tuple_rows_follow_source_dialogue_units_precedent(self) -> None:
        # 解析先例=source_dialogue_units(build_chapter001_workflow.py:2503-2508,
        # 台词=元组 index 3);七元组行同样识别场次/角色/道具。
        result = analyze_script(TUPLE_ROWS, format="json")
        self.assertEqual(result["recognition"]["scenes"], 2)
        self.assertEqual(result["recognition"]["dialogueUnits"], 2)
        self.assertEqual(result["identified"]["props"], ["绿锈铜钱", "赤练蛇皮鞭"])
        self.assertEqual([entry["scene"] for entry in result["missingProductionMaterials"]], ["灵矿河滩", "悦来客栈"])

    def test_round1_text_format_recognition_and_concerns(self) -> None:
        result = analyze_script(TEXT_SCRIPT.splitlines(), format="text")
        self.assertEqual(result["recognition"]["scenes"], 2)
        self.assertEqual(result["recognition"]["dialogueUnits"], 3)
        self.assertEqual(result["identified"]["characters"], ["掌柜", "旁白", "独孤剑尘"])
        self.assertEqual(result["integrityConcerns"], [])

        headerless = analyze_script(["独孤剑尘:走了。"], format="text")
        concerns = [concern["kind"] for concern in headerless["integrityConcerns"]]
        self.assertIn("noSceneHeaders", concerns)
        self.assertEqual(headerless["recognition"]["dialogueUnits"], 1)

        dialogue_free = analyze_script(["1-1 灵矿河滩 晨", "雾锁河滩,鞭梢破风。"], format="text")
        concerns = [concern["kind"] for concern in dialogue_free["integrityConcerns"]]
        self.assertIn("noDialogue", concerns)

    def test_materials_input_marks_items_present(self) -> None:
        materials = {"global": ["durationEstimate"], "scenes": {"1": ["characterStateSheet"]}}
        result = analyze_script(JSON_ROWS, format="json", materials=materials)
        missing = {entry["sceneNo"]: entry for entry in result["missingProductionMaterials"]}
        self.assertEqual(
            [item["key"] for item in missing[1]["missingItems"] if item["status"] == "missing"],
            ["sceneProductionSheet", "assetRequirements", "continuityBasis", "shotList"],
        )
        self.assertEqual(
            [item["key"] for item in missing[2]["missingItems"] if item["status"] == "missing"],
            ["characterStateSheet", "sceneProductionSheet", "assetRequirements", "continuityBasis", "shotList"],
        )

    def test_round2_routes_shortest_path(self) -> None:
        # 最短路由:六项齐→可直接进分镜;缺资产侧(角色状态表/场次制片表/资产需求)
        # →先补资产(资产先于表演节拍);资产侧齐缺表演侧(时长初估/连续性依据/
        # 镜头清单)→先补表演节拍;缺什么列什么,不强迫重跑前序阶段。
        all_present = {"global": [item["key"] for item in MATERIAL_ITEMS]}
        complete = analyze_script(JSON_ROWS, format="json", materials=all_present)
        self.assertTrue(complete["perSceneRoutes"][0]["missingKeys"] == [])

        asset_missing = analyze_script(
            JSON_ROWS, format="json", materials={"global": ["sceneProductionSheet", "durationEstimate", "continuityBasis", "shotList"]}
        )
        routes = {route["sceneNo"]: route for route in asset_missing["perSceneRoutes"]}
        self.assertEqual(routes[1]["route"], "先补资产")
        self.assertEqual(routes[1]["missingKeys"], ["characterStateSheet", "assetRequirements"])
        self.assertIn("资产", routes[1]["routeReason"])

        performance_missing = analyze_script(
            JSON_ROWS, format="json", materials={"global": ["characterStateSheet", "sceneProductionSheet", "assetRequirements", "continuityBasis"]}
        )
        routes = {route["sceneNo"]: route for route in performance_missing["perSceneRoutes"]}
        self.assertEqual(routes[2]["route"], "先补表演节拍")
        self.assertEqual(routes[2]["missingKeys"], ["durationEstimate", "shotList"])

        both_missing = analyze_script(JSON_ROWS, format="json", materials={"global": ["sceneProductionSheet", "durationEstimate"]})
        routes = {route["sceneNo"]: route for route in both_missing["perSceneRoutes"]}
        self.assertEqual(routes[1]["route"], "先补资产")
        self.assertIn("assetRequirements", routes[1]["missingKeys"])
        self.assertIn("shotList", routes[1]["missingKeys"])

    def test_round1_cli_locks_script_bytes_sha256(self) -> None:
        # 铁律一:外部成稿剧本=锁定事实源只读——接管全程逐字节可比(前后字节一致),
        # 报告内嵌 sha256 与 lockVerification 前后相等;Round2 同样不改剧本。
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = write(root / "script.json", json.dumps(JSON_ROWS, ensure_ascii=False))
            raw_before = script.read_bytes()
            out = root / "round1.json"
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                self.assertEqual(main([str(script), "--output", str(out)]), 0)
            self.assertEqual(script.read_bytes(), raw_before)
            report = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(report["round"], 1)
            self.assertEqual(report["script"]["sha256"], hashlib.sha256(raw_before).hexdigest())
            self.assertTrue(report["script"]["lockVerification"]["equal"])
            self.assertEqual(report["script"]["lockVerification"]["sha256Before"], report["script"]["lockVerification"]["sha256After"])
            self.assertTrue(report["noProductionArtifacts"])
            self.assertEqual(json.loads(stdout.getvalue())["round"], 1)

            out2 = root / "round2.json"
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                self.assertEqual(main([str(script), "--confirm", "--round1", str(out), "--output", str(out2)]), 0)
            self.assertEqual(script.read_bytes(), raw_before)
            round2 = json.loads(out2.read_text(encoding="utf-8"))
            self.assertEqual(round2["round"], 2)
            self.assertTrue(round2["confirm"]["contentUnchanged"])
            self.assertTrue(round2["script"]["lockVerification"]["equal"])
            self.assertEqual(len(round2["perSceneRoutes"]), 2)
            self.assertTrue(round2["noProductionArtifacts"])

    def test_round2_refuses_when_script_changed(self) -> None:
        # 铁律二:任何剧情改动须另走剧本修订另存版本——Round2 校验 Round1 记录的
        # sha256,剧本变了拒绝接管(exit 1,不产 Round2 报告),提示重走 Round1。
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = write(root / "script.json", json.dumps(JSON_ROWS, ensure_ascii=False))
            round1_out = root / "round1.json"
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main([str(script), "--output", str(round1_out)]), 0)
            write(script, json.dumps(JSON_ROWS + [
                {"sceneNo": 3, "scene": "新增场", "speaker": "路人", "text": "剧情被改了。", "assets": [], "duration": 4},
            ], ensure_ascii=False))
            round2_out = root / "round2.json"
            stderr = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(stderr):
                self.assertEqual(main([str(script), "--confirm", "--round1", str(round1_out), "--output", str(round2_out)]), 1)
            self.assertFalse(round2_out.exists())
            self.assertIn("重走 Round1", stderr.getvalue())

    def test_round2_requires_prior_round1_report(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = write(root / "script.json", json.dumps(JSON_ROWS, ensure_ascii=False))
            stderr = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(stderr):
                self.assertEqual(
                    main([str(script), "--confirm", "--round1", str(root / "none.json"), "--output", str(root / "r2.json")]),
                    2,
                )
            self.assertIn("Round1", stderr.getvalue())

    def test_round1_succeeds_on_read_only_script_file(self) -> None:
        # 剧本只读铁律的行为证明:把剧本文件 chmod 0444,接管照常完成——
        # 全程对剧本零写入;模块亦无改写类入口(剧情改动只能走剧本修订另存版本)。
        import apps.build.chapter_video.takeover_chapter001_finished_script as module

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = write(root / "script.json", json.dumps(JSON_ROWS, ensure_ascii=False))
            os.chmod(script, 0o444)
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(main([str(script), "--output", str(root / "r1.json")]), 0)
            finally:
                os.chmod(script, 0o644)

            forbidden_prefixes = (
                "set_",
                "fix_",
                "repair_",
                "rewrite_",
                "edit_",
                "modify_",
                "mutate_",
                "revise_",
                "write_script",
                "save_script",
            )
            forbidden = [
                name
                for name, value in vars(module).items()
                if callable(value) and name.startswith(forbidden_prefixes)
            ]
            self.assertEqual(forbidden, [])

    def test_cli_exit_codes_for_bad_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main([str(root / "missing.json"), "--output", str(root / "o.json")]), 2)
            garbage = write(root / "garbage.json", "{not json")
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main([str(garbage), "--output", str(root / "o.json")]), 2)
            empty = write(root / "empty.txt", "")
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main([str(empty), "--output", str(root / "o.json")]), 2)
            bad_materials = write(root / "m.json", "{bad")
            script = write(root / "s.json", json.dumps(JSON_ROWS, ensure_ascii=False))
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main([str(script), "--materials", str(bad_materials), "--output", str(root / "o.json")]), 2)

    def test_default_report_paths_follow_automation_landing_precedent(self) -> None:
        # 约束③:报告落盘=apps/output/automation/(兄弟先例)。
        self.assertIn("apps/output/automation/", str(DEFAULT_ROUND1_REPORT_PATH))
        self.assertIn("apps/output/automation/", str(DEFAULT_ROUND2_REPORT_PATH))
        self.assertIn("round1", str(DEFAULT_ROUND1_REPORT_PATH))
        self.assertIn("round2", str(DEFAULT_ROUND2_REPORT_PATH))


if __name__ == "__main__":
    unittest.main()
