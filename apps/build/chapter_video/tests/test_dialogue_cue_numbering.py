"""A7a(P4 python 可达部分):台词分段编号 S{镜}-D{台词}{段} 生成+对账测试。

依据=docs/comfyui-kb/跨镜连续性规范.md §五(:121-137)+§七P4(:183-187):
- 编号格式 S{镜号}-D{台词序}{段序}(如 S07-D2a/S07-D2b);
- 拆段依据=标点/换气/语义转折——只落机检可判子集(句末标点+换气停顿符),
  语义转折不建模(人工层);
- 对账=同段编号两处(分镜台词 vs TTS 绑定 ttsSpokenText)取值一致、缺段/重段
  可检出;TTS 绑定只读不改 store。
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from apps.build.chapter_video import dialogue_cue_numbering as cue


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_PATH = REPOSITORY_ROOT / "apps/build/chapter_video/dialogue_cue_numbering.py"


class DialogueCueNumberingFormatTest(unittest.TestCase):
    def test_within_shot_units_get_dense_d_numbers_and_segment_a(self):
        """镜内多台词单元(真实 store <br> 约定)→ D 序密集编号,未拆段=段序 a。"""
        text = "我知道。<br>赵四：灰衫客，明早别走太快。<br>镇里不留来路不明的人。"
        cues = cue.build_shot_cues(7, text)
        self.assertEqual(
            [item["cueId"] for item in cues],
            ["S07-D1a", "S07-D2a", "S07-D3a"],
        )
        self.assertEqual(cues[0]["text"], "我知道。")
        self.assertEqual(cues[1]["text"], "赵四：灰衫客，明早别走太快。")

    def test_spec_example_sentences_pin_the_format(self):
        """§五示例三句(各镜单段)编号锚定:S07-D1a/S08-D1a/S09-D1a。"""
        self.assertEqual(
            cue.build_shot_cues(7, "你可知这十年，我把那封信读了几遍？"),
            [{"cueId": "S07-D1a", "shot": 7, "unit": 1, "segment": "a",
              "text": "你可知这十年，我把那封信读了几遍？"}],
        )
        self.assertEqual(
            cue.build_shot_cues(9, "如今信还在，人却回不来了。")[0]["cueId"],
            "S09-D1a",
        )

    def test_overlong_unit_splits_at_sentence_ends(self):
        """超长台词按句末标点拆段→a/b/c;未超长的多句单元不拆(§五只对超长拆段)。"""
        overlong = "你可知这十年，我把那封信读了几遍？每一遍，都当你在跟我说话。"
        cues = cue.build_shot_cues(7, overlong, max_segment_chars=20)
        self.assertEqual(
            [item["cueId"] for item in cues], ["S07-D1a", "S07-D1b"]
        )
        self.assertTrue(cues[0]["text"].endswith("？"))
        self.assertTrue(cues[1]["text"].endswith("。"))

        short_multi_sentence = "我知道。你也知道。"
        cues = cue.build_shot_cues(3, short_multi_sentence, max_segment_chars=20)
        self.assertEqual([item["cueId"] for item in cues], ["S03-D1a"])
        self.assertEqual(cues[0]["text"], short_multi_sentence)

    def test_still_overlong_sentence_splits_at_breath_marks(self):
        """单句仍超长→按换气/停顿符(，、；：)续拆;无停顿符的长句不硬切(防断词)。"""
        breathy = "客栈与码头相隔遥远，铁链仍能穿过破窗抵达床边，落进梦里。"
        cues = cue.build_shot_cues(34, breathy, max_segment_chars=12)
        self.assertEqual(
            [item["cueId"] for item in cues], ["S34-D1a", "S34-D1b", "S34-D1c"]
        )
        self.assertTrue(cues[0]["text"].endswith("，"))
        self.assertTrue(cues[1]["text"].endswith("，"))

        no_breath = "一串没有任何停顿符号的超长连续台词文字必须保持原样不硬切"
        cues = cue.build_shot_cues(2, no_breath, max_segment_chars=10)
        self.assertEqual([item["cueId"] for item in cues], ["S02-D1a"])
        self.assertEqual(cues[0]["text"], no_breath)

    def test_cue_id_regex_contract(self):
        """编号即契约(字幕 cue 侧共用):S 两位以上镜号-D 正整数台词序-小写段序。"""
        import re

        pattern = re.compile(cue.CUE_ID_PATTERN)
        for valid in ("S07-D2a", "S01-D1a", "S107-D12z"):
            self.assertRegex(valid, pattern)
        for invalid in ("S7-D1a", "S07-D1", "S07-d1a", "07-D1a", "S07-D1a1"):
            self.assertIsNone(pattern.fullmatch(invalid), invalid)

    def test_episode_mode_reuses_source_dialogue_units_precedent(self):
        """编号生成复用 build_chapter001_workflow.source_dialogue_units(只读 import)。"""
        cues = cue.episode_dialogue_cues()
        self.assertTrue(cues)
        self.assertEqual(cues[0]["cueId"], "S01-D1a")
        self.assertTrue(all(item["text"] for item in cues))
        indexes = {item["shot"] for item in cues}
        self.assertIn(1, indexes)


class DialogueCueReconcileTest(unittest.TestCase):
    def make_shot(
        self,
        index: int,
        line: str,
        tts: str | None,
        lines: str | None = None,
    ) -> dict:
        shot = {
            "id": f"sb-chapter-001-{index:03d}",
            "episodeId": "chapter-001",
            "index": index,
            "line": line,
            "lines": lines if lines is not None else f"独孤剑尘：{line}",
        }
        if tts is not None:
            shot["ttsSpokenText"] = tts
        return shot

    def test_matching_sides_reconcile_clean(self):
        line = "归元……<br>赵四：灰衫客，明早别走太快。"
        shot = self.make_shot(32, line, line)
        report = cue.reconcile_store({"state": {"storyboards": [shot]}})
        self.assertTrue(report["ok"])
        self.assertEqual(report["totals"]["issues"], 0)
        self.assertEqual(report["shots"][0]["storyCueCount"], 2)
        self.assertEqual(report["shots"][0]["ttsCueCount"], 2)

    def test_lines_fallback_strips_primary_speaker_prefix(self):
        """分镜侧读 line(无前缀)优先;缺 line 退回 lines 时剥主说话人前缀再对账。"""
        line = "明年矿供，还能翻倍。<br>独孤没有再计算离镇路线。"
        tts = "明年矿供，还能翻倍。<br>独孤没有再计算离镇路线。"
        shot = self.make_shot(35, line, tts, lines="宗门弟子：明年矿供，还能翻倍。")
        story = cue.story_cues_from_shot(shot)
        self.assertEqual(story[0]["text"], "明年矿供，还能翻倍。")

        # 缺 line 字段 → 退回 lines,剥主前缀后与 tts 侧对齐(镜内换人前缀
        # 按 store 真实形态两侧同现,对账归一后一致)
        fallback_shot = {
            "id": "sb-chapter-001-035",
            "episodeId": "chapter-001",
            "index": 35,
            "lines": "宗门弟子：明年矿供，还能翻倍。<br>旁白：独孤没有再计算离镇路线。",
            "ttsSpokenText": "明年矿供，还能翻倍。<br>旁白：独孤没有再计算离镇路线。",
        }
        story = cue.story_cues_from_shot(fallback_shot)
        self.assertEqual(
            [item["text"] for item in story],
            ["明年矿供，还能翻倍。", "旁白：独孤没有再计算离镇路线。"],
        )
        report = cue.reconcile_store({"state": {"storyboards": [fallback_shot]}})
        self.assertEqual(report["shots"][0]["issues"], [])

    def test_missing_segment_detected_when_tts_lags_behind(self):
        """缺段可检出:分镜加了一句、TTS 绑定仍旧 → missing-in-tts 带编号。"""
        story_line = "我知道。<br>明早别走太快。<br>镇里不留来路不明的人。"
        tts_line = "我知道。<br>明早别走太快。"
        shot = self.make_shot(33, story_line, tts_line)
        report = cue.reconcile_store({"state": {"storyboards": [shot]}})
        self.assertFalse(report["ok"])
        issues = report["shots"][0]["issues"]
        self.assertEqual(
            [(i["type"], i["cueId"]) for i in issues],
            [("missing-in-tts", "S33-D3a")],
        )

    def test_extra_tts_segment_and_absent_binding_detected(self):
        story_line = "我知道。"
        tts_line = "我知道。<br>明早别走太快。"
        shot = self.make_shot(33, story_line, tts_line)
        issues = cue.reconcile_store({"state": {"storyboards": [shot]}})["shots"][0]["issues"]
        self.assertEqual(
            [(i["type"], i["cueId"]) for i in issues],
            [("missing-in-dialogue", "S33-D2a")],
        )

        no_binding = self.make_shot(40, "客栈与码头相隔遥远。", None)
        report = cue.reconcile_store({"state": {"storyboards": [no_binding]}})
        self.assertFalse(report["ok"])
        self.assertEqual(
            [(i["type"], i["cueId"]) for i in report["shots"][0]["issues"]],
            [("missing-in-tts", "S40-D1a")],
        )

    def test_value_mismatch_detected_for_same_cue_id(self):
        """同段编号两处取值不一致可检出(按 ttsSpokenText 链同规归一后比较)。"""
        shot = self.make_shot(36, "铁链仍能穿过破窗抵达床边。", "铁链仍能穿过破窗,抵达床边!")
        issues = cue.reconcile_store({"state": {"storyboards": [shot]}})["shots"][0]["issues"]
        self.assertEqual(
            [(i["type"], i["cueId"]) for i in issues],
            [("value-mismatch", "S36-D1a")],
        )

    def test_reconcile_cues_flags_duplicates_and_non_contiguous_runs(self):
        """重段/跳段在纯函数层可检(字幕 cue 侧共用同一对账器)。"""
        dialogue = [
            {"cueId": "S07-D1a", "text": "甲"},
            {"cueId": "S07-D1a", "text": "甲"},
            {"cueId": "S07-D1c", "text": "丙"},
        ]
        tts = [
            {"cueId": "S07-D1a", "text": "甲"},
            {"cueId": "S07-D1c", "text": "丙"},
        ]
        issues = cue.reconcile_cues(dialogue, tts)
        kinds = {(i["type"], i.get("side"), i["cueId"]) for i in issues}
        self.assertIn(("duplicate", "dialogue", "S07-D1a"), kinds)
        self.assertIn(("non-contiguous", "dialogue", "S07-D1c"), kinds)

        jump = [
            {"cueId": "S07-D1a", "text": "甲"},
            {"cueId": "S07-D3a", "text": "丙"},
        ], [{"cueId": "S07-D1a", "text": "甲"}, {"cueId": "S07-D3a", "text": "丙"}]
        issues = cue.reconcile_cues(*jump)
        flagged = {(i["type"], i.get("side"), i["cueId"]) for i in issues}
        self.assertIn(("non-contiguous", "dialogue", "S07-D3a"), flagged)
        self.assertIn(("non-contiguous", "tts", "S07-D3a"), flagged)

    def test_cross_shot_anchor_ids_are_valid_contract(self):
        """§五跨切形态(同一 D 的 b/c 段落在后镜)作为契约可在对账器中流通。"""
        dialogue = [
            {"cueId": "S07-D1a", "text": "你可知这十年，我把那封信读了几遍？"},
            {"cueId": "S07-D1b", "text": "每一遍，都当你在跟我说话。"},
            {"cueId": "S07-D1c", "text": "如今信还在，人却回不回来了。"},
        ]
        self.assertEqual(cue.reconcile_cues(dialogue, list(dialogue)), [])

    def test_store_is_never_mutated_by_reconciliation(self):
        shot = self.make_shot(32, "归元……<br>赵四：灰衫客，明早别走太快。", "归元……")
        store = {"state": {"storyboards": [shot]}}
        with tempfile.TemporaryDirectory() as temp:
            store_path = Path(temp) / "store.json"
            payload = json.dumps(store, ensure_ascii=False).encode("utf-8")
            store_path.write_bytes(payload)

            cue.reconcile_store_path(store_path)

            self.assertEqual(store_path.read_bytes(), payload)


class DialogueCueCliTest(unittest.TestCase):
    def test_cli_store_mode_emits_report(self):
        shot = {
            "id": "sb-chapter-001-033",
            "episodeId": "chapter-001",
            "index": 33,
            "line": "我知道。<br>明早别走太快。",
            "lines": "独孤剑尘：我知道。<br>赵四：明早别走太快。",
            "ttsSpokenText": "我知道。",
        }
        with tempfile.TemporaryDirectory() as temp:
            store_path = Path(temp) / "store.json"
            store_path.write_text(
                json.dumps({"state": {"storyboards": [shot]}}, ensure_ascii=False),
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    sys.executable, str(SCRIPT_PATH),
                    "--store", str(store_path),
                ],
                cwd=REPOSITORY_ROOT,
                env={"PYTHONPATH": str(REPOSITORY_ROOT), "PATH": "/usr/bin:/bin"},
                check=True,
                capture_output=True,
                text=True,
            )
            report = json.loads(completed.stdout)
            self.assertFalse(report["ok"])
            self.assertEqual(report["totals"]["issues"], 1)
            self.assertEqual(
                report["shots"][0]["issues"][0]["cueId"], "S33-D2a"
            )

    def test_cli_episode_mode_emits_cues(self):
        completed = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--episode"],
            cwd=REPOSITORY_ROOT,
            env={"PYTHONPATH": str(REPOSITORY_ROOT), "PATH": "/usr/bin:/bin"},
            check=True,
            capture_output=True,
            text=True,
        )
        cues = json.loads(completed.stdout)
        self.assertTrue(cues)
        self.assertEqual(cues[0]["cueId"], "S01-D1a")


if __name__ == "__main__":
    unittest.main()
