# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""MyQi21FastEncode 契约测试(my21fast-1025 序2 v3 io 类形,哨兵范式,零引擎依赖)。

锁:v3 define_schema 全结构(node_id/display_name/category=漫影/description
写明 cfg=1 与负面不生效/inputs 序 [clip,prompt,negative_prompt,vae?,
resolution,images]/widgets 序=[prompt,negative_prompt,resolution] 与 TE_WV
(test_qwen21_workflow_contract.py:387-388)逐位同/autogrow template=
TemplateNames(image, names 16 槽 image_1..16, min 0)/outputs 三出
positive·negative·latent)/零参考臂(tokenize/encode 恰各 1 次、
prevent_empty_text=True、keep_vision=True、negative is positive、zeros 形状参
[1,64,h//16,w//16])/带参考臂(set_values(append=True) 带 reference_latents、
keep_vision=False、image_N 序号排序、None 槽跳过)/注册面(类名
MyQi21FastEncode 主裁C 终局+显示名)/文件头(含「同域重实现」不含「净室」)
与顶层导入纪律(torch/comfy 本体/node_helpers 禁;comfy_api.latest 放行=
v3 类定义期必需,官方 nodes_qwen.py 同款,sidecar 由 conftest 桩垫)。
数值路径由实弹兑底。
"""

from __future__ import annotations

import ast
import sys
import types
from pathlib import Path

from comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from comfyui.my_nodes.nodes.my_qi21_fast_encode import MyQi21FastEncode

MODULE_PATH = Path(sys.modules[MyQi21FastEncode.__module__].__file__)

OFFICIAL_TOOLTIP_FRAGMENTS = (  # 官方 nodes_qwen.py 原句片段,tooltip 不得照抄(主裁A)
    "Reference images are resized",
    "seen by the text encoder and spliced",
)

# 固定哨兵(模块级单例,identity 断言友好)
_ZEROS = {"latent": object()}
_COND_REF = object()


# ── v3 define_schema 全结构(承前定谳第2条官方同款形) ──────────
def _schema():
    return MyQi21FastEncode.define_schema()


def _input_by_id(input_id):
    return {i.id: i for i in _schema().inputs}[input_id]


def test_define_schema_identity_and_category():
    s = _schema()
    assert s.node_id == "MyQi21FastEncode"  # 主裁C 类名终局
    assert s.display_name == "Qwen Image 2.1 文本编码·漫影单遍"
    assert s.category == "漫影"  # test_my_nodes 注册面 CATEGORY 互锁同源
    # description 写明 cfg=1 语义与负面不生效(硬约束;DESCRIPTION 自 schema 派生)
    assert "cfg=1" in s.description and "负面" in s.description
    assert MyQi21FastEncode.CATEGORY == "漫影"
    assert MyQi21FastEncode.DESCRIPTION == s.description


def test_inputs_order_and_optionality():
    """inputs 序钉死:官方 TextEncodeQwenImage21 同序(vae 在 resolution 前);仅 vae 可选。"""
    ids = [i.id for i in _schema().inputs]
    assert ids == ["clip", "prompt", "negative_prompt", "vae", "resolution", "images"]
    optional = {i.id for i in _schema().inputs if i.optional}
    assert optional == {"vae"}
    # 型别牌:clip=CLIP 必选,vae=VAE 可选(官方同位)
    assert _input_by_id("clip").io_type == "CLIP"
    assert _input_by_id("vae").io_type == "VAE"
    tip = _input_by_id("vae").tooltip
    assert tip and not any(frag in tip for frag in OFFICIAL_TOOLTIP_FRAGMENTS)


def test_widget_inputs_match_te_wv():
    """widget 序=[prompt,negative_prompt,resolution],与 TE_WV(:387-388)逐位同。

    STRING 双槽 multiline+dynamic_prompts 逐位;resolution default/min/max/step
    逐位;tooltip 自写(主裁A)。"""
    widgets = [i for i in _schema().inputs if i.io_type in ("STRING", "INT", "FLOAT", "COMBO")]
    assert [w.id for w in widgets] == ["prompt", "negative_prompt", "resolution"]
    for key in ("prompt", "negative_prompt"):
        w = _input_by_id(key)
        assert w.io_type == "STRING"
        assert w.multiline is True
        assert w.dynamic_prompts is True
        assert w.tooltip and not any(frag in w.tooltip for frag in OFFICIAL_TOOLTIP_FRAGMENTS), key
    res = _input_by_id("resolution")
    assert res.io_type == "INT"
    assert (res.default, res.min, res.max, res.step) == (1024, 0, 4096, 32)
    assert res.tooltip and not any(frag in res.tooltip for frag in OFFICIAL_TOOLTIP_FRAGMENTS)


def test_images_autogrow_template():
    """images=Autogrow(TemplateNames(image, names 16 槽 image_1..16, min 0),官方
    nodes_qwen.py:125-133 同款形);tooltip 自写。"""
    images = _input_by_id("images")
    assert images.io_type == "COMFY_AUTOGROW_V3"
    template = images.template
    assert template.input.id == "image"
    assert template.input.io_type == "IMAGE"
    assert template.names == [f"image_{i}" for i in range(1, 17)]
    assert template.min == 0
    assert images.tooltip and not any(frag in images.tooltip for frag in OFFICIAL_TOOLTIP_FRAGMENTS)


def test_outputs_threefold():
    """三出=positive·negative·latent(官方同形;RETURN_* 自 schema 派生)。"""
    outputs = [(o.io_type, o.display_name) for o in _schema().outputs]
    assert outputs == [("CONDITIONING", "positive"), ("CONDITIONING", "negative"), ("LATENT", "latent")]
    assert MyQi21FastEncode.RETURN_TYPES == ("CONDITIONING", "CONDITIONING", "LATENT")
    assert MyQi21FastEncode.RETURN_NAMES == ("positive", "negative", "latent")


# ── 执行哨兵基建:引擎库全 stub(sys.modules 注入) ────────────
class _FakeImage:
    """万能切片哨兵:任意下标/切片返回自身;movedim 切换 NHWC/NCHW 双视图。

    官方双视图语义:native s=NHWC(末维=通道,alpha 支判 s.shape[-1]>3);
    samples=s.movedim(-1,1)=NCHW(shape[2]=H,shape[3]=W 驱动缩放取整)。
    本哨兵 shape 以 NHWC 钉;movedim 返回 NCHW 视图哨兵(同身份标记)。
    尺寸链(官方 :152-167):H,W 均 32 倍数 + resolution=0 → width=W,
    height=H 与 samples.shape[3],shape[2] 相等 → s=image[:1](不走
    common_upscale);通道=3 → 不走 alpha 合成支。
    """

    def __init__(self, name, shape, _moved=False):
        self.name = name
        self.shape = shape
        self._moved = _moved

    def __getitem__(self, _item):
        return self

    def movedim(self, _a, _b):
        if self._moved:
            return self  # 幂等:已 NCHW 视图
        n, h, w, c = self.shape
        return _FakeImage(self.name, (n, c, h, w), _moved=True)

    def __repr__(self):
        return f"<img:{self.name}{self.shape}{'@chw' if self._moved else ''}>"


class _StubClip:
    def __init__(self, cond_out):
        self.tokenize_calls = []
        self.encode_calls = []
        self._cond_out = cond_out

    def tokenize(self, text, **kwargs):
        self.tokenize_calls.append((text, kwargs))
        return object()  # tokens 哨兵(不被下游检查身份)

    def encode_from_tokens_scheduled(self, tokens):
        self.encode_calls.append(tokens)
        return self._cond_out


class _StubVae:
    def __init__(self):
        self.encode_calls = []  # [(输入, 输出哨兵)]

    def encode(self, s):
        out = object()
        self.encode_calls.append((s, out))
        return out


def _install_engine_stubs(monkeypatch):
    """注入 torch/comfy.model_management/comfy.utils/node_helpers 桩;返回记录器。

    torch.zeros 恒回模块级 _ZEROS;conditioning_set_values 恒回 _COND_REF。
    """
    record = {"zeros": [], "set_values": [], "common_upscale": []}

    torch_stub = types.ModuleType("torch")

    def _zeros(size, device=None):
        record["zeros"].append({"size": list(size), "device": device})
        return _ZEROS
    torch_stub.zeros = _zeros

    mm = types.ModuleType("comfy.model_management")
    mm.intermediate_device = lambda: "stub-device"
    utils = types.ModuleType("comfy.utils")

    def _common_upscale(*args, **kwargs):
        record["common_upscale"].append((args, kwargs))
        return args[0]
    utils.common_upscale = _common_upscale
    comfy_stub = types.ModuleType("comfy")
    comfy_stub.model_management = mm
    comfy_stub.utils = utils

    node_helpers = types.ModuleType("node_helpers")

    def _set_values(conditioning, values, append=False):
        record["set_values"].append(
            {"conditioning": conditioning, "values": values, "append": append})
        return _COND_REF
    node_helpers.conditioning_set_values = _set_values

    for name, mod in (("torch", torch_stub), ("comfy", comfy_stub),
                      ("comfy.model_management", mm), ("comfy.utils", utils),
                      ("node_helpers", node_helpers)):
        monkeypatch.setitem(sys.modules, name, mod)
    return record


def _run(**kwargs):
    """v3 形执行入口:classmethod 直调(引擎 EXECUTE_NORMALIZED 同路),解 NodeOutput。"""
    return MyQi21FastEncode.execute(**kwargs).result


# ── 零参考臂:单遍语义 ──────────────────────────────────────
def test_execute_zero_reference_single_pass(monkeypatch):
    record = _install_engine_stubs(monkeypatch)
    pos = object()
    clip = _StubClip(pos)

    positive, negative, latent = _run(
        clip=clip, prompt="一位女修士立于云海", negative_prompt="低质量",
        resolution=1024, images={}, vae=None)

    # tokenize/encode 恰各 1 次(官方第二遍负面编码不跑=唯一分叉)
    assert len(clip.tokenize_calls) == 1
    assert len(clip.encode_calls) == 1
    text, kwargs = clip.tokenize_calls[0]
    assert text == "一位女修士立于云海"
    assert kwargs == {"images": [], "keep_vision": True, "prevent_empty_text": True}
    # negative 直通 positive 同对象
    assert negative is positive is pos
    # reference_latents 不施加(set_values 零调用)
    assert record["set_values"] == []
    # 零潜形状参:resolution=1024 → [1,64,1024//16,1024//16];device=中间设备桩
    assert record["zeros"] == [{"size": [1, 64, 64, 64], "device": "stub-device"}]
    assert latent == {"samples": _ZEROS}


def test_execute_zero_reference_none_images_and_resolution_zero(monkeypatch):
    """images=None(未接线)+ resolution=0:与空 dict 同路;零潜回退 1024 基准。"""
    record = _install_engine_stubs(monkeypatch)
    pos = object()
    clip = _StubClip(pos)
    positive, negative, latent = _run(clip=clip, prompt="p", negative_prompt="", vae=None, images=None)
    assert len(clip.tokenize_calls) == 1
    assert len(clip.encode_calls) == 1
    assert negative is positive is pos
    # resolution or 1024 → 0 回退 1024
    assert record["zeros"] == [{"size": [1, 64, 64, 64], "device": "stub-device"}]
    assert latent["samples"] is _ZEROS


# ── 带参考臂:VAE 潜注入+keep_vision=False ────────────────────
def test_execute_with_reference_latents(monkeypatch):
    record = _install_engine_stubs(monkeypatch)
    pos = object()
    clip = _StubClip(pos)
    vae = _StubVae()
    img = _FakeImage("ref", (1, 64, 32, 3))  # NHWC:H=64,W=32,C=3,均关键维 32 倍数

    positive, negative, latent = _run(
        clip=clip, prompt="p", negative_prompt="n", vae=vae, resolution=0,
        images={"image_1": img})

    # 参考图链:尺寸相等捷径(不走 common_upscale);vae.encode 恰 1 次吃 s
    assert record["common_upscale"] == []
    assert len(vae.encode_calls) == 1 and vae.encode_calls[0][0] is img
    ref_out = vae.encode_calls[0][1]
    # tokenize 带参考图列表,keep_vision=False(ref_latents 非空),prevent_empty_text=True
    text, kwargs = clip.tokenize_calls[0]
    assert text == "p"
    assert kwargs["images"] == [img]
    assert kwargs["keep_vision"] is False
    assert kwargs["prevent_empty_text"] is True
    assert len(clip.tokenize_calls) == 1 and len(clip.encode_calls) == 1  # 单遍不破
    # set_values 仅对 positive 施加(append=True 带 reference_latents);官方双出都施加,
    # 新类单施加后 negative 直通同对象=同 conditioning 等价(计划书措辞如实)
    assert len(record["set_values"]) == 1
    call = record["set_values"][0]
    assert call["conditioning"] is pos
    assert list(call["values"]) == ["reference_latents"]
    assert call["values"]["reference_latents"] == [ref_out]
    assert call["append"] is True
    assert positive is negative is _COND_REF
    # 零潜形状随首参考图:W=32,H=64 → [1,64,64//16,32//16]=[1,64,4,2]
    assert record["zeros"] == [{"size": [1, 64, 4, 2], "device": "stub-device"}]
    assert latent["samples"] is _ZEROS


def test_execute_multi_image_sorted_by_slot_number(monkeypatch):
    """多参考图按 image_N 序号排序入列(dict 插入序故意倒置仍按 1,2 序)。"""
    _install_engine_stubs(monkeypatch)
    clip = _StubClip(object())
    vae = _StubVae()
    img1 = _FakeImage("one", (1, 32, 32, 3))
    img2 = _FakeImage("two", (1, 32, 32, 3))
    _run(clip=clip, prompt="p", negative_prompt="n", vae=vae, resolution=0,
         images={"image_2": img2, "image_1": img1})
    _, kwargs = clip.tokenize_calls[0]
    assert kwargs["images"] == [img1, img2]
    assert [inp.name for inp, _out in vae.encode_calls] == ["one", "two"]


def test_execute_none_image_slot_skipped(monkeypatch):
    """官方 :150-151 语义:image_N 槽存在但值为 None → 跳过(不进看图列/潜列)。"""
    record = _install_engine_stubs(monkeypatch)
    clip = _StubClip(object())
    vae = _StubVae()
    img = _FakeImage("only", (1, 32, 32, 3))
    _run(clip=clip, prompt="p", negative_prompt="n", vae=vae, resolution=0,
         images={"image_1": img, "image_2": None})
    _, kwargs = clip.tokenize_calls[0]
    assert kwargs["images"] == [img]
    assert len(vae.encode_calls) == 1
    assert len(record["set_values"]) == 1


# ── 注册面(主裁C 类名终局) ─────────────────────────────────
def test_registry_exposes_fast_encode():
    assert NODE_CLASS_MAPPINGS.get("MyQi21FastEncode") is MyQi21FastEncode
    assert NODE_DISPLAY_NAME_MAPPINGS["MyQi21FastEncode"] == "Qwen Image 2.1 文本编码·漫影单遍"
    assert "ManyingQi21FastEncode" not in NODE_CLASS_MAPPINGS  # 新件无旧名别名


# ── 文件头与顶层导入纪律(结构性断言) ──────────────────────
def test_module_header_declaration():
    src = MODULE_PATH.read_text(encoding="utf-8")
    assert "同域重实现" in src
    assert "净室" not in src
    assert "零 Goohaitools 引用" in src  # 同域声明要件(序2 ④)
    # 类名单源:模块文本只出现 MyQi21FastEncode 一个类名形态(旧废名
    # 零字面,验收 grep 全仓计 0——本件亦不留旧名字面)


def test_top_level_import_discipline():
    """顶层引擎库导入纪律:torch/comfy(本体)/node_helpers 禁(执行期懒导入);
    comfy_api.latest 放行——v3 类定义期必需,官方 nodes_qwen.py 同款顶层形。"""
    tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
    for stmt in tree.body:  # 仅顶层
        if isinstance(stmt, ast.Import):
            names = [alias.name for alias in stmt.names]
        elif isinstance(stmt, ast.ImportFrom):
            names = [stmt.module or ""]
        else:
            continue
        for name in names:
            root = name.split(".", 1)[0]
            assert root not in ("torch", "comfy", "node_helpers"), \
                f"顶层引擎库导入违例: {name}"
