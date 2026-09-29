# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyImageGridSplit 契约测试(0929 TE-MAN 排查 B3 仿写件;源码位 sidecar
零引擎依赖,纯逻辑直测;存盘重路径不单测,归实弹阶段引擎现场冒烟)。

锁:注册面(双表+类目+无旧名别名)/widget 面(rows/cols 上下界与默认、
crop 四界默认整幅)/几何纯逻辑(归一化框选夹回与取整、floor 切格的并集
恰=原盒/互不重叠/边缘格吸收余数、像素不足与空盒报错)/命名口径(ComfyUI
SaveImage 计数器段可解析,防覆盖语义成立)/A5 铁约束随档(类 docstring
明写「宫格图绝不当视频参考」)/模块级零重依赖(AST 静态锁:重库只准函数
内懒加载——本件自身 PIL-free 可 standalone 加载;包级收集另撞存量件
my_charsheet_labels.py 的模块级 PIL 导入,系 09-20 存量现状非本件引入,
故套件仍须在有 PIL 的解释器跑)。
"""

from __future__ import annotations

import ast
from pathlib import Path

import numpy as np
import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from engines.comfyui.my_nodes.nodes.my_image_grid_split import (
    MAX_GRID_AXIS, MyImageGridSplit, cell_filenames, cell_suffixes,
    grid_cell_boxes, resolve_crop_box, validate_grid_shape)

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
def test_registry_exposes_grid_split():
    assert NODE_CLASS_MAPPINGS.get("MyImageGridSplit") is MyImageGridSplit
    assert NODE_DISPLAY_NAME_MAPPINGS["MyImageGridSplit"] == "漫影 宫格切割回灌"
    assert MyImageGridSplit.CATEGORY == "my"  # 类目随包内现行目录(兄弟件同区)
    # 设计裁定:新节点无存量工作流,不建 Manying 旧名别名
    assert "ManyingImageGridSplit" not in NODE_CLASS_MAPPINGS


def test_widget_surface_and_defaults():
    spec = MyImageGridSplit.INPUT_TYPES()
    assert set(spec) == {"required", "optional"}
    assert set(spec["required"]) == {"images", "rows", "cols", "filename_prefix"}
    assert spec["required"]["images"][0] == "IMAGE"
    for key in ("rows", "cols"):
        kind, meta = spec["required"][key]
        assert kind == "INT"
        assert meta["default"] == 2 and meta["min"] == 1
        assert meta["max"] == MAX_GRID_AXIS == 8  # 8×8=64 格上限双保险
    assert spec["required"]["filename_prefix"][1]["default"] == "my_grid_split"
    # 框选四界:归一化 0-1,默认 0/0/1/1=整幅不裁
    assert set(spec["optional"]) == {
        "crop_left", "crop_top", "crop_right", "crop_bottom"}
    for key, default in (("crop_left", 0.0), ("crop_top", 0.0),
                         ("crop_right", 1.0), ("crop_bottom", 1.0)):
        kind, meta = spec["optional"][key]
        assert kind == "FLOAT"
        assert (meta["default"], meta["min"], meta["max"]) == (default, 0.0, 1.0)


def test_output_shape_and_function():
    assert MyImageGridSplit.RETURN_TYPES == ("STRING",)
    assert MyImageGridSplit.RETURN_NAMES == ("input_names",)
    assert MyImageGridSplit.FUNCTION == "split"
    assert MyImageGridSplit.OUTPUT_NODE is True  # 写回件=终端语义(同 MyGenerated)


# ── A5 铁约束随档:docstring 明写版式泄漏禁令 ──────────────────
def test_a5_constraint_in_docstrings():
    """A5(排查文档 §A5):宫格图只作中间产物、切割后再用,绝不当视频参考。"""
    import engines.comfyui.my_nodes.nodes.my_image_grid_split as module
    for doc in (module.__doc__, MyImageGridSplit.__doc__):
        assert doc is not None
        assert "中间产物" in doc
        assert "绝不当视频参考" in doc


# ── 模块级零重依赖:AST 静态锁(PIL 等只准函数内懒加载)──────────
def test_heavy_imports_are_function_lazy_only():
    for name in ("my_image_grid_split.py", "_input_writeback.py"):
        offenders = _module_level_heavy_imports(_NODES_DIR / name)
        assert offenders == [], f"{name} 模块级出现重依赖 import:{offenders}"


# ── 归一化框选:夹回/取整/空盒报错 ──────────────────────────
def test_crop_box_identity_default_is_full_frame():
    assert resolve_crop_box(100, 80, 0.0, 0.0, 1.0, 1.0) == (0, 0, 100, 80)


def test_crop_box_scales_and_rounds_half_up():
    assert resolve_crop_box(100, 80, 0.25, 0.25, 0.75, 0.75) == (25, 20, 75, 60)
    # 半进位:101px 的 0.5 → int(50.5+0.5)=51(与 ComfyUI 常规取整同向)
    assert resolve_crop_box(101, 101, 0.5, 0.0, 1.0, 0.5) == (51, 0, 101, 51)


def test_crop_box_clamps_out_of_range_values():
    assert resolve_crop_box(100, 80, -0.2, -0.2, 1.5, 1.5) == (0, 0, 100, 80)


@pytest.mark.parametrize("left,right", [(0.6, 0.4), (0.10, 0.1004)])
def test_crop_box_rejects_empty_selection(left, right):
    with pytest.raises(ValueError, match="框选区过小"):
        resolve_crop_box(1000, 1000, left, 0.0, right, 1.0)


# ── floor 切格:并集恰=原盒/互不重叠/边缘格吸收余数 ─────────────
def test_grid_boxes_exact_division_quarter():
    assert grid_cell_boxes((0, 0, 100, 80), 2, 2) == [
        (0, 0, 50, 40), (50, 0, 100, 40), (0, 40, 50, 80), (50, 40, 100, 80)]


def test_grid_boxes_remainder_absorbed_by_edge_cells():
    # 101 宽切 3 列:33/34/34(右缘吸收);99 高切 3 行:整除
    boxes = grid_cell_boxes((0, 0, 101, 99), 3, 3)
    assert boxes[0] == (0, 0, 33, 33)
    assert boxes[1] == (33, 0, 67, 33)
    assert boxes[2] == (67, 0, 101, 33)
    assert boxes[8] == (67, 66, 101, 99)


def test_grid_boxes_single_cell_returns_box():
    assert grid_cell_boxes((10, 20, 110, 90), 1, 1) == [(10, 20, 110, 90)]


@pytest.mark.parametrize("w,h,rows,cols", [
    (100, 80, 2, 2), (101, 99, 3, 3), (2048, 2048, 4, 4), (7, 5, 3, 2),
    (17, 13, 1, 5), (64, 64, 8, 8)])
def test_grid_boxes_tile_exactly(w, h, rows, cols):
    """切格三性质:行主序计数、面积和=原盒(并集且互不重叠)、每格 ≥1px。"""
    boxes = grid_cell_boxes((0, 0, w, h), rows, cols)
    assert len(boxes) == rows * cols  # 行主序:先左→右,再上→下
    assert sum((xe - xs) * (ye - ys) for xs, ys, xe, ye in boxes) == w * h
    for xs, ys, xe, ye in boxes:
        assert 1 <= xe - xs and 1 <= ye - ys


def test_grid_boxes_rejects_pixel_insufficient_region():
    with pytest.raises(ValueError, match="像素不足"):
        grid_cell_boxes((0, 0, 2, 10), 1, 4)  # 宽 2px 撑不起 4 列
    with pytest.raises(ValueError, match="像素不足"):
        grid_cell_boxes((0, 0, 10, 2), 4, 1)


@pytest.mark.parametrize("rows,cols", [(0, 2), (2, 0), (-1, 2), (2.5, 2), (True, 2)])
def test_validate_grid_shape_rejects_bad_axes(rows, cols):
    with pytest.raises(ValueError, match="须为 ≥1 的整数"):
        validate_grid_shape(rows, cols)


def test_validate_grid_shape_rejects_over_cap():
    with pytest.raises(ValueError, match="上限 8"):
        validate_grid_shape(9, 1)


# ── 命名口径:格标识与 ComfyUI 计数器解析兼容 ─────────────────
def test_cell_suffixes_row_major():
    assert cell_suffixes(2, 3) == ["r0c0", "r0c1", "r0c2", "r1c0", "r1c1", "r1c2"]


def test_cell_filenames_pattern():
    assert cell_filenames("mg", 7, 2, 2) == [
        "mg_00007_r0c0.png", "mg_00007_r0c1.png",
        "mg_00007_r1c0.png", "mg_00007_r1c1.png"]


def test_cell_filenames_parse_under_comfyui_counter_semantics():
    """文件名计数器段须可被 folder_paths.map_filename 解析(防覆盖自增成立)。

    镜像实现自引擎 folder_paths.get_save_image_path 内 map_filename:
    前缀后第一个下划线段=五位计数数字。
    """
    def _counter_digits(prefix: str, filename: str) -> int:
        prefix_len = len(prefix)
        remainder = filename[prefix_len + 1:]
        return int(remainder.split(".")[0].split("_")[0])

    for counter in (1, 12, 12345):
        for name in cell_filenames("my_grid_split", counter, 3, 4):
            assert _counter_digits("my_grid_split", name) == counter, name


# ── split 前置守卫:引擎库介入前即报人话(不触 PIL/folder_paths)──
class _FakeGrid:
    """带 numpy() 的假宫格帧(与 frame_to_uint8 的 torch/numpy 双态协议对齐)。"""

    def __init__(self, height: int, width: int):
        self._array = np.zeros((height, width, 3), dtype=np.float32)

    def numpy(self):
        return self._array


def test_split_rejects_empty_image_batch():
    with pytest.raises(ValueError, match="空 IMAGE 批"):
        MyImageGridSplit().split([], 2, 2, "my_grid_split")


def test_split_rejects_bad_rows_before_engine_libs():
    with pytest.raises(ValueError, match="须为 ≥1 的整数"):
        MyImageGridSplit().split([_FakeGrid(10, 10)], 0, 2, "my_grid_split")


def test_split_rejects_degenerate_crop_before_engine_libs():
    # 框选空盒在写盘(PIL)之前即报错——纯几何路径全覆盖
    with pytest.raises(ValueError, match="框选区过小"):
        MyImageGridSplit().split(
            [_FakeGrid(100, 100)], 2, 2, "my_grid_split",
            crop_left=0.6, crop_right=0.4)


def test_split_rejects_pixel_insufficient_grid():
    with pytest.raises(ValueError, match="像素不足"):
        MyImageGridSplit().split([_FakeGrid(3, 1)], 2, 2, "my_grid_split")
