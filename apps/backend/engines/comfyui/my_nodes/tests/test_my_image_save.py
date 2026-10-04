# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyImageSave 契约测试(1001 TE-MAN B7 子件①仿写件;源码位 sidecar 零引擎
依赖,纯逻辑直测;真存盘重路径不单测,归实弹阶段引擎现场冒烟)。

锁:注册面(双表+类目+无旧名别名)/输入面(required/hidden 全继承+
optional prompt_text)/槽名撞车守卫(hidden 的 prompt 与 optional 的
prompt_text 并存且各节键两两不相交)/继承面(FUNCTION/OUTPUT_NODE/
RETURN_TYPES 全承核心存图)/panel_payload 纯函数(strip+字数归一)/
ui.myPrompt 形状(单元素列表=扁平化契约,桩基类替换法)/hidden 透传/
懒加载纪律(AST 静态锁:重库只准函数内懒加载+引擎根层 nodes 导入必须
try 守卫)/docstring 契约(面板/双击复制/列表回传随档)。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from engines.comfyui.my_nodes.nodes import my_image_save as my_image_save_module
from engines.comfyui.my_nodes.nodes.my_image_save import (
    MyImageSave, panel_payload)

_NODES_DIR = Path(__file__).resolve().parent.parent / "nodes"
_MODULE = _NODES_DIR / "my_image_save.py"

# 重依赖清单:这些库只准在函数体内 import(模块级出现即违约)
_HEAVY_ROOTS = {"PIL", "folder_paths", "cv2", "torch", "subprocess", "ffmpeg"}


