# -*- coding: utf-8 -*-
"""道劫人物姿势工作流契约测试(1108 持械根治役)。

锚:装配层接线/姿势链(FisherQwenFreePose 人偶 pose_json+立绘 image2)/VNCCS LoRA/
25步CFG1 euler 母本配方/验证配方烙印(双手空剑段)/节点计数。
"""
from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
WF = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/4_姿势编辑/自研件-qi21-道劫-人物姿势.json"


def _load():
    d = json.loads(WF.read_text(encoding="utf-8"))
    return d, {n["id"]: n for n in d["nodes"]}


class TestPoseWorkflow:
    def setup_method(self):
        self.d, self.by = _load()

    def _src(self, nid, iname):
        lid = {i["name"]: i.get("link") for i in self.by[nid]["inputs"]}.get(iname)
        assert lid, f"{nid} 缺 {iname}"
        return next(l for l in self.d["links"] if l[0] == lid)

    def test_counts(self):
        assert len(self.d["nodes"]) == 17 and len(self.d["links"]) == 22
        assert self.d["last_node_id"] == 34

    def test_assembly_layer(self):
        assert self.by[1]["type"] == "MyQi21DaojieBase" and self.by[1]["widgets_values"] == ["人物海报"]
        assert self.by[4]["type"] == "MyQi21PromptAssembly"
        assert self._src(4, "BASE")[1:3] == [1, 0]
        assert self._src(4, "主体句")[1] == 2
        assert self._src(5, "正向提示词")[1:3] == [4, 0]

    def test_pose_chain(self):
        # Studio 人偶图→FreePose reference_image;声明句+装配文拼接→extra_prompt
        assert self.by[10]["type"] == "FisherPoseStudio"
        assert self._src(30, "reference_image")[1:3] == [10, 1]  # 人偶姿态图(槽1)
        assert self.by[11]["type"] == "Text Concatenate"
        assert self._src(11, "text_a")[1] == 12      # Fisher 灰人偶声明句
        assert self._src(11, "text_b")[1:3] == [4, 0]  # 装配全文
        assert self._src(30, "extra_prompt")[1] == 11
        assert self._src(30, "clip")[1] == 21 and self._src(30, "vae")[1] == 22
        assert self._src(30, "width")[1:3] == [1, 1]   # 画幅跟型库 W/H
        assert self._src(30, "height")[1:3] == [1, 2]

    def test_model_recipe(self):
        assert self.by[20]["widgets_values"][0] == "qwen_image_2.1_bf16.safetensors"
        assert self.by[21]["widgets_values"][0] == "qwen3vl_8b_bf16_heretic.safetensors"
        assert self.by[22]["widgets_values"][0] == "texture_fix_vae_for_qwen_image_2.1_bf16.safetensors"
        assert self.by[23]["widgets_values"] == ["VNCCS_QI2_PoseStudioV1.1.safetensors", 1.0]
        ks = self.by[31]["widgets_values"]
        assert ks[2:] == [25, 1.0, "euler", "simple", 1.0]  # 1010 母本配方
        assert self._src(31, "positive")[1:3] == [30, 0]
        assert self._src(31, "latent_image")[1:3] == [30, 2]

    def test_validated_recipe_baked(self):
        subj = self.by[2]["widgets_values"][0]
        for key in ("剑格护手正下方的鞘身上段", "剑柄与柄头完整露在手的上方", "始终挂定腰间",
                    "全身仅此一柄长剑"):
            assert key in subj, key
        assert "虚握在剑格护手正下方" in subj  # C11 终版:护手下方点名(带剑人偶参照下文字同向强化)
        pose = self.by[10]["widgets_values_named"]["extra_prompt"]
        assert "右手五指松拢" in pose and "腰侧" in pose

    def test_note_carries_usage(self):
        note = self.by[34]["widgets_values"][0]
        for key in ("五轮实弹验证配方", "无剑", "泄漏", "poseReferenceFile", "双剑分裂"):
            assert key in note, key

    def test_outputs(self):
        assert self._src(33, "images")[1] == 32
        assert self.by[33]["widgets_values"] == ["道劫-人物姿势/"]
