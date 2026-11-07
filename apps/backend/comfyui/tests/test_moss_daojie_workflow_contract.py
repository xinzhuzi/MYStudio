# -*- coding: utf-8 -*-
"""MOSS 道劫产线契约测试(1108 道劫范式×MOSS-Image 役)。

覆盖四物:
  1. moss_bases.json(派生数据真源):14 型与 qi21 同名同序/6 透明型白底句/
     人物海报挂载服从句/底座逐字同源/steps_hint·lora_recipe 断言
  2. moss-道劫-t2i.json(画布件):加载器锚/双臂采样锚/SLG 锚/透明腿链路锚/
     双开关默认/SeedVR2 尾档锚/装配连线契约
  3. moss-道劫-t2i-api.json(直投模板):默认臂锚+注入锚
  4. MyMossDaojieBase(节点):六出形状/型行为/注册面

纪律:数据与工作流均=moss_daojie_build_1108.py 生成物(幂等字节),
本测试同时钉「文件≈生成器重导出」防手改漂移。
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

from comfyui.my_nodes import NODE_CLASS_MAPPINGS
from comfyui.my_nodes.nodes.my_moss_daojie_base import MyMossDaojieBase, bases_list

BACKEND = Path(__file__).resolve().parents[2]  # apps/backend(tests→comfyui→backend)
REPO = BACKEND.parents[1]
DATA = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json"
WF = REPO / "apps/backend/comfyui/workflows/1_图片/MOSS图像"
WHITE = "背景为均匀纯白底色"
MOUNT = "保持挂定原位"


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


# ── 1. moss_bases.json ─────────────────────────────────────────────
class TestMossBases:
    def test_14_type_names_match_qi21(self):
        qi = [t["zh"] for t in _load(DATA / "qi21_bases.json")["types"]]
        mo = [t["zh"] for t in _load(DATA / "moss_bases.json")["types"]]
        assert mo == qi and len(mo) == 14

    def test_six_transparent_types_carry_white_bg(self):
        ts = _load(DATA / "moss_bases.json")["types"]
        got = [t["zh"] for t in ts if WHITE in t.get("positive_text", "")]
        assert got == ["道具", "人物多视图", "高清人脸", "表情差分", "人脸基准", "无衣物定妆"]
        for t in ts:
            if t.get("rgba_default"):
                assert WHITE in t["positive_text"]

    def test_poster_mount_sentence_and_no_bleed(self):
        ts = _load(DATA / "moss_bases.json")["types"]
        by = {t["zh"]: t for t in ts}
        assert MOUNT in by["人物海报"]["positive_text"]
        for zh, t in by.items():
            if zh != "人物海报":
                assert MOUNT not in t["positive_text"], zh

    def test_art_style_base_verbatim_from_qi21(self):
        qi = _load(DATA / "qi21_bases.json")["art_style_base"]
        mo = _load(DATA / "moss_bases.json")["art_style_base"]
        assert mo["positive_text"] == qi["positive_text"]
        assert mo["negative_text"] == qi["negative_text"]

    def test_steps_hint_and_lora_recipe(self):
        for t in _load(DATA / "moss_bases.json")["types"]:
            assert t["steps_hint"] == {"fast": 8, "quality": 50}, t["zh"]
            assert t["lora_recipe"] == [], t["zh"]

    def test_variant_marker_and_regenerable(self):
        raw = _load(DATA / "moss_bases.json")
        v = raw["moss_variant"]
        assert v["engine"] == "moss_image_sft_bf16"
        assert v["derived_from"] == "qi21_bases.json"
        # 生成物纪律:文件内容 == 生成器重导出(防手改漂移)
        spec = importlib.util.spec_from_file_location(
            "moss_daojie_build_1108",
            REPO / "apps/build/scripts/moss_daojie_build_1108.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        assert mod.build_moss_bases() == raw


# ── 2. 画布件 ──────────────────────────────────────────────────────
class TestCanvas:
    def setup_method(self):
        self.d = _load(WF / "moss-道劫-t2i.json")
        self.by = {n["id"]: n for n in self.d["nodes"]}

    def _links_into(self, nid, iname):
        ins = {i["name"]: i.get("link") for i in self.by[nid].get("inputs", [])}
        lid = ins.get(iname)
        assert lid, f"节点 {nid} 缺输入 {iname}"
        return next(l for l in self.d["links"] if l[0] == lid)

    def test_loaders(self):
        assert self.by[1]["type"] == "MyMossDaojieBase"
        assert self.by[1]["widgets_values"] == ["人物海报"]
        assert self.by[6]["widgets_values"][0] == "qwen3.5_9b_bf16.safetensors"
        assert self.by[6]["widgets_values"][1] == "moss_image"
        assert self.by[10]["widgets_values"][0] == "moss_image_sft_bf16.safetensors"
        assert self.by[20]["widgets_values"][0] == "flux2-vae.safetensors"

    def test_dual_arm_samplers_and_loras(self):
        a, b = self.by[13], self.by[16]
        # KSampler widgets: [seed, control, steps, cfg, sampler, scheduler, denoise]
        assert a["widgets_values"][2:] == [50, 3.5, "er_sde", "simple", 1.0]
        assert b["widgets_values"][2:] == [8, 1.0, "euler", "simple", 1.0]
        assert self.by[11]["widgets_values"] == ["KOOK-MOSS-SFT-观澜.safetensors", 1.0]
        assert self.by[14]["widgets_values"] == ["MOSS-SFT-DMD-8step-lodestones.safetensors", 1.0]
        # SLG:原生臂 end0.5 / DMD 臂 end0(DMD 禁高 CFG 同理禁深 SLG 尾)
        assert self.by[12]["widgets_values"] == ["", "22", 0.0, 0.5]
        assert self.by[15]["widgets_values"] == ["", "22", 0.0, 0.0]
        # 双臂共享同一 conditioning/latent/seed
        for nid in (13, 16):
            for slot in ("positive", "negative", "latent_image"):
                self._links_into(nid, slot)

    def test_switch_defaults(self):
        assert self.by[17]["widgets_values"] == [False]   # 用DMD8步加速=默认关
        assert self.by[33]["widgets_values"] == [False]   # SeedVR2 2K=默认旁路

    def test_transparent_keying_chain(self):
        # 型库透明值(1 出4)→26 switch;腿=21→22(ColorToMask)→23→24→25→26 on_true
        l = self._links_into(26, "switch")
        assert l[1] == 1 and l[2] == 4
        assert self.by[22]["widgets_values"] == [False, 255, 255, 255, 20, 1]
        assert self.by[23]["type"] == "GrowMaskWithBlur" and self.by[23]["widgets_values"][0] == -3
        assert self.by[24]["widgets_values"] == [0, True]  # 恒等旁路
        for nid, iname, src in ((22, "images", 21), (23, "mask", 22), (24, "mask", 23),
                                (25, "image", 21), (25, "alpha", 24)):
            assert self._links_into(nid, iname)[1] == src
        assert self._links_into(26, "on_true")[1] == 25
        assert self._links_into(26, "on_false")[1] == 21

    def test_assembly_wiring_and_preview(self):
        # 型库→装配:BASE(出0)/BASE负面(出3);主体句/锁层A全文原语;预览双接
        assert self.by[4]["type"] == "MyQi21PromptAssembly"
        assert self._links_into(4, "BASE")[1:3] == [1, 0]
        assert self._links_into(4, "BASE负面")[1:3] == [1, 3]
        assert self._links_into(4, "主体句")[1] == 2
        assert self._links_into(4, "锁层A全文")[1] == 3
        assert self._links_into(5, "正向提示词")[1:3] == [4, 0]
        assert self._links_into(5, "负向提示词")[1:3] == [4, 1]
        assert self._links_into(7, "text")[1:3] == [4, 0]
        assert self._links_into(8, "text")[1:3] == [4, 1]

    def test_canvas_size_from_type_library(self):
        assert self._links_into(9, "width")[1:3] == [1, 1]
        assert self._links_into(9, "height")[1:3] == [1, 2]

    def test_seedvr2_tail(self):
        assert self.by[30]["widgets_values"][0] == "seedvr2_7b_sharp_fp8_e4m3fn.safetensors"
        assert self.by[31]["widgets_values"][0] == "ema_vae_fp16.safetensors"
        up = self.by[32]
        assert up["widgets_values"][0:1] == [0] or up["widgets_values_named"]["seed"] == 0
        assert up["widgets_values_named"]["resolution"] == 2048
        assert self._links_into(34, "on_true")[1] == 32
        assert self._links_into(35, "images")[1] == 34

    def test_note_carries_usage(self):
        note = self.by[36]["widgets_values"][0]
        for key in ("moss_bases.json", "双臂", "白底转透明", "SeedVR2", "挂载动词服从弱"):
            assert key in note, key

    def test_counts(self):
        assert len(self.d["nodes"]) == 32 and len(self.d["links"]) == 44
        assert self.d["last_node_id"] == 36 and self.d["last_link_id"] == 44


# ── 3. API 直投模板 ────────────────────────────────────────────────
class TestApi:
    def setup_method(self):
        self.g = _load(WF / "moss-道劫-t2i-api.json")

    def test_default_arm_anchors(self):
        assert self.g["1"]["inputs"]["unet_name"] == "moss_image_sft_bf16.safetensors"
        assert self.g["2"]["inputs"]["lora_name"] == "KOOK-MOSS-SFT-观澜.safetensors"
        ks = self.g["8"]["inputs"]
        assert (ks["steps"], ks["cfg"], ks["sampler_name"], ks["scheduler"]) == (50, 3.5, "er_sde", "simple")
        slg = self.g["3"]["inputs"]
        assert (slg["single_layers"], slg["end_percent"]) == ("22", 0.5)
        assert self.g["4"]["inputs"]["type"] == "moss_image"

    def test_injection_slots_empty(self):
        assert self.g["5"]["inputs"]["text"] == ""
        assert self.g["6"]["inputs"]["text"] == ""


# ── 4. 节点 ────────────────────────────────────────────────────────
class TestNode:
    def test_registered(self):
        assert NODE_CLASS_MAPPINGS["MyMossDaojieBase"] is MyMossDaojieBase

    def test_outputs_shape(self):
        assert MyMossDaojieBase.RETURN_NAMES == (
            "BASE", "WIDTH", "HEIGHT", "负面词", "透明值", "型名")

    def test_type_behaviors(self):
        assert len(bases_list()) == 14
        n = MyMossDaojieBase()
        out = n.run("人物海报")
        assert MOUNT in out[0] and out[4] is False
        o = n.run("道具")
        assert o[4] is True and WHITE in o[0] and (o[1], o[2]) == (1024, 1024)
        assert n.run("人物多视图")[1:3] == (1824, 1024)
        assert n.run("美宣")[1:3] == (2048, 1152)
        assert n.run("自由")[0] == ""
        assert n.run("自由", True)[4] is True
        with pytest.raises(RuntimeError):
            n.run("不存在型")
