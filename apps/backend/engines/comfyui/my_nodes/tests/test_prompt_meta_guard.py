# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""PNG 元数据脱敏闸契约测试(1007 晚乙案;源码位零引擎依赖,桩基类直测)。

锁:sanitize_prompt_meta 纯函数(自研命名空间命中脱敏为***/原对象零拷贝
churn/永不原地改入参/非 dict 透传/幂等)/命名空间scope(My* 才管,三方
节点不碰)/安装器(桩 nodes 模块:包装生效+幂等不双重包装+缺 SaveImage
静默降级+kwargs 透传)/懒加载纪律(AST 静态锁:引擎根层 nodes 导入只准
函数内,模块顶层零 comfy 依赖)/docstring 契约(甲乙分工/history 边界)。
"""

from __future__ import annotations

import ast
import sys
import types
from pathlib import Path

import pytest

from engines.comfyui.my_nodes.prompt_meta_guard import (
    REDACTED, install_saveimage_metadata_guard, sanitize_prompt_meta)

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
    assert "安装失败" in capsys.readouterr().out


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
