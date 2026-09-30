# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""AB_COMPARE_TOKENS 跨侧常量互锁测试(0930 B2 加固役;0929 深审发现 4)。

token 单源=web/theme.js AB_COMPARE_TOKENS(0929 收编:尺寸/配色/档位全走它,
前端两件零散落魔法数);py 侧节点件持有同名源常量(倍率档位/区间/漂移容限)。
两侧各自演进无人对账=漂移静默——本测试锁互锁契约:

- theme.js zoom.steps     == my_image_ab_compare.py ZOOM_STEPS(放大镜档位循环)
- theme.js zoom.min/max   == my_image_ab_compare.py ZOOM_MIN/ZOOM_MAX(倍率区间)
- theme.js driftTolerance == my_video_ab_compare.py FRAME_DRIFT_TOLERANCE(rAF 漂移容限)

形态=零运行时依赖的文本/AST 解析:theme.js 用文本解析(勿引 js 运行时),
py 侧用 ast 取模块级赋值(不 import——绕开包相对导入与引擎库依赖),
系统 python3 直跑亦可:python3 test_ab_compare_tokens_sync.py。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

_MY_NODES = Path(__file__).resolve().parents[1]
_THEME_JS = _MY_NODES / "web" / "theme.js"
_IMAGE_PY = _MY_NODES / "nodes" / "my_image_ab_compare.py"
_VIDEO_PY = _MY_NODES / "nodes" / "my_video_ab_compare.py"


def _ab_tokens_block() -> str:
    """theme.js 里 AB_COMPARE_TOKENS 的对象字面量文本(大括号配对切块)。"""
    text = _THEME_JS.read_text(encoding="utf-8")
    m = re.search(r"export const AB_COMPARE_TOKENS = \{", text)
    assert m, "theme.js 未找到 AB_COMPARE_TOKENS 导出块"
    depth = 0
    start = m.end() - 1  # 从 '{' 起
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    raise AssertionError("AB_COMPARE_TOKENS 块大括号不配对(文件截尾?)")


def _py_module_constant(path: Path, name: str) -> object:
    """ast 取 py 模块级常量赋值(不 import;未找到即显式报错)。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else (
            [node.target] if isinstance(node, ast.AnnAssign) and node.value is not None else [])
        for target in targets:
            if isinstance(target, ast.Name) and target.id == name:
                return ast.literal_eval(node.value)
    raise AssertionError(f"{path.name} 未找到模块级常量 {name}")


def _zoom_literal() -> dict[str, str]:
    """AB_COMPARE_TOKENS 块内 zoom 对象的 min/max/steps 原文。"""
    block = _ab_tokens_block()
    m = re.search(r"zoom:\s*\{([^{}]+)\}", block)
    assert m, "AB_COMPARE_TOKENS 块内未找到 zoom 对象"
    inner = m.group(1)
    out: dict[str, str] = {}
    for key in ("min", "max"):
        km = re.search(rf"\b{key}:\s*([0-9.]+)", inner)
        assert km, f"zoom 对象内未找到 {key}"
        out[key] = km.group(1)
    sm = re.search(r"steps:\s*\[([^\]]*)\]", inner)
    assert sm, "zoom 对象内未找到 steps 数组"
    out["steps"] = sm.group(1)
    return out


# ── 倍率档位/区间:theme.js ↔ my_image_ab_compare.py ─────────────
def test_zoom_steps_sync_with_py():
    js_raw = _zoom_literal()["steps"]
    js_steps = [float(x) for x in js_raw.split(",")]
    assert js_steps, "zoom.steps 解析为空数组"
    py_steps = _py_module_constant(_IMAGE_PY, "ZOOM_STEPS")
    assert tuple(js_steps) == tuple(float(x) for x in py_steps), (
        f"theme.js zoom.steps={js_steps} != ZOOM_STEPS={py_steps}"
        "(放大镜档位循环两侧漂移,画布按钮与后端校验将失同步)")


def test_zoom_range_sync_with_py():
    zoom = _zoom_literal()
    py_min = float(_py_module_constant(_IMAGE_PY, "ZOOM_MIN"))
    py_max = float(_py_module_constant(_IMAGE_PY, "ZOOM_MAX"))
    assert float(zoom["min"]) == py_min, (
        f"theme.js zoom.min={zoom['min']} != ZOOM_MIN={py_min}")
    assert float(zoom["max"]) == py_max, (
        f"theme.js zoom.max={zoom['max']} != ZOOM_MAX={py_max}")


# ── rAF 漂移容限:theme.js ↔ my_video_ab_compare.py ──────────────
def test_drift_tolerance_sync_with_py():
    block = _ab_tokens_block()
    m = re.search(r"\bdriftTolerance:\s*([0-9.]+)", block)
    assert m, "AB_COMPARE_TOKENS 块内未找到 driftTolerance"
    js_drift = float(m.group(1))
    py_drift = float(_py_module_constant(_VIDEO_PY, "FRAME_DRIFT_TOLERANCE"))
    assert js_drift == py_drift, (
        f"theme.js driftTolerance={js_drift} != "
        f"FRAME_DRIFT_TOLERANCE={py_drift}(前端校正门与后端口径漂移)")


if __name__ == "__main__":
    _tests = [v for k, v in sorted(globals().items())
              if k.startswith("test_") and callable(v)]
    _failed = 0
    for _t in _tests:
        try:
            _t()
            print(f"PASS {_t.__name__}")
        except AssertionError as _e:
            _failed += 1
            print(f"FAIL {_t.__name__}: {_e}")
    print(f"\n{len(_tests) - _failed}/{len(_tests)} PASS")
    raise SystemExit(1 if _failed else 0)
