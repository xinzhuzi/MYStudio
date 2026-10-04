# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyQi21RgbaSelect 契约测试(0929 画布治理批 D6 造件;与
test_my_qi21_speed_select.py 同目录同纪律,源码位 sidecar 零引擎依赖)。

锁:注册面(双表+类目+无旧名别名)/combo 闭集(三态精确串+首项=默认=
自动,1001 ① 文案轮:自动/true/false,「自动」=原「跟随型」)/输入面
(mode=required combo、rgba_hint=optional BOOLEAN 带默认 False)/输出形状
(BOOLEAN 单出)/DESCRIPTION+tooltip 随档/真值表全枚举(自动透传含
None=保守关;true 恒 True;false 恒 False,强制两态不理 rgba_hint)/
未知档位枚举报错/模块级零重依赖(AST 静态锁)。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from engines.comfyui.my_nodes.nodes.my_qi21_rgba_select import (
    DEFAULT_MODE, MODES, RGBA_MODES, MyQi21RgbaSelect)

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
def test_registry_exposes_rgba_select():
    assert NODE_CLASS_MAPPINGS.get("MyQi21RgbaSelect") is MyQi21RgbaSelect
    assert NODE_DISPLAY_NAME_MAPPINGS["MyQi21RgbaSelect"] == \
        "Q2-1 RGBA透明开关(三选一·默认自动)"  # 与 MyQi21SpeedSelect 显示名同构
    assert MyQi21RgbaSelect.CATEGORY == "漫影"  # 类目随包内现行目录(兄弟件同区)
    # 设计裁定:新节点无存量工作流,不建 Manying 旧名别名
    assert "ManyingQi21RgbaSelect" not in NODE_CLASS_MAPPINGS


# ── combo 闭集:三态精确串+首项=默认=自动(1001 ① 文案轮)──────────
def test_combo_closed_set_first_item_is_default_follow():
    spec = MyQi21RgbaSelect.INPUT_TYPES()
    assert set(spec) == {"required", "optional"}
    assert set(spec["required"]) == {"mode"}
    assert set(spec["optional"]) == {"rgba_hint"}
    combo = spec["required"]["mode"]
    assert isinstance(combo[0], list)
    assert combo[0] == ["自动", "true", "false"]  # 1001 ① 三串,零分隔符零前导号
    assert combo[1]["default"] == "自动"  # 首项=默认=自动
    assert DEFAULT_MODE == MODES[0] == "自动"
    assert tuple(MODES) == RGBA_MODES
    # 三态语义随档(docstring 层):自动=透传型信号
    import engines.comfyui.my_nodes.nodes.my_qi21_rgba_select as module
    for doc in (module.__doc__, MyQi21RgbaSelect.__doc__):
        assert doc is not None
        assert "自动" in doc


def test_input_surface_optional_hint_with_default_false():
    kind, meta = MyQi21RgbaSelect.INPUT_TYPES()["optional"]["rgba_hint"]
    assert kind == "BOOLEAN"
    assert meta["default"] is False  # 未接线=保守关(与 0929 前全局默认关同向)
    assert "tooltip" in meta  # tooltip 随档(仿写件纪律)


def test_output_shape_and_description():
    assert MyQi21RgbaSelect.RETURN_TYPES == ("BOOLEAN",)
    assert MyQi21RgbaSelect.RETURN_NAMES == ("rgba_on",)
    assert MyQi21RgbaSelect.FUNCTION == "decide"
    assert MyQi21RgbaSelect.DESCRIPTION  # DESCRIPTION 随档且提及三态语义
    assert "自动" in MyQi21RgbaSelect.DESCRIPTION
    assert "手动权威" in MyQi21RgbaSelect.DESCRIPTION


# ── 真值表:三态×hint 全枚举 ────────────────────────────────
@pytest.mark.parametrize("hint,expected", [
    (True, True),    # 四型接线=开
    (False, False),  # 五型接线=关
    (None, False),   # 已接线未求值(防御)→保守关
])
def test_follow_mode_passes_hint_through(hint, expected):
    assert MyQi21RgbaSelect().decide("自动", rgba_hint=hint) == (expected,)


def test_follow_mode_unwired_defaults_to_false():
    """rgba_hint 未接线(画布缺键,kwargs 不投递)=保守关。"""
    assert MyQi21RgbaSelect().decide("自动") == (False,)


@pytest.mark.parametrize("mode,expected", [
    ("true", True),
    ("false", False),
])
@pytest.mark.parametrize("hint", [True, False, None])
def test_forced_modes_ignore_hint(mode, expected, hint):
    """强制两态=手动权威:不看 rgba_hint(含未接线也能用)。"""
    assert MyQi21RgbaSelect().decide(mode, rgba_hint=hint) == (expected,)
    assert MyQi21RgbaSelect().decide(mode) == (expected,)


def test_default_mode_follows_hint():
    """默认档=自动全语义:透传真值,不吞不改。"""
    node = MyQi21RgbaSelect()
    assert node.decide(DEFAULT_MODE, rgba_hint=True) == (True,)
    assert node.decide(DEFAULT_MODE, rgba_hint=False) == (False,)


def test_hint_coerced_to_bool():
    """防御:上游给非严格布尔(0/1)亦按真值归一,返回恒为 bool。"""
    assert MyQi21RgbaSelect().decide("自动", rgba_hint=1) == (True,)
    assert MyQi21RgbaSelect().decide("自动", rgba_hint=0) == (False,)


# ── 未知档位:枚举报错(combo 闭集的节点内兜底;/prompt 侧另有硬校验)──
def test_unknown_mode_raises_with_options():
    with pytest.raises(ValueError, match="未知透明开关档位") as ei:
        MyQi21RgbaSelect().decide("跟随型", rgba_hint=True)  # 旧串已出闭集=合法未知档
    message = str(ei.value)
    for mode in MODES:  # 报错枚举全部合法档位
        assert mode in message
    assert "重新选择" in message  # 修复指引


# ── 模块级零重依赖:AST 静态锁(本件纯逻辑,应零重库)─────────────
def test_heavy_imports_are_function_lazy_only():
    offenders = _module_level_heavy_imports(_NODES_DIR / "my_qi21_rgba_select.py")
    assert offenders == [], f"my_qi21_rgba_select.py 模块级出现重依赖 import:{offenders}"
