"""pytest 引导:把 apps/backend 加进 sys.path,测试可直接 import image_gen。

运行:python3 -m pytest apps/backend/image_gen/tests -q(仓库根执行)。
"""
import sys
from pathlib import Path

BACKEND_ROOT = str(Path(__file__).resolve().parents[2])
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)
