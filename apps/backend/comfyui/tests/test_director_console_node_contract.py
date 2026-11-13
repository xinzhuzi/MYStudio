# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台节点契约测试(11-13-director-console-remake 阶段1,design §3)。

被测对象 = my_nodes/nodes/my_director_console.py 的 MyDirectorConsole
(节点壳):注册面/显示名「导演台」/四输入口/timeline_data 单通道 widget/
配方常量焊死表钉值/execute 骨架空转占位帧。

常量真源=纯净化母本 59 节点(三采-单镜.json),与
test_director_console_contract.py §5-5/§5-7 钉值同源(PRD R1.7 锁死档:
改钉值=偏离产线验证档,须用户令)。零引擎依赖(引擎库懒加载纪律,
mock torch 验占位帧契约;真 torch 在场时另跑实张量形状)。
"""
from __future__ import annotations

import sys
import types

import pytest

from comfyui import my_nodes as my_nodes_pkg
from comfyui.my_nodes.nodes import my_director_console as node_mod


# ── 注册面与显示名 ────────────────────────────────────────────────────
def test_registered_and_display_name():
    assert my_nodes_pkg.NODE_CLASS_MAPPINGS["MyDirectorConsole"] \
        is node_mod.MyDirectorConsole
    assert my_nodes_pkg.NODE_DISPLAY_NAME_MAPPINGS["MyDirectorConsole"] == "导演台"
    assert node_mod.MyDirectorConsole.CATEGORY == "漫影"
    assert node_mod.MyDirectorConsole.FUNCTION == "execute"
    assert node_mod.MyDirectorConsole.RETURN_TYPES == ("IMAGE",)


# ── 四输入口全外置(对标 AIMixer director.py:51-70 零模型硬绑)────────
def test_four_model_inputs():
    required = node_mod.MyDirectorConsole.INPUT_TYPES()["required"]
    assert required["model"] == ("MODEL",)
    assert required["video_vae"] == ("VAE",)
    assert required["audio_vae"] == ("VAE",)
    assert required["clip"] == ("CLIP",)


# ── timeline_data 单通道 widget 在册(禁自造第二 widget 通道)────────
def test_timeline_data_widget_channel():
    required = node_mod.MyDirectorConsole.INPUT_TYPES()["required"]
    assert required["timeline_data"][0] == "STRING"
    assert required["timeline_data"][1]["multiline"] is True
    assert required["timeline_data"][1]["default"] == ""
    # 单通道铁律:除四连接口外,STRING widget 只 timeline_data 一个
    string_widgets = sorted(
        k for k, v in required.items()
        if k not in ("model", "video_vae", "audio_vae", "clip") and v[0] == "STRING"
    )
    assert string_widgets == ["timeline_data"], f"STRING 通道越界: {string_widgets}"
    assert node_mod.MyDirectorConsole.INPUT_TYPES()["hidden"] == {"unique_id": "UNIQUE_ID"}


# ── 配方常量焊死表钉值(母本 §5-5/§5-7 同源;PRD R1.7)────────────────
def test_recipe_model_pins():
    r = node_mod.DIRECTOR_RECIPE
    assert r["unet"] == \
        "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors"
    assert r["clip"] == "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
    assert r["video_vae"] == "minimax_h3_video_vae_int8_convrot.safetensors"
    assert r["audio_vae"] == "minimax_h3_audio_vae_fp32.safetensors"
    assert r["recavsr_transformer"] == "transformer_int8_convrot.safetensors"


def test_recipe_lora_pins():
    r = node_mod.DIRECTOR_RECIPE
    assert r["lora_i2v"] == ("pika_turbo_8step_fl2va.safetensors", 1.0)
    assert r["lora_r2v"] == ("pika_h3_flex_ref2va_comfy_bf16.safetensors", 1.0)
    assert r["lora_second_pass"] == ("taomate_h3_3step.safetensors", 0.7)


def test_recipe_sampling_pins():
    r = node_mod.DIRECTOR_RECIPE
    assert r["attention_backend"] == "comfy kitchen attention"
    assert r["sol_attn"] == {"backend": "sol-attn", "tau": 1.3}
    assert r["sigma_shift_first_pass"] == (6, 3)
    assert r["sigma_shift_second_pass"] == (12, 3)
    assert r["sampler_first_pass"] == "lcm"  # Euler→片尾乱码红线
    assert r["first_pass_steps"] == 8
    assert (r["second_pass_scheduler"], r["second_pass_steps"],
            r["second_pass_denoise"]) == ("simple", 3, 0.2)
    assert r["first_pass_resolution"] == (960, 544)
    assert r["second_pass_resolution"] == (1440, 832)


# ── parse_timeline 兜底与阶段勾选归一(PRD R1.5)──────────────────────
def test_parse_timeline_defaults_and_stages():
    empty = node_mod.parse_timeline("")
    assert empty["stages"] == {"yicai": False, "ercai": False, "sancai": False}
    assert empty["segments"] == []
    assert empty["version"] == node_mod.TIMELINE_VERSION == 1
    # 坏 JSON / 非对象 → 同兜底
    assert node_mod.parse_timeline("{oops")["segments"] == []
    assert node_mod.parse_timeline("[1,2]")["segments"] == []
    # 阶段勾选归一:布尔透传,非布尔忽略回默认,缺键补默认
    got = node_mod.parse_timeline(
        '{"stages": {"yicai": true, "ercai": "yes"}, "chapter": "chapter-b007"}')
    assert got["stages"] == {"yicai": True, "ercai": False, "sancai": False}
    assert got["chapter"] == "chapter-b007"


# ── execute 骨架空转:1×1 占位帧(懒加载 torch 契约,mock 无引擎依赖)──
def test_execute_skeleton_returns_1x1_placeholder(monkeypatch):
    calls: list = []

    def fake_zeros(shape):
        calls.append(tuple(shape))
        return ("TENSOR", tuple(shape))

    fake_torch = types.SimpleNamespace(zeros=fake_zeros)
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    out = node_mod.MyDirectorConsole().execute(
        model=object(), video_vae=object(), audio_vae=object(), clip=object(),
        timeline_data='{"stages": {"yicai": true}}')
    assert calls == [(1, 64, 112, 3)], f"占位帧应 torch.zeros((1,64,112,3)),实 {calls}"
    assert out == (("TENSOR", (1, 64, 112, 3)),)


def test_execute_placeholder_real_torch():
    """真 torch 在场时的实张量形状核验(缺席环境自动跳过)。"""
    torch = pytest.importorskip("torch")  # noqa: F841
    out = node_mod.MyDirectorConsole().execute(
        model=None, video_vae=None, audio_vae=None, clip=None, timeline_data="")
    frame = out[0]
    assert tuple(frame.shape) == (1, 64, 112, 3)
    assert float(frame.abs().sum()) == 0.0