def _module_level_heavy_imports(path: Path) -> list[str]:
    """AST 静态检查:重依赖 import 是否全部位于函数体内部。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    offenders: list[str] = []

    def visit(node: ast.AST, in_function: bool) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit(child, True)
                continue
            if not in_function and isinstance(child, ast.Import):
                offenders.extend(
                    f"{alias.name}(L{child.lineno})"
                    for alias in child.names
                    if alias.name.split(".")[0] in _HEAVY_ROOTS)
            if (not in_function and isinstance(child, ast.ImportFrom)
                    and child.module):
                if child.module.split(".")[0] in _HEAVY_ROOTS:
                    offenders.append(f"{child.module}(L{child.lineno})")
            visit(child, in_function)

    visit(tree, False)
    return offenders


# ── 注册面 ────────────────────────────────────────────────
def test_registry_exposes_image_save():
    assert NODE_CLASS_MAPPINGS.get("MyImageSave") is MyImageSave
    assert NODE_DISPLAY_NAME_MAPPINGS["MyImageSave"] == "漫影 存图(可追溯)"
    assert MyImageSave.CATEGORY == "漫影"
    # 设计裁定:新节点无存量工作流,不建 Manying 旧名别名
    assert "ManyingImageSave" not in NODE_CLASS_MAPPINGS


# ── 输入面:required/hidden 全继承 + optional prompt_text ───────────
def test_input_surface_inherits_core_and_adds_prompt_text():
    spec = MyImageSave.INPUT_TYPES()
    assert set(spec) == {"required", "optional", "hidden"}
    # required 全承核心存图(不加不减)
    assert set(spec["required"]) == {"images", "filename_prefix"}
    assert spec["required"]["images"][0] == "IMAGE"
    assert spec["required"]["filename_prefix"][1]["default"] == "ComfyUI"
    # optional 新增=prompt_text 显式接线口(multiline,默认空)
    assert set(spec["optional"]) == {"prompt_text"}
    assert spec["optional"]["prompt_text"][0] == "STRING"
    assert spec["optional"]["prompt_text"][1]["default"] == ""
    assert spec["optional"]["prompt_text"][1]["multiline"] is True


def test_hidden_slots_inherit_and_no_name_collision():
    """hidden 槽名撞车守卫:核心 hidden 的 prompt(=PROMPT 全 API 图)与
    optional 的 prompt_text 必须并存且三节键两两不相交(同名即注册冲突)。"""
    spec = MyImageSave.INPUT_TYPES()
    assert set(spec["hidden"]) == {"prompt", "extra_pnginfo"}
    assert spec["hidden"]["prompt"] == "PROMPT"
    assert spec["hidden"]["extra_pnginfo"] == "EXTRA_PNGINFO"
    required, optional, hidden = (set(spec[k]) for k in
                                  ("required", "optional", "hidden"))
    assert not (required & optional), "required 与 optional 撞名"
    assert not (required & hidden), "required 与 hidden 撞名"
    assert not (optional & hidden), "optional 与 hidden 撞名(prompt_text≠prompt)"
    assert "prompt" not in optional
    assert "prompt_text" not in hidden


# ── 继承面:存图行为=核心照旧(FUNCTION/OUTPUT_NODE/RETURN 全承)─────
def test_output_surface_inherits_core_save():
    assert MyImageSave.FUNCTION == "save_images"
    assert MyImageSave.OUTPUT_NODE is True  # 存图终端锚随核心继承
    assert MyImageSave.RETURN_TYPES == ("IMAGE",)
    assert MyImageSave.RETURN_NAMES == ("images",)


# ── panel_payload 纯函数:strip+字数归一 ──────────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("", ("", 0)),
    (None, ("", 0)),
    ("   \n\t  ", ("", 0)),           # 全空白→面板空
    ("  你好世界  ", ("你好世界", 4)),   # 首尾 strip
    ("first line\nsecond line", ("first line\nsecond line", 22)),
    (123, ("123", 3)),                 # 非串安全归一
])
def test_panel_payload_normalizes(raw, expected):
    text, chars = expected
    assert panel_payload(raw) == {"text": text, "chars": chars}


def test_panel_payload_long_text_chars_count():
    body = "甲" * 5000 + " tail "
    payload = panel_payload(body)
    assert payload["chars"] == 5005 == len(payload["text"])


# ── ui 形状:单元素列表(扁平化契约)+ hidden 透传(桩基类替换法)──────
def test_save_images_appends_single_element_ui_list(monkeypatch):
    """基类 save_images 换桩(真存盘不进单测)→锁:核心返回体原样透传+
    ui.myPrompt=单元素列表;hidden prompt/extra_pnginfo 原样转交核心。"""
    calls: dict = {}

    def stub_save(self, images, filename_prefix="ComfyUI",
                  prompt=None, extra_pnginfo=None):
        calls.update(images=images, filename_prefix=filename_prefix,
                     prompt=prompt, extra_pnginfo=extra_pnginfo)
        return {"ui": {"images": [{"filename": "ComfyUI_00001_.png",
                                   "subfolder": "", "type": "output"}]},
                "result": (images,)}

    monkeypatch.setattr(my_image_save_module.SaveImage, "save_images",
                        stub_save)
    images = object()  # 桩基类不触像素,占位即可
    prompt_graph = {"3": {"class_type": "MyImageSave"}}
    result = MyImageSave().save_images(
        images, "my_prefix", prompt_text="  追溯文本  ",
        prompt=prompt_graph, extra_pnginfo={"workflow": {}})

    # 核心存图返回体原样透传(桩收参=子类全 kwargs 转交)
    assert calls["images"] is images
    assert calls["filename_prefix"] == "my_prefix"
    assert calls["prompt"] is prompt_graph
    assert calls["extra_pnginfo"] == {"workflow": {}}
    assert result["result"] == (images,)
    assert result["ui"]["images"][0]["filename"] == "ComfyUI_00001_.png"
    # ui.myPrompt=单元素列表(引擎 ui 扁平化契约;元素=扁平 dict)
    my_prompt = result["ui"]["myPrompt"]
    assert isinstance(my_prompt, list) and len(my_prompt) == 1
    assert my_prompt[0] == {"text": "追溯文本", "chars": 4}


def test_save_images_default_prompt_text_is_empty_panel(monkeypatch):
    """prompt_text 缺省(未接线/未填)→ 面板空载荷,不炸不报。"""
    monkeypatch.setattr(
        my_image_save_module.SaveImage, "save_images",
        lambda self, images, filename_prefix="ComfyUI", prompt=None,
        extra_pnginfo=None: {"ui": {}, "result": (images,)})
    result = MyImageSave().save_images(object(), prompt={"k": 1})
    assert result["ui"]["myPrompt"] == [{"text": "", "chars": 0}]


def test_save_images_builds_ui_bucket_when_core_returns_without(monkeypatch):
    """防御面:核心返回体无 ui 桶时自建(老/新核心返回形状漂移不炸)。"""
    monkeypatch.setattr(
        my_image_save_module.SaveImage, "save_images",
        lambda self, images, filename_prefix="ComfyUI", prompt=None,
        extra_pnginfo=None: {"result": (images,)})
    result = MyImageSave().save_images(object(), prompt_text="x")
    assert result["ui"]["myPrompt"] == [{"text": "x", "chars": 1}]


# ── 懒加载纪律:AST 静态锁 ────────────────────────────────────────────
def test_heavy_imports_are_function_lazy_only():
    offenders = _module_level_heavy_imports(_MODULE)
    assert offenders == [], f"my_image_save.py 模块级出现重依赖 import:{offenders}"


def test_engine_root_import_is_try_guarded():
    """引擎根层 `from nodes import SaveImage` 必须 try/ImportError 守卫:
    裸写会让 sidecar 源码位整个包不可导入(全目录 pytest 连坐红)。"""
    tree = ast.parse(_MODULE.read_text(encoding="utf-8"))
    guarded = any(
        isinstance(node, ast.Try)
        and any(isinstance(child, ast.ImportFrom) and child.module == "nodes"
                for child in node.body)
        and any(isinstance(child, ast.ExceptHandler)
                and any(isinstance(grand, ast.ClassDef)
                        for grand in child.body)
                for child in node.handlers)
        for node in ast.walk(tree))
    assert guarded, "引擎根层 nodes 导入必须 try 守卫+sidecar 占位基类兜底"


# ── docstring 契约:面板/双击复制/列表回传随档 ────────────────────────
def test_docstring_states_panel_contract():
    text = my_image_save_module.__doc__ or ""
    for anchor in ("prompt 面板", "双击", "复制", "ui.myPrompt",
                   "单元素列表", "prompt_text", "SaveImage"):
        assert anchor in text, anchor
    for anchor in ("prompt 面板", "双击复制", "核心存图"):
        assert anchor in MyImageSave.DESCRIPTION, anchor
