"""Path bootstrap for comfyui tests.

Makes `from comfyui import ...` work no matter which directory
pytest is invoked from (repo root vs `apps/backend`), by putting
`apps/backend` on sys.path. Same pattern as .trellis/scripts/tests/conftest.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]  # tests/ -> comfyui/ -> backend

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# comfy_api sidecar 桩已上移 comfyui/ 层 conftest(v3 io 节点类定义期
# 顶层 import comfy_api.latest,须先于任何 comfyui.my_nodes 导入垫好;
# 本文件在包外路径自举后不再重复装桩,见 ../conftest.py)。
