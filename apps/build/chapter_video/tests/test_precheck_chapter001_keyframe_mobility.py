from __future__ import annotations

import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path

from apps.build.chapter_video.precheck_chapter001_keyframe_mobility import (
    ACTION_CONSTRAINT_HINTS,
    DEFAULT_REPORT_PATH,
    DEPTH_HINTS,
    FRAGILE_HINTS,
    NATURAL_MOVABLE_HINTS,
    OCCLUSION_MENTION_HINTS,
    latest_storyboard_markdown,
    main,
    precheck_keyframe_mobility,
    rows_from_state,
)


def make_row(index=1, desc="", action="", sound="", assets=None, shot_semantics=None, scene_no=1):
    row = {
        "index": index,
        "sceneNo": scene_no,
        "desc": desc,
        "action": action,
        "sound": sound,
        "assets": list(assets or []),
    }
    if shot_semantics is not None:
        row["shotSemantics"] = shot_semantics
    return row


def semantics_with_one_person():
    return {
        "sceneViewpointId": "sv-1",
        "personFree": False,
        "visibleCharacters": [
            {
                "name": "独孤剑尘",
                "position": "画面中央",
                "orientation": "正面",
                "actionIn": "缓步走入",
                "actionOut": "驻足",
            }
        ],
        "visibleProps": [],
        "actionIn": "缓步走入",
        "actionOut": "驻足",
    }


