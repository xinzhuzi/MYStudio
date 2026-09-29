# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyImageABCompare 契约测试(0929 TE-MAN 排查 B2 仿写件;源码位 sidecar
零引擎依赖,纯逻辑直测;temp 落盘重路径不单测,归实弹阶段引擎现场冒烟)。

锁:注册面(双表+类目+无旧名别名)/widget 面(双 IMAGE 直连透传+标签)/
输出面(IMAGE 双出透传+OUTPUT_NODE 终端锚)/倍率夹取(2-7x 区间+档位循环
+非数兜底)/帘位与镜心 0-1 夹取/空批守卫中文报错(引擎库介入前即报)/
交互契约(docstring 明写 canvas 滑帘+放大镜零后端+状态走 properties)/
模块级零重依赖(AST 静态锁:重库只准函数内懒加载)。
"""

from __future__ import annotations

import ast
import math
from pathlib import Path

import numpy as np
import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from engines.comfyui.my_nodes.nodes.my_image_ab_compare import (
    DEFAULT_CURTAIN, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS, MyImageABCompare,
    clamp_ratio, clamp_zoom, lens_center, next_zoom, validate_ab_images)

_NODES_DIR = Path(__file__).resolve().parent.parent / "nodes"

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
def test_registry_exposes_image_ab_compare():
    assert NODE_CLASS_MAPPINGS.get("MyImageABCompare") is MyImageABCompare
    assert NODE_DISPLAY_NAME_MAPPINGS["MyImageABCompare"] == "漫影 图对比审片"
    assert MyImageABCompare.CATEGORY == "my"
    # 设计裁定:新节点无存量工作流,不建 Manying 旧名别名
    assert "ManyingImageABCompare" not in NODE_CLASS_MAPPINGS


def test_widget_surface_direct_passthrough_inputs():
    spec = MyImageABCompare.INPUT_TYPES()
    assert set(spec) == {"required", "optional"}
    assert set(spec["required"]) == {"image_a", "image_b"}
    assert spec["required"]["image_a"][0] == "IMAGE"  # 直连透传:可串产物链
    assert spec["required"]["image_b"][0] == "IMAGE"
    assert set(spec["optional"]) == {"label_a", "label_b"}
    assert spec["optional"]["label_a"][1]["default"] == "A"
    assert spec["optional"]["label_b"][1]["default"] == "B"


def test_output_shape_passthrough_and_anchor():
    assert MyImageABCompare.RETURN_TYPES == ("IMAGE", "IMAGE")
    assert MyImageABCompare.RETURN_NAMES == ("image_a", "image_b")
    assert MyImageABCompare.FUNCTION == "compare"
    assert MyImageABCompare.OUTPUT_NODE is True  # 纯旁观串链尾也保证执行


# ── 倍率区间:2-7x 夹取(设计真源 B2 行口径)──────────────────
def test_zoom_constants_bound_the_lens():
    assert (ZOOM_MIN, ZOOM_MAX) == (2.0, 7.0)
    assert ZOOM_STEPS[0] == ZOOM_MIN
    assert ZOOM_STEPS[-1] == ZOOM_MAX
    assert list(ZOOM_STEPS) == sorted(set(ZOOM_STEPS))  # 档位严格递增不重复


@pytest.mark.parametrize("zoom,expected", [
    (2.0, 2.0), (7.0, 7.0), (4.5, 4.5),
    (1.0, 2.0), (0.0, 2.0), (8.0, 7.0), (99.0, 7.0),
    (math.nan, 2.0), (None, 2.0), ("x", 2.0), (2.5, 2.5)])
def test_clamp_zoom_bounds(zoom, expected):
    assert clamp_zoom(zoom) == expected


@pytest.mark.parametrize("zoom,expected", [
    (2.0, 3.0), (3.0, 4.0), (4.0, 5.0), (5.0, 7.0), (7.0, 2.0),  # 档位循环
    (2.5, 3.0), (6.0, 7.0), (9.0, 2.0)])                          # 档间/越界就近
def test_next_zoom_cycles_steps(zoom, expected):
    assert next_zoom(zoom) == expected


def test_next_zoom_below_min_clamps_to_first_step_then_cycles():
    """低于下限的输入先夹回首档再循环:1.0→按 2.0 在档,下一档=3.0。"""
    assert next_zoom(1.0) == 3.0
    assert next_zoom(0.0) == 3.0


# ── 帘位/镜心:0-1 夹取(非数兜回正中)────────────────────────
@pytest.mark.parametrize("value,expected", [
    (0.0, 0.0), (1.0, 1.0), (0.5, 0.5), (0.25, 0.25),
    (-0.3, 0.0), (1.7, 1.0),
    (math.nan, DEFAULT_CURTAIN), (None, DEFAULT_CURTAIN), ("junk", DEFAULT_CURTAIN)])
def test_clamp_ratio_bounds(value, expected):
    assert clamp_ratio(value) == expected


def test_lens_center_clamps_each_axis_independently():
    assert lens_center(0.5, 0.5) == (0.5, 0.5)
    assert lens_center(-1.0, 2.0) == (0.0, 1.0)
    assert lens_center(None, "x") == (DEFAULT_CURTAIN, DEFAULT_CURTAIN)


# ── 前置守卫:空批中文报错(引擎库介入前即报,不触 PIL)──────────
def test_validate_rejects_empty_batches_with_side_names():
    with pytest.raises(ValueError, match="A 路收到空 IMAGE 批"):
        validate_ab_images(np.zeros((0, 4, 4, 3)), np.zeros((1, 4, 4, 3)))
    with pytest.raises(ValueError, match="B 路收到空 IMAGE 批"):
        validate_ab_images(np.zeros((1, 4, 4, 3)), np.zeros((0, 4, 4, 3)))


def test_compare_guards_before_engine_libs():
    with pytest.raises(ValueError, match="空 IMAGE 批"):
        MyImageABCompare().compare(None, np.zeros((1, 4, 4, 3)))
    with pytest.raises(ValueError, match="空 IMAGE 批"):
        MyImageABCompare().compare(np.zeros((1, 4, 4, 3)), np.zeros((0, 4, 4, 3)))


# ── 模块级零重依赖:AST 静态锁(PIL 等只准函数内懒加载)──────────
def test_heavy_imports_are_function_lazy_only():
    offenders = _module_level_heavy_imports(_NODES_DIR / "my_image_ab_compare.py")
    assert offenders == [], f"my_image_ab_compare.py 模块级出现重依赖 import:{offenders}"


# ── docstring 契约:交互面与状态位随档 ─────────────────────────
def test_docstring_states_compare_contract():
    import engines.comfyui.my_nodes.nodes.my_image_ab_compare as module
    text = module.__doc__ or ""
    for anchor in ("滑动帘", "放大镜", "2-7x", "零后端", "node.properties"):
        assert anchor in text, anchor
