"""comfyui 域 conftest:路径自举 + comfy_api sidecar 桩装载。

v3 io 节点(my_nodes 的 my_qi21_fast_encode 等 comfy_api.latest
io.ComfyNode 形)类定义期顶层 import comfy_api.latest(官方
nodes_qwen.py 同款);sidecar venv 无引擎包,必须在任何
comfyui.my_nodes 导入之前垫桩。放位铁则:不能放 my_nodes 包内——
包内 conftest 以 comfyui.my_nodes.tests.conftest 限定名导入,装载时
先执行包链 __init__(其中 :53 即 import 节点模块),桩来不及垫;故钉在
my_nodes 包之外的 comfyui/ 层(rootdir=apps、confcutdir=apps,本层
conftest 对 comfyui 域两会话(comfyui/tests、comfyui/my_nodes/tests)
均先于测试模块装载)。真引擎在场(importlib 找得到 comfy_api)时桩恒
零操作。同 pattern:comfyui/tests/conftest.py(路径自举)、
apps/backend/_comfy_api_stub.py(桩体)。
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]  # comfyui/ -> backend

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import _comfy_api_stub

_comfy_api_stub.install()
