# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md for details.
"""PNG 元数据脱敏闸契约测试(1007 晚乙案;1010 v2 扩面;桩基零引擎依赖)。

锁:sanitize_prompt_meta 纯函数(自研命名空间命中脱敏为***/原对象零拷贝
churn/永不原地改入参/非 dict 透传/幂等)/命名空间scope(My* 才管,三方
节点不碰)/安装器(桩 nodes 模块:包装生效+幂等不双重包装+缺 SaveImage
静默降级+kwargs 透传)/v2 三模式包装(模式A按名捕获prompt/模式B helper
代理cls零接触真hidden/模式C execute临时替换必还原)/三方注册表扫描
(NODE_CLASS_MAPPINGS 命中即包+幂等)/链式重扫(load_custom_node 包装后
每包加载触发)/懒加载纪律(AST 静态锁:引擎根层 nodes 导入只准函数内,
模块顶层零 comfy 依赖)/docstring 契约(甲乙分工/history 边界/v2 扩面)。
"""

from __future__ import annotations

import ast
import sys
import types
from pathlib import Path

import pytest

from engines.comfyui.my_nodes.prompt_meta_guard import (
    REDACTED, THIRD_PARTY_SAVERS, _wrap_execute_hidden_swap,
    _wrap_helper_cls_arg, _wrap_keyword_prompt, install_saveimage_metadata_guard,
    sanitize_prompt_meta, wrap_third_party_savers)

_MODULE = Path(__file__).resolve().parent.parent / "prompt_meta_guard.py"


# ── sanitize_prompt_meta 纯函数 ──────────────────────────────────────

def _pe_node(api_key: object) -> dict:
    return {"class_type": "MyQi21ApiPE",
            "inputs": {"api_key": api_key, "model": "GLM-5.3"}}


def test_redacts_my_namespace_api_key():
    prompt = {"6:4013": _pe_node("sk-secret"), "7:7010": {
        "class_type": "KSampler", "inputs": {"cfg": 4.0}}}
    out = sanitize_prompt_meta(prompt)
    assert out["6:4013"]["inputs"]["api_key"] == REDACTED
    # 同节点其余输入与未命中节点逐字保留
    assert out["6:4013"]["inputs"]["model"] == "GLM-5.3"
    assert out["7:7010"]["inputs"]["cfg"] == 4.0


def test_never_mutates_input():
    prompt = {"6:4013": _pe_node("sk-secret")}
    sanitize_prompt_meta(prompt)
    assert prompt["6:4013"]["inputs"]["api_key"] == "sk-secret"


def test_no_hit_returns_same_object():
    prompt = {"7:7010": {"class_type": "KSampler", "inputs": {"cfg": 4.0}}}
    assert sanitize_prompt_meta(prompt) is prompt


def test_none_or_absent_or_already_redacted_no_churn():
    prompt = {"a": _pe_node(None), "b": _pe_node(REDACTED),
              "c": {"class_type": "MyQi21ApiPE", "inputs": {}}}
    assert sanitize_prompt_meta(prompt) is prompt


def test_non_dict_passthrough():
    for weird in (None, "x", 42, [1, 2]):
        assert sanitize_prompt_meta(weird) is weird


def test_third_party_namespace_out_of_scope():
    prompt = {"x": {"class_type": "SomePackNode",
                    "inputs": {"api_key": "sk-other"}}}
    assert sanitize_prompt_meta(prompt) is prompt


def test_idempotent():
    prompt = {"6:4013": _pe_node("sk-secret")}
    once = sanitize_prompt_meta(prompt)
    twice = sanitize_prompt_meta(once)
    assert twice["6:4013"]["inputs"]["api_key"] == REDACTED
    assert once is twice  # 已脱敏→无命中→原对象


# ── 安装器(桩 nodes 模块,零引擎依赖)───────────────────────────────

@pytest.fixture()
def stub_nodes(monkeypatch):
    # 桩类须每测新造:安装标记打在类属性上,模块级共享类会跨测试串味
    class StubSaveImage:
        def save_images(self, images, filename_prefix="ComfyUI",
                        prompt=None, extra_pnginfo=None, **kwargs):
            self.captured = prompt
            self.kwargs = kwargs
            return {"ui": {}}

    stub = types.ModuleType("nodes")
    stub.SaveImage = StubSaveImage
    monkeypatch.setitem(sys.modules, "nodes", stub)
    return stub


def test_install_wraps_and_sanitizes(stub_nodes, capsys):
    assert install_saveimage_metadata_guard() is True
    assert "[漫影 元数据闸]" in capsys.readouterr().out
    node = stub_nodes.SaveImage()
    prompt = {"6:4013": _pe_node("sk-secret")}
    node.save_images("img", prompt=prompt, extra_pnginfo={"w": 1})
    assert node.captured["6:4013"]["inputs"]["api_key"] == REDACTED
    assert node.captured["6:4013"]["inputs"]["model"] == "GLM-5.3"


