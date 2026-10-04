# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyVideoABCompare 契约测试(0929 TE-MAN 排查 B2 仿写件;源码位 sidecar
零引擎依赖,纯逻辑直测;解码落盘重路径不单测,归实弹阶段引擎现场冒烟)。

锁:注册面(双表+类目+无旧名别名)/widget 面(双 VIDEO 直连透传=同包
my_video_frame_grab 的 Input.Video.get_components 口径)/输出面(VIDEO
双出透传+OUTPUT_NODE 终端锚)/声道枚举(A/B/静音三态闭集+默认 A)/
帧对齐换算(帧号↔秒互逆、同帧号两路帧率不同各自换算、越界夹取)/
校验中文报错(帧率/帧数/帧号)/模块级零重依赖(AST 静态锁)/docstring
契约(syncToken 防竞态+帧对齐+全量解码警示随档)。
"""

from __future__ import annotations

import ast
import math
from fractions import Fraction
from pathlib import Path

import numpy as np
import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from engines.comfyui.my_nodes.nodes.my_video_ab_compare import (
    AUDIO_CHANNELS, DEFAULT_AUDIO_KEY, DEFAULT_CURTAIN, FRAME_DRIFT_TOLERANCE,
    MyVideoABCompare, aligned_time, alignment_frame_range, clamp_ratio,
    frame_to_time, time_to_frame, validate_frame_rate)

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
def test_registry_exposes_video_ab_compare():
    assert NODE_CLASS_MAPPINGS.get("MyVideoABCompare") is MyVideoABCompare
    assert NODE_DISPLAY_NAME_MAPPINGS["MyVideoABCompare"] == "漫影 视频对比审片"
    assert MyVideoABCompare.CATEGORY == "漫影"
    # 设计裁定:新节点无存量工作流,不建 Manying 旧名别名
    assert "ManyingVideoABCompare" not in NODE_CLASS_MAPPINGS


def test_widget_surface_direct_passthrough_inputs():
    spec = MyVideoABCompare.INPUT_TYPES()
    assert set(spec) == {"required", "optional"}
    assert set(spec["required"]) == {"video_a", "video_b"}
    # 核心线型 VIDEO:LoadVideo/视频产出节点直供(同包 my_video_frame_grab 口径)
    assert spec["required"]["video_a"][0] == "VIDEO"
    assert spec["required"]["video_b"][0] == "VIDEO"
    assert set(spec["optional"]) == {"label_a", "label_b"}
    assert spec["optional"]["label_a"][1]["default"] == "A"
    assert spec["optional"]["label_b"][1]["default"] == "B"


def test_output_shape_passthrough_and_anchor():
    assert MyVideoABCompare.RETURN_TYPES == ("VIDEO", "VIDEO")
    assert MyVideoABCompare.RETURN_NAMES == ("video_a", "video_b")
    assert MyVideoABCompare.FUNCTION == "compare"
    assert MyVideoABCompare.OUTPUT_NODE is True


# ── 声道枚举:A/B/静音三态闭集 ───────────────────────────────
def test_audio_channels_closed_set_with_default():
    assert [key for _name, key in AUDIO_CHANNELS] == ["a", "b", "mute"]
    assert DEFAULT_AUDIO_KEY == "a"
    for name, _key in AUDIO_CHANNELS:
        assert " \u00b7 " in name, name  # 分隔符码位锁:U+00B7(随包内 combo 先例)


def test_frame_drift_tolerance_is_small_positive():
    assert 0 < FRAME_DRIFT_TOLERANCE <= 1.0  # 漂移容限秒级带内(半秒档)


# ── 帘位:0-1 夹取(非数兜回正中)────────────────────────────
@pytest.mark.parametrize("value,expected", [
    (0.0, 0.0), (1.0, 1.0), (0.5, 0.5), (-0.2, 0.0), (2.0, 1.0),
    (math.nan, DEFAULT_CURTAIN), (None, DEFAULT_CURTAIN)])
def test_clamp_ratio_bounds(value, expected):
    assert clamp_ratio(value) == expected


# ── 帧率校验:正有限数(Fraction 兼容),违例中文报错 ─────────────
@pytest.mark.parametrize("rate", [0, -25, math.inf, -math.inf, math.nan, "x", None])
def test_validate_frame_rate_rejects_bad(rate):
    with pytest.raises(ValueError, match="帧率无效"):
        validate_frame_rate(rate)


@pytest.mark.parametrize("rate,expected", [
    (25, 25.0), (12.5, 12.5), (Fraction(25, 1), 25.0),
    (Fraction(25, 2), 12.5), ("25", 25.0)])
def test_validate_frame_rate_accepts(rate, expected):
    assert validate_frame_rate(rate) == expected


# ── 帧对齐换算:帧号 ↔ 秒(H3 常态 124 帧/12.5fps 口径)──────────
def test_frame_to_time_exact_vectors():
    assert frame_to_time(25, 12.5) == pytest.approx(2.0)
    assert frame_to_time(0, 25) == 0.0
    assert frame_to_time(123, Fraction(25, 1)) == pytest.approx(4.92)
    with pytest.raises(ValueError, match="帧号"):
        frame_to_time(-1, 25)
    with pytest.raises(ValueError, match="帧号"):
        frame_to_time("x", 25)


def test_time_to_frame_rounds_and_clamps():
    assert time_to_frame(2.0, 12.5, 100) == 25
    assert time_to_frame(1.96, 12.5, 100) == 25  # 四舍五入
    assert time_to_frame(1.94, 12.5, 100) == 24
    assert time_to_frame(999.0, 12.5, 124) == 123  # 越界夹到末帧
    assert time_to_frame(-5.0, 12.5, 124) == 0
    assert time_to_frame(math.nan, 12.5, 124) == 0  # NaN 兜回首帧
    with pytest.raises(ValueError, match="帧数无效"):
        time_to_frame(1.0, 12.5, 0)
    with pytest.raises(ValueError, match="时间须为数"):
        time_to_frame("x", 12.5, 124)


def test_aligned_time_same_frame_different_rates():
    """帧对齐语义:同一共享帧号,两路各自按自身帧率换算(帧率可不同)。"""
    assert aligned_time(50, 25.0, 124) == pytest.approx(2.0)
    assert aligned_time(50, 12.5, 124) == pytest.approx(4.0)
    # 越界帧号夹到该路末帧时刻(短路人没有的对齐帧不越界 seek)
    assert aligned_time(500, 25.0, 124) == pytest.approx(123 / 25.0)
    assert aligned_time(0, 25.0, 124) == 0.0


def test_alignment_frame_range_takes_shorter_side():
    assert alignment_frame_range(124, 100) == 100
    assert alignment_frame_range(8, 124) == 8
    with pytest.raises(ValueError, match="B 路源视频帧数无效"):
        alignment_frame_range(124, 0)


# ── compare 前置守卫:引擎库介入前即报人话(不触 folder_paths)────
class _FakeComponents:
    def __init__(self, frames: int, frame_rate: object):
        self.images = np.zeros((frames, 4, 4, 3), dtype=np.float32)
        self.frame_rate = frame_rate
        self.audio = None


class _FakeVideo:
    """假 VIDEO 输入(Input.Video 协议最小面:get_components())。"""

    def __init__(self, frames: int, frame_rate: object = 25):
        self._components = _FakeComponents(frames, frame_rate)

    def get_components(self):
        return self._components


def test_compare_rejects_undecodable_empty_video():
    with pytest.raises(ValueError, match="帧数无效"):
        MyVideoABCompare().compare(_FakeVideo(0), _FakeVideo(8))


def test_compare_rejects_bad_frame_rate_before_engine_libs():
    with pytest.raises(ValueError, match="帧率无效"):
        MyVideoABCompare().compare(_FakeVideo(8), _FakeVideo(8, frame_rate=0))


# ── 模块级零重依赖:AST 静态锁(folder_paths 只准函数内懒加载)────
def test_heavy_imports_are_function_lazy_only():
    offenders = _module_level_heavy_imports(_NODES_DIR / "my_video_ab_compare.py")
    assert offenders == [], f"my_video_ab_compare.py 模块级出现重依赖 import:{offenders}"


# ── docstring 契约:同步/帧对齐/解码警示随档 ─────────────────────
def test_docstring_states_sync_and_decode_contract():
    import engines.comfyui.my_nodes.nodes.my_video_ab_compare as module
    text = module.__doc__ or ""
    for anchor in ("syncToken", "帧对齐", "get_components", "全量解码",
                   "声道切换", "node.properties"):
        assert anchor in text, anchor
