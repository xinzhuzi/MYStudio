# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 端点/令牌(引擎侧只读 env;launch 时由 engine_manager 注入,
与 engines/comfyui/bridge_contract.py 同源)。"""

from __future__ import annotations

import os

DEFAULT_BRIDGE_URL = "http://127.0.0.1:17595"


def bridge_url() -> str:
    return (os.environ.get("MYSTUDIO_BRIDGE_URL") or DEFAULT_BRIDGE_URL).rstrip("/")


def bridge_token() -> str:
    return os.environ.get("MYSTUDIO_BRIDGE_TOKEN") or ""
