# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 端点配置与回写传输(引擎侧,stdlib-only;懒回导供节点/测试访问)。"""

from . import settings
from . import writeback

__all__ = ["settings", "writeback"]
