# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyVideoFrameGrab 契约测试(0929 TE-MAN 排查 B1 仿写件;源码位 sidecar
零引擎依赖,纯逻辑直测;解码存盘重路径不单测,归实弹阶段引擎现场冒烟)。

锁:注册面(双表+类目+无旧名别名)/widget 面(video 线型 VIDEO、策略
combo 闭集首项=默认=均匀、frame_count 上下界与默认)/抽帧计划纯逻辑
(均匀=等距含首尾半进位零漂移、count≥total 取全帧、count=1 取正中帧;
头部/尾部截断;未知策略枚举报错;校验中文报错)/命名口径(ComfyUI
SaveImage 计数器段可解析,防覆盖语义成立)/模块级零重依赖(AST 静态锁:
重库只准函数内懒加载——本件自身 PIL/cv2-free 可 standalone 加载;包级收集另撞存量件
my_charsheet_labels.py 的模块级 PIL 导入,系 09-20 存量现状非本件引入,套件仍须在有 PIL 的
解释器跑)。
"""

from __future__ import annotations

import ast
from pathlib import Path

import numpy as np
import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from engines.comfyui.my_nodes.nodes.my_video_frame_grab import (
    DEFAULT_STRATEGY, FRAME_STRATEGIES, MAX_FRAME_COUNT, STRATEGY_NAMES,
    MyVideoFrameGrab, frame_filenames, frame_suffixes, plan_frames,
    plan_head_frames, plan_tail_frames, plan_uniform_frames)

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
def test_registry_exposes_frame_grab():
    assert NODE_CLASS_MAPPINGS.get("MyVideoFrameGrab") is MyVideoFrameGrab
    assert NODE_DISPLAY_NAME_MAPPINGS["MyVideoFrameGrab"] == "漫影 视频截帧回灌"
    assert MyVideoFrameGrab.CATEGORY == "漫影"
    # 设计裁定:新节点无存量工作流,不建 Manying 旧名别名
    assert "ManyingVideoFrameGrab" not in NODE_CLASS_MAPPINGS


def test_widget_surface_and_defaults():
    spec = MyVideoFrameGrab.INPUT_TYPES()
    assert set(spec) == {"required"}
    assert set(spec["required"]) == {"video", "strategy", "frame_count",
                                     "filename_prefix"}
    assert spec["required"]["video"][0] == "VIDEO"  # 核心线型:LoadVideo/视频产出节点直供
    combo = spec["required"]["strategy"]
    assert combo[0] == STRATEGY_NAMES == ["均匀 · 等距N帧", "头部 · 前N帧", "尾部 · 后N帧"]
    assert combo[1]["default"] == DEFAULT_STRATEGY == STRATEGY_NAMES[0]  # 首项=默认=均匀
    for mode in STRATEGY_NAMES:
        assert " \u00b7 " in mode, mode  # 分隔符码位锁:U+00B7(随包内 combo 先例)
    kind, meta = spec["required"]["frame_count"]
    assert kind == "INT"
    assert (meta["default"], meta["min"], meta["max"]) == (6, 1, MAX_FRAME_COUNT)
    assert MAX_FRAME_COUNT == 512
    assert spec["required"]["filename_prefix"][1]["default"] == "my_frame_grab"


def test_output_shape_and_function():
    assert MyVideoFrameGrab.RETURN_TYPES == ("STRING",)
    assert MyVideoFrameGrab.RETURN_NAMES == ("input_names",)
    assert MyVideoFrameGrab.FUNCTION == "grab"
    assert MyVideoFrameGrab.OUTPUT_NODE is True  # 写回件=终端语义(同 MyGenerated)


def test_strategy_table_maps_each_combo_entry():
    assert [key for _name, key in FRAME_STRATEGIES] == ["uniform", "head", "tail"]


# ── 模块级零重依赖:AST 静态锁(PIL 等只准函数内懒加载)──────────
def test_heavy_imports_are_function_lazy_only():
    for name in ("my_video_frame_grab.py", "_input_writeback.py"):
        offenders = _module_level_heavy_imports(_NODES_DIR / name)
        assert offenders == [], f"{name} 模块级出现重依赖 import:{offenders}"


# ── 均匀抽帧:等距含首尾/半进位/零漂移 ────────────────────────
def test_uniform_takes_all_when_count_reaches_total():
    assert plan_uniform_frames(10, 10) == list(range(10))
    assert plan_uniform_frames(10, 12) == list(range(10))  # 超出取全帧
    assert plan_uniform_frames(1, 6) == [0]


def test_uniform_single_frame_picks_middle():
    assert plan_uniform_frames(1, 1) == [0]
    assert plan_uniform_frames(10, 1) == [4]   # 正中帧(半进位下取)
    assert plan_uniform_frames(124, 1) == [61]  # H3 常态 124 帧口径


def test_uniform_endpoints_and_exact_vectors():
    assert plan_uniform_frames(10, 2) == [0, 9]  # 恒含首尾
    assert plan_uniform_frames(10, 3) == [0, 5, 9]
    assert plan_uniform_frames(124, 6) == [0, 25, 49, 74, 98, 123]  # H3 六候选
    assert plan_uniform_frames(4, 3) == [0, 2, 3]  # (i*3+1)//2: 0,2,3


@pytest.mark.parametrize("total,count", [
    (1, 1), (2, 1), (10, 3), (124, 6), (124, 60), (999, 4), (7, 7), (5, 512)])
def test_uniform_invariants(total, count):
    """四不变量:数量精确、界内、严格递增(不重复)、首尾恒在(当 count≥2)。"""
    indices = plan_uniform_frames(total, count)
    expected = min(count, total)
    assert len(indices) == expected
    assert all(0 <= i < total for i in indices)
    assert indices == sorted(set(indices))
    if expected >= 2:
        assert indices[0] == 0 and indices[-1] == total - 1


# ── 头部/尾部抽帧:截断语义 ─────────────────────────────────
def test_head_and_tail_slice_and_clamp():
    assert plan_head_frames(10, 3) == [0, 1, 2]
    assert plan_head_frames(4, 9) == [0, 1, 2, 3]  # 超出取全帧
    assert plan_tail_frames(10, 3) == [7, 8, 9]
    assert plan_tail_frames(4, 9) == [0, 1, 2, 3]
    assert plan_head_frames(124, 1) == [0]
    assert plan_tail_frames(124, 1) == [123]


# ── 策略分发与校验:中文报错 ────────────────────────────────
def test_plan_frames_dispatches_each_strategy():
    total, count = 10, 3
    assert plan_frames("均匀 · 等距N帧", total, count) == [0, 5, 9]
    assert plan_frames("头部 · 前N帧", total, count) == [0, 1, 2]
    assert plan_frames("尾部 · 后N帧", total, count) == [7, 8, 9]


def test_plan_frames_unknown_strategy_lists_options():
    with pytest.raises(ValueError, match="未知抽帧策略") as ei:
        plan_frames("每隔一秒", 10, 3)
    message = str(ei.value)
    for mode in STRATEGY_NAMES:  # 报错枚举全部合法策略
        assert mode in message


@pytest.mark.parametrize("total,count", [(0, 3), (-2, 3), (2.5, 1), (True, 1)])
def test_validate_rejects_bad_total_frames(total, count):
    with pytest.raises(ValueError, match="源视频帧数无效"):
        plan_frames("均匀 · 等距N帧", total, count)


@pytest.mark.parametrize("count", [0, -1, 2.5, True])
def test_validate_rejects_bad_frame_count(count):
    with pytest.raises(ValueError, match="frame_count"):
        plan_frames("均匀 · 等距N帧", 10, count)


def test_validate_rejects_over_cap_frame_count():
    with pytest.raises(ValueError, match="上限 512"):
        plan_frames("均匀 · 等距N帧", 10, 513)


# ── 命名口径:帧标识与 ComfyUI 计数器解析兼容 ─────────────────
def test_frame_suffixes_keep_frame_index():
    assert frame_suffixes([0, 25, 123, 12345]) == [
        "f00000", "f00025", "f00123", "f12345"]


def test_frame_filenames_pattern():
    assert frame_filenames("mf", 3, [0, 61]) == [
        "mf_00003_f00000.png", "mf_00003_f00061.png"]


def test_frame_filenames_parse_under_comfyui_counter_semantics():
    """文件名计数器段须可被 folder_paths.map_filename 解析(防覆盖自增成立)。"""
    def _counter_digits(prefix: str, filename: str) -> int:
        prefix_len = len(prefix)
        remainder = filename[prefix_len + 1:]
        return int(remainder.split(".")[0].split("_")[0])

    for counter in (1, 12, 12345):
        for name in frame_filenames("my_frame_grab", counter, [0, 5, 119]):
            assert _counter_digits("my_frame_grab", name) == counter, name


# ── grab 前置守卫:引擎库介入前即报人话(不触 PIL/folder_paths)──
class _FakeComponents:
    def __init__(self, frames: int):
        self.images = np.zeros((frames, 4, 4, 3), dtype=np.float32)


class _FakeVideo:
    """假 VIDEO 输入(Input.Video 协议最小面:get_components().images)。"""

    def __init__(self, frames: int):
        self._components = _FakeComponents(frames)

    def get_components(self):
        return self._components


def test_grab_rejects_undecodable_empty_video():
    with pytest.raises(ValueError, match="源视频帧数无效"):
        MyVideoFrameGrab().grab(_FakeVideo(0), "均匀 · 等距N帧", 6, "my_frame_grab")


def test_grab_rejects_unknown_strategy_before_engine_libs():
    with pytest.raises(ValueError, match="未知抽帧策略"):
        MyVideoFrameGrab().grab(_FakeVideo(6), "每秒一帧", 6, "my_frame_grab")


# ── docstring 契约:keyframes 最后一跳与 frame_count 口径随档 ────
def test_docstring_states_keyframe_loop_contract():
    import engines.comfyui.my_nodes.nodes.my_video_frame_grab as module
    assert "最后一跳" in (module.__doc__ or "")
    assert "frame_count" in (module.__doc__ or "")