class PrecheckChapter001KeyframeMobilityTest(unittest.TestCase):
    def test_word_lists_anchor_proposal_three(self) -> None:
        # 词表锚定提案三原文五例(发丝/衣摆/水面/烟火/旗幡)+贴边/截断判据+
        # 文字/边框/版式类;均为「自己会动」或构图约束的保守词表,advisory。
        for hint in ("发丝", "衣摆", "水面", "烟火", "旗幡"):
            self.assertIn(hint, NATURAL_MOVABLE_HINTS)
        for hint in ("贴边", "截断"):
            self.assertIn(hint, ACTION_CONSTRAINT_HINTS)
        for hint in ("文字", "边框", "版式"):
            self.assertIn(hint, FRAGILE_HINTS)
        self.assertIn("前景", DEPTH_HINTS)
        self.assertIn("遮挡", OCCLUSION_MENTION_HINTS)

    def test_natural_movable_dimension_hit_and_none(self) -> None:
        hit = precheck_keyframe_mobility([
            make_row(desc="河风掀起他的衣摆,发丝飞扬", shot_semantics=semantics_with_one_person()),
        ])["records"][0]
        self.assertEqual(hit["dimensions"]["naturalMovable"]["status"], "hit")
        self.assertIn("衣摆", hit["dimensions"]["naturalMovable"]["matched"])
        self.assertIn("发丝", hit["dimensions"]["naturalMovable"]["matched"])
        self.assertFalse(hit["dimensions"]["naturalMovable"]["needsHuman"])

        none = precheck_keyframe_mobility([make_row(desc="少年立于塾馆翻读残卷")])["records"][0]
        self.assertEqual(none["dimensions"]["naturalMovable"]["status"], "none")
        self.assertEqual(none["dimensions"]["naturalMovable"]["matched"], [])

    def test_depth_layers_hit_and_none_needs_human(self) -> None:
        hit = precheck_keyframe_mobility([
            make_row(desc="前景账台,背景门扉纵深排列"),
        ])["records"][0]
        depth = hit["dimensions"]["depthLayers"]
        self.assertEqual(depth["status"], "hit")
        self.assertFalse(depth["needsHuman"])

        none = precheck_keyframe_mobility([make_row(desc="两人对坐交谈")])["records"][0]
        depth = none["dimensions"]["depthLayers"]
        self.assertEqual(depth["status"], "none")
        self.assertTrue(depth["needsHuman"])

    def test_occlusion_always_needs_human_mentions_recorded(self) -> None:
        # 约束③:遮挡关系是语义维度,机检不动——恒标需人工;文本命中只登记证据不判优劣。
        with_mention = precheck_keyframe_mobility([
            make_row(desc="两人身形交叠,前景遮挡后半"),
        ])["records"][0]
        occlusion = with_mention["dimensions"]["occlusion"]
        self.assertTrue(occlusion["needsHuman"])
        self.assertIn("遮挡", occlusion["mentions"])
        self.assertIn("交叠", occlusion["mentions"])

        without = precheck_keyframe_mobility([make_row(desc="一人独坐灯下")])["records"][0]
        self.assertTrue(without["dimensions"]["occlusion"]["needsHuman"])

    def test_action_space_three_states(self) -> None:
        person_free = make_row(
            desc="空馆一景",
            shot_semantics={
                "sceneViewpointId": "sv-2",
                "personFree": True,
                "visibleCharacters": [],
                "visibleProps": [],
                "actionIn": "无",
                "actionOut": "无",
            },
        )
        not_applicable = precheck_keyframe_mobility([person_free])["records"][0]["dimensions"]["actionSpace"]
        self.assertEqual(not_applicable["status"], "notApplicable")
        self.assertFalse(not_applicable["needsHuman"])

        constrained = precheck_keyframe_mobility([
            make_row(desc="他半身贴边立于帧缘", shot_semantics=semantics_with_one_person()),
        ])["records"][0]["dimensions"]["actionSpace"]
        self.assertEqual(constrained["status"], "constrained")
        self.assertIn("半身", constrained["matched"])
        self.assertIn("贴边", constrained["matched"])

        unverifiable = precheck_keyframe_mobility([
            make_row(desc="他立于矿道中央", shot_semantics=semantics_with_one_person()),
        ])["records"][0]["dimensions"]["actionSpace"]
        self.assertEqual(unverifiable["status"], "needsHuman")
        self.assertTrue(unverifiable["needsHuman"])

    def test_fragile_elements_present_needs_lock_verification(self) -> None:
        present = precheck_keyframe_mobility([
            make_row(desc="镜头掠过水面,匾额题字悬于门楣", assets=["匾额"]),
        ])["records"][0]["dimensions"]["fragileElements"]
        self.assertEqual(present["status"], "present")
        self.assertIn("匾额", present["matched"])
        self.assertTrue(present["needsHuman"])
        self.assertIsNone(present["lockVerified"])

        clean = precheck_keyframe_mobility([make_row(desc="河滩乱石")])["records"][0]["dimensions"]["fragileElements"]
        self.assertEqual(clean["status"], "none")
        self.assertFalse(clean["needsHuman"])

    def test_verdict_movable_when_evidence_and_no_constraint(self) -> None:
        report = precheck_keyframe_mobility([
            make_row(desc="河雾低涌,他的衣摆被风掀起", sound="鞭梢破风", shot_semantics=semantics_with_one_person()),
        ])
        record = report["records"][0]
        self.assertEqual(record["verdict"], "movable")
        self.assertEqual(record["verdictLabel"], "可动")
        self.assertTrue(record["writtenReason"].strip())
        self.assertTrue(record["needsHumanReview"])
        self.assertIn("occlusion", record["humanReviewDimensions"])

    def test_verdict_micro_motion_only_via_fragile_and_via_constraint(self) -> None:
        fragile = precheck_keyframe_mobility([
            make_row(desc="水面波纹轻漾,匾额悬于门楣"),
        ])["records"][0]
        self.assertEqual(fragile["verdict"], "microMotionOnly")
        self.assertEqual(fragile["verdictLabel"], "仅微动")
        self.assertIn("脆弱元素", fragile["writtenReason"])

        constrained = precheck_keyframe_mobility([
            make_row(desc="他半身贴边立于帧缘,发丝未动", shot_semantics=semantics_with_one_person()),
        ])["records"][0]
        self.assertEqual(constrained["verdict"], "microMotionOnly")
        self.assertIn("动作空间", constrained["writtenReason"])

    def test_verdict_static_requires_written_reason_not_default(self) -> None:
        # 验收口径 python 可达部分:「不动」有书面理由而非默认值——书面理由必须
        # 引用词表零命中扫描证据并列出待人工复核维度;全部三态理由恒非空。
        report = precheck_keyframe_mobility([
            make_row(index=1, desc="少年立于塾馆翻读残卷"),
            make_row(index=2, desc="河雾低涌,他的衣摆被风掀起"),
        ])
        static_record = report["records"][0]
        self.assertEqual(static_record["verdict"], "static")
        self.assertEqual(static_record["verdictLabel"], "不动")
        reason = static_record["writtenReason"]
        self.assertTrue(reason.strip())
        self.assertIn("零命中", reason)
        self.assertIn("人工复核", reason)
        for record in report["records"]:
            self.assertTrue(record["writtenReason"].strip())

    def test_report_summary_counts_and_source_of_truth(self) -> None:
        report = precheck_keyframe_mobility([
            make_row(index=1, desc="河雾低涌,他的衣摆被风掀起"),
            make_row(index=2, desc="水面波纹,匾额悬于门楣"),
            make_row(index=3, desc="少年立于塾馆翻读残卷"),
        ])
        self.assertTrue(report["advisory"])
        self.assertEqual(report["shots"], 3)
        self.assertEqual(
            report["verdictCounts"],
            {"movable": 1, "microMotionOnly": 1, "static": 1},
        )
        truth = report["sourceOfTruth"]
        self.assertIn("PIPELINE_METHODS_ABSORPTION_ANALYSIS_2026-09-28.md", truth["proposal"])
        self.assertIn("不拦不删", truth["advisory"])
        self.assertIn("需人工", truth["occlusionRule"])

    def test_latest_storyboard_markdown_picks_latest_work(self) -> None:
        # 镜像 latest_storyboard_work 契约(build_chapter001_workflow.py:2567-2580):
        # 按 key=storyboardTable+episodeId+非空 data 过滤,updatedAt/createdAt/id 取最新。
        state = {
            "agentWorkData": [
                {"key": "scriptDraft", "episodeId": "chapter-001", "data": "x", "updatedAt": 9},
                {"key": "storyboardTable", "episodeId": "chapter-001", "data": "|旧表|", "updatedAt": 1},
                {
                    "key": "storyboardTable",
                    "episodeId": "chapter-001",
                    "data": "|新表|",
                    "updatedAt": 1,
                    "createdAt": 5,
                    "id": "work-2",
                },
            ]
        }
        self.assertEqual(latest_storyboard_markdown(state), "|新表|")
        self.assertIsNone(latest_storyboard_markdown({"agentWorkData": []}))
        self.assertIsNone(latest_storyboard_markdown({"agentWorkData": [
            {"key": "storyboardTable", "episodeId": "other", "data": "|他章|", "updatedAt": 9},
        ]}))

    def test_rows_from_state_uses_injected_parser(self) -> None:
        seen = {}

        def fake_parse(markdown, episode_id="chapter-001"):
            seen["markdown"] = markdown
            seen["episode_id"] = episode_id
            return [{"index": 1, "desc": "来自解析器"}]

        rows = rows_from_state(
            {"agentWorkData": [
                {"key": "storyboardTable", "episodeId": "chapter-001", "data": "|表体|", "updatedAt": 2},
            ]},
            parse_rows=fake_parse,
        )
        self.assertEqual(rows, [{"index": 1, "desc": "来自解析器"}])
        self.assertEqual(seen["markdown"], "|表体|")

        with self.assertRaises(RuntimeError):
            rows_from_state({"agentWorkData": []}, parse_rows=fake_parse)

    def test_main_rows_json_output_and_exit_codes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            clean_rows = root / "clean.json"
            clean_rows.write_text(
                json.dumps({"rows": [
                    make_row(index=1, desc="河雾低涌,他的衣摆被风掀起"),
                ]}, ensure_ascii=False),
                encoding="utf-8",
            )
            out = root / "report.json"
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = main(["--rows-json", str(clean_rows), "--output", str(out)])
            self.assertEqual(exit_code, 0)
            report = json.loads(stdout.getvalue())
            self.assertTrue(report["advisory"])
            self.assertEqual(report["verdictCounts"]["movable"], 1)
            self.assertTrue(out.exists())
            saved = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(saved["verdictCounts"], report["verdictCounts"])
            self.assertEqual(report["source"]["kind"], "rows-json")

            static_rows = root / "static.json"
            static_rows.write_text(
                json.dumps([make_row(index=1, desc="少年立于塾馆翻读残卷")], ensure_ascii=False),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = main(["--rows-json", str(static_rows), "--output", str(root / "r2.json")])
            self.assertEqual(exit_code, 1)
            self.assertEqual(json.loads(stdout.getvalue())["verdictCounts"]["static"], 1)

            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main([]), 2)
            missing = root / "missing.json"
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(["--rows-json", str(missing)]), 2)
            garbage = root / "garbage.json"
            garbage.write_text("{not json", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(["--rows-json", str(garbage)]), 2)

    def test_default_report_path_follows_automation_landing_precedent(self) -> None:
        # 落盘先例=generate_chapter001_continuity_sample.py:33(apps/output/automation/)。
        self.assertIn("apps/output/automation/", str(DEFAULT_REPORT_PATH))
        self.assertTrue(str(DEFAULT_REPORT_PATH).endswith(".json"))

    def test_advisory_only_never_mutates_inputs_or_rows(self) -> None:
        # 约束②:预检 advisory 不拦不删——零改写输入行,模块无任何改写类入口。
        import apps.build.chapter_video.precheck_chapter001_keyframe_mobility as module

        rows = [make_row(desc="河雾低涌,他的衣摆被风掀起")]
        snapshot = copy.deepcopy(rows)
        precheck_keyframe_mobility(rows)
        self.assertEqual(rows, snapshot)

        forbidden_prefixes = (
            "set_",
            "fix_",
            "repair_",
            "apply_",
            "delete_",
            "remove_",
            "block_",
            "speed_",
            "mutate_",
        )
        forbidden = [
            name
            for name, value in vars(module).items()
            if callable(value) and name.startswith(forbidden_prefixes)
        ]
        self.assertEqual(forbidden, [])


if __name__ == "__main__":
    unittest.main()
