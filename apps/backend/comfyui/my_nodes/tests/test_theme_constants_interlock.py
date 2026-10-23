# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""theme.js × py 侧 AB 对比常量互锁测试(1001 遗留池清偿役;总报④)。

web/theme.js AB_COMPARE_TOKENS 的 zoom.steps / driftTolerance 与 py 侧节点件
源常量 ZOOM_STEPS / FRAME_DRIFT_TOLERANCE 是双份书写,此前仅靠注释约定同源
(theme.js:324 附近),任一侧独自演进=静默漂移——本测试锁逐值相等:

- theme.js zoom.steps     == my_image_ab_compare.py ZOOM_STEPS(放大镜档位循环)
- theme.js driftTolerance == my_video_ab_compare.py FRAME_DRIFT_TOLERANCE(rAF 漂移容限)

形态=零运行时依赖的文本/AST 解析:theme.js 用正则取值(勿引 js 运行时),
py 侧用 ast 取模块级赋值(不 import——绕开包相对导入与引擎库依赖)。
兄弟件 test_ab_compare_tokens_sync.py(0930 B2 役)锁同一契约的更全面集
(另含 zoom.min/max);本件是独立实现的第二道锁,任一侧漂移两件任一即红。
系统 python3 直跑亦可:python3 test_theme_constants_interlock.py。
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


def _js_zoom_steps() -> list[float]:
    """AB_COMPARE_TOKENS 块内 zoom.steps 数组逐值(缺项/空数组即报错)。"""
    block = _ab_tokens_block()
    m = re.search(r"zoom:\s*\{([^{}]+)\}", block)
    assert m, "AB_COMPARE_TOKENS 块内未找到 zoom 对象"
    sm = re.search(r"steps:\s*\[([^\]]*)\]", m.group(1))
    assert sm, "zoom 对象内未找到 steps 数组"
    steps = [float(x) for x in sm.group(1).split(",") if x.strip()]
    assert steps, "zoom.steps 解析为空数组"
    return steps


def _js_drift_tolerance() -> float:
    """AB_COMPARE_TOKENS 块内 driftTolerance 标量(缺项即报错)。"""
    m = re.search(r"\bdriftTolerance:\s*([0-9.]+)", _ab_tokens_block())
    assert m, "AB_COMPARE_TOKENS 块内未找到 driftTolerance"
    return float(m.group(1))


# ── 放大镜档位:theme.js zoom.steps ↔ my_image_ab_compare.py ZOOM_STEPS ──
def test_zoom_steps_interlock():
    js_steps = _js_zoom_steps()
    py_steps = [float(x) for x in _py_module_constant(_IMAGE_PY, "ZOOM_STEPS")]
    assert js_steps == py_steps, (
        f"theme.js zoom.steps={js_steps} != ZOOM_STEPS={py_steps}"
        "(放大镜档位循环两侧漂移,画布按钮与后端校验将失同步)")


# ── rAF 漂移容限:theme.js driftTolerance ↔ my_video_ab_compare.py ──────
def test_drift_tolerance_interlock():
    js_drift = _js_drift_tolerance()
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
