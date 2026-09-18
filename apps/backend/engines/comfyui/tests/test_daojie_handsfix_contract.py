#!/usr/bin/env python3
# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫修手工作流契约测试(Trellis 09-17-daojie-k2-hands-pose R3)。

MY-K2_道劫修手.json = 坏手图→FASHN自动手部掩码∪手涂→外扩→锁区重绘
(道劫底座+修手指令)→合成回填(掩码外=原图像素)。本测试钉死:
结构骨架/底座与负向逐字/锁区与合成链路/关键默认参数/脏词禁用。
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/3_改图/MY-K2_道劫修手.json"
PKG = REPO / "docs/prompts/道劫_新提示词包_0917.md"

DIRTY_WORDS = ("宣纸", "工笔线描", "工笔白描", "写意泼墨", "xuan")


def _load() -> dict:
    return json.loads(WF.read_text(encoding="utf-8"))


def _md_fence(section: str) -> str:
    """取提示词包指定节(如「一、」「四、」)首个代码围栏全文。"""
    text = PKG.read_text(encoding="utf-8")
    m = re.search(rf"^## {section}.*?^```text\n(.*?)^```", text, re.M | re.S)
    assert m, f"提示词包未找到节 {section}"
    return m.group(1).strip()


class TestStructure(unittest.TestCase):
    def setUp(self):
        self.wf = _load()
        self.nodes = {n["id"]: n for n in self.wf["nodes"]}
        self.links = {l[0]: l for l in self.wf["links"]}

    def test_node_inventory(self):
        expect = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 23, 25}
        self.assertEqual(set(self.nodes), expect)
        self.assertEqual(
            self.nodes[2]["type"], "FashnHumanParserMask", "自动手部掩码件必须在场"
        )
        self.assertEqual(self.nodes[8]["type"], "SetLatentNoiseMask", "锁区件必须在场")
        self.assertEqual(self.nodes[23]["type"], "ImageCompositeMasked", "零误伤合成件必须在场")
        self.assertNotIn("MyStylesLibrary", {n["type"] for n in self.wf["nodes"]})

    def test_link_ids_unique(self):
        ids = [l[0] for l in self.wf["links"]]
        self.assertEqual(len(ids), len(set(ids)), "link id 不得重复")


class TestPrompts(unittest.TestCase):
    def setUp(self):
        self.wf = _load()
        self.nodes = {n["id"]: n for n in self.wf["nodes"]}

    def test_base_verbatim(self):
        base = _md_fence("一、")
        got = self.nodes[12]["widgets_values"][0]
        self.assertEqual(got, base, "[12] 道劫底座必须与提示词包§一逐字一致")

    def test_negative_baseline_extended(self):
        baseline = _md_fence("四、")
        got = self.nodes[16]["widgets_values"][0]
        self.assertTrue(got.startswith(baseline), "[16] 负向必须以§四基线开头")
        for word in ("手指粘连", "融化的手"):
            self.assertIn(word, got, f"[16] 负向须含手部强化词 {word}")

    def test_instruction_meaningful(self):
        ins = self.nodes[13]["widgets_values"][0]
        self.assertTrue(ins, "[13] 修手指令不得为空")
        for word in ("墨线", "指节", "指缝"):
            self.assertIn(word, ins, f"[13] 修手指令须含 {word}")

    def test_positive_dirty_words_absent(self):
        for nid in (12, 13):
            text = self.nodes[nid]["widgets_values"][0]
            for w in DIRTY_WORDS:
                self.assertNotIn(w, text, f"[{nid}] 正向文本不得含脏词 {w}")


class TestTopology(unittest.TestCase):
    def setUp(self):
        self.wf = _load()
        self.nodes = {n["id"]: n for n in self.wf["nodes"]}
        self.edges = {(l[3], l[4]): (l[1], l[2]) for l in self.wf["links"]}

    def edge(self, to_node, to_slot):
        return self.edges.get((to_node, to_slot))

    def test_mask_chain(self):
        self.assertEqual(self.edge(2, 0), (1, 0), "FASHN 吃原图")
        self.assertEqual(self.edge(3, 0), (2, 0), "并集 dest=自动手部掩码")
        self.assertEqual(self.edge(3, 1), (1, 1), "并集 source=手涂 MASK")
        self.assertEqual(self.edge(4, 0), (3, 0), "外扩吃并集")
        self.assertEqual(self.edge(8, 1), (4, 0), "锁区掩码=外扩后掩码")
        self.assertEqual(self.edge(23, 5), (4, 0), "合成掩码=同一外扩掩码")

    def test_latent_and_compose_chain(self):
        self.assertEqual(self.edge(5, 0), (1, 0), "定标吃原图")
        self.assertEqual(self.edge(6, 0), (5, 0), "编码吃定标图")
        self.assertEqual(self.edge(8, 0), (6, 0), "锁区 latent=原图 latent")
        self.assertEqual(self.edge(18, 3), (8, 0), "采样 latent=锁区 latent")
        self.assertEqual(self.edge(20, 0), (18, 0), "解码吃采样")
        self.assertEqual(self.edge(23, 0), (5, 0), "合成 dest=原图(掩码外=原图像素)")
        self.assertEqual(self.edge(23, 1), (20, 0), "合成 source=重绘图")
        self.assertEqual(self.edge(21, 0), (23, 0), "保存=合成结果")

    def test_prompt_chain(self):
        self.assertEqual(self.edge(14, 0), (12, 0), "装配 a=底座")
        self.assertEqual(self.edge(14, 1), (13, 0), "装配 b=修手指令")
        self.assertEqual(self.edge(15, 1), (14, 0), "正向编码吃装配结果")
        self.assertEqual(self.edge(17, 1), (16, 0), "负向编码吃负向基线")
        self.assertEqual(self.edge(18, 0), (10, 0), "采样 model=蒸馏后模型")
        self.assertEqual(self.edge(10, 0), (9, 0), "蒸馏吃 DiT")


class TestDefaults(unittest.TestCase):
    def setUp(self):
        self.wf = _load()
        self.nodes = {n["id"]: n for n in self.wf["nodes"]}

    def named(self, nid):
        return self.nodes[nid].get("widgets_values_named") or {}

    def test_key_defaults(self):
        self.assertEqual(self.named(2)["label"], "hands")
        self.assertEqual(self.named(3)["operation"], "add")
        self.assertEqual(self.named(4)["expand"], 16)
        self.assertEqual(self.named(18)["steps"], 4)
        self.assertEqual(self.named(18)["cfg"], 1.0)
        self.assertEqual(self.named(18)["denoise"], 0.65)
        self.assertEqual(self.named(21)["filename_prefix"], "K2道劫修手_")

    def test_named_positional_identity(self):
        for n in self.wf["nodes"]:
            if "widgets_values_named" not in n:
                continue
            named = n["widgets_values_named"]
            positional = n.get("widgets_values") or []
            keys = list(named.keys())
            self.assertEqual(positional[: len(keys)], [named[k] for k in keys],
                             f"节点 {n['id']} named 与 positional 必须前缀恒等")


if __name__ == "__main__":
    unittest.main()