def test_install_idempotent(stub_nodes):
    assert install_saveimage_metadata_guard() is True
    sentinel = stub_nodes.SaveImage.save_images
    assert install_saveimage_metadata_guard() is False
    assert stub_nodes.SaveImage.save_images is sentinel


def test_install_kwargs_passthrough(stub_nodes):
    install_saveimage_metadata_guard()
    node = stub_nodes.SaveImage()
    node.save_images("img", filename_prefix="X", prompt={},
                     extra_pnginfo=None, future_kw=1)
    assert node.kwargs == {"future_kw": 1}


def test_install_without_saveimage_silent(monkeypatch, capsys):
    stub = types.ModuleType("nodes")  # 无 SaveImage 属性
    monkeypatch.setitem(sys.modules, "nodes", stub)
    assert install_saveimage_metadata_guard() is False
    assert "安装失败" not in capsys.readouterr().out


def test_install_no_nodes_module_silent(monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "nodes", None)  # import nodes → ImportError
    assert install_saveimage_metadata_guard() is False
    assert "包装失败" in capsys.readouterr().out


# ── v2 模式A:按名捕获 prompt(旧式节点,执行器 f(**inputs))─────────

def test_wrap_keyword_prompt_redacts():
    class KjnodesStub:  # 局部类:包装标记不跨测试串味
        def save_images_alpha(self, images, mask,
                              filename_prefix="x", prompt=None, extra_pnginfo=None):
            self.captured = prompt
            return "saved"

    assert _wrap_keyword_prompt(KjnodesStub, "save_images_alpha") is True
    node = KjnodesStub()
    node.save_images_alpha("img", "m", prompt={"a": _pe_node("sk-1")})
    assert node.captured["a"]["inputs"]["api_key"] == REDACTED


def test_wrap_keyword_prompt_missing_prompt_passthrough():
    class Stub:
        def save(self, images, prompt=None):
            return ("orig", images, prompt)

    assert _wrap_keyword_prompt(Stub, "save") is True
    # 未传 prompt:原样直通,不注入 prompt=None 之外的副作用
    assert Stub().save("img") == ("orig", "img", None)
    # 显式 prompt=None:透传 None(sanitize 对非 dict 原样)
    assert Stub().save("img", prompt=None) == ("orig", "img", None)


def test_wrap_keyword_prompt_idempotent_and_missing_method():
    class Stub:
        def save(self, prompt=None):
            return prompt

    _wrap_keyword_prompt(Stub, "save")
    sentinel = Stub.save
    assert _wrap_keyword_prompt(Stub, "save") is False
    assert Stub.save is sentinel
    assert _wrap_keyword_prompt(Stub, "nope") is False


# ── v2 模式B:helper 静态方法,cls 形参换脱敏代理 ─────────────────────

class _Holder:
    def __init__(self, prompt, extra_pnginfo=None):
        self.prompt = prompt
        self.extra_pnginfo = extra_pnginfo


class _NodeCls:
    hidden = None  # 执行期由执行器注入


class _HelperStub:
    @staticmethod
    def _create_png_metadata(cls):
        return {"prompt": cls.hidden.prompt, "pnginfo": cls.hidden.extra_pnginfo}


def test_wrap_helper_cls_positional_and_keyword():
    assert _wrap_helper_cls_arg(_HelperStub, "_create_png_metadata") is True
    secret = {"a": _pe_node("sk-2")}
    node = type("N", (), {"hidden": _Holder(secret, {"workflow": 1})})
    # 位置调用(官方内部形态)
    out = _HelperStub._create_png_metadata(node)
    assert out["prompt"]["a"]["inputs"]["api_key"] == REDACTED
    assert out["pnginfo"] == {"workflow": 1}  # extra_pnginfo 原样
    # 真节点 hidden 零接触
    assert node.hidden.prompt is secret
    # keyword 调用
    out2 = _HelperStub._create_png_metadata(cls=node)
    assert out2["prompt"]["a"]["inputs"]["api_key"] == REDACTED


def test_wrap_helper_no_hidden_or_none_prompt_passthrough():
    class Helper:
        @staticmethod
        def make(cls):
            return cls

    assert _wrap_helper_cls_arg(Helper, "make") is True
    bare = type("Bare", (), {"hidden": None})
    assert Helper.make(bare) is bare  # hidden=None:原 cls 直通
    empty = type("E", (), {"hidden": _Holder(None)})
    assert Helper.make(empty) is empty  # prompt=None:原 cls 直通


def test_wrap_helper_idempotent():
    class HelperStub:
        @staticmethod
        def make(cls):
            return cls

    assert _wrap_helper_cls_arg(HelperStub, "make") is True
    sentinel = HelperStub.__dict__["make"]
    assert _wrap_helper_cls_arg(HelperStub, "make") is False


# ── v2 模式C:execute 临时替换 cls.hidden.prompt,finally 必还原 ──────

def test_wrap_execute_hidden_swap_restores():
    seen = {}

    class Node:
        hidden = None

        @classmethod
        def execute(cls, images):
            seen["prompt"] = cls.hidden.prompt
            return "ok"

    assert _wrap_execute_hidden_swap(Node) is True
    secret = {"a": _pe_node("sk-3")}
    Node.hidden = _Holder(secret)
    assert Node.execute("img") == "ok"
    # 执行窗口内拿到的是脱敏副本
    assert seen["prompt"]["a"]["inputs"]["api_key"] == REDACTED
    # 执行后必还原原件(节点间不串脱敏态)
    assert Node.hidden.prompt is secret


def test_wrap_execute_hidden_swap_restores_on_exception():
    class Node:
        hidden = None

        @classmethod
        def execute(cls, images):
            raise RuntimeError("boom")

    _wrap_execute_hidden_swap(Node)
    secret = {"a": _pe_node("sk-4")}
    Node.hidden = _Holder(secret)
    with pytest.raises(RuntimeError):
        Node.execute("img")
    assert Node.hidden.prompt is secret  # 异常路径也还原


def test_wrap_execute_no_hidden_noop():
    class Node:
        @classmethod
        def execute(cls, images):
            return ("orig", images)

    assert _wrap_execute_hidden_swap(Node) is True
    assert Node.execute("x") == ("orig", "x")  # hidden 缺失:原样直通


# ── v2 三方注册表扫描 + 链式重扫 ─────────────────────────────────────

@pytest.fixture()
def stub_registry(monkeypatch):
    class VHS:
        def combine_video(self, images, prompt=None, **kw):
            self.captured = prompt
            return "video"

    stub = types.ModuleType("nodes")
    stub.NODE_CLASS_MAPPINGS = {"VHS_VideoCombine": VHS}
    monkeypatch.setitem(sys.modules, "nodes", stub)
    return stub


def test_wrap_third_party_savers_hits_registry(stub_registry, capsys):
    wrapped = wrap_third_party_savers()
    assert "VHS_VideoCombine.combine_video" in wrapped
    assert "三方保存器已包" in capsys.readouterr().out
    # 再扫:幂等空手
    assert wrap_third_party_savers() == []


def test_wrap_third_party_savers_actually_redacts(stub_registry):
    wrap_third_party_savers()
    vhs = stub_registry.NODE_CLASS_MAPPINGS["VHS_VideoCombine"]()
    vhs.combine_video("frames", prompt={"a": _pe_node("sk-5")})
    assert vhs.captured["a"]["inputs"]["api_key"] == REDACTED


def test_registry_names_in_covership():
    # 在册三方的注册名以引擎 object_info 1010 核查为准(未装的不入册)
    assert set(THIRD_PARTY_SAVERS) == {
        "SaveImageWithAlpha", "VHS_VideoCombine", "SaveVideo"}


def test_install_also_scans_registry(stub_registry):
    assert install_saveimage_metadata_guard() is True
    # 三方已被 install 入口顺手包上(当前已加载的立刻包)
    vhs = stub_registry.NODE_CLASS_MAPPINGS["VHS_VideoCombine"]()
    vhs.combine_video("f", prompt={"a": _pe_node("sk-6")})
    assert vhs.captured["a"]["inputs"]["api_key"] == REDACTED


# ── 懒加载纪律(AST 静态锁,同 my_image_save 家法)────────────────────

def test_lazy_import_discipline():
    tree = ast.parse(_MODULE.read_text(encoding="utf-8"))
    top = [n for n in tree.body
           if isinstance(n, (ast.Import, ast.ImportFrom))]
    tops = {a.name.split(".")[0] for n in top
            for a in (n.names if isinstance(n, ast.Import) else [])} | \
           {n.module.split(".")[0] for n in top
            if isinstance(n, ast.ImportFrom) and n.module}
    assert not tops & {"nodes", "torch", "PIL"}, \
        f"模块顶层禁止引擎根层/重库导入(懒加载纪律):{tops}"


def test_docstring_contract():
    doc = _MODULE.read_text(encoding="utf-8")
    for anchor in ("甲案", "乙案", "history", "零改 ComfyUI 本体", "***"):
        assert anchor in doc, f"模块注缺契约锚:{anchor}"
