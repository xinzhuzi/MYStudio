# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 端点/令牌(引擎侧只读 env;launch 时由 engine_manager 注入,
与 engines/comfyui/bridge_contract.py 同源)。"""

from __future__ import annotations

import os

DEFAULT_BRIDGE_URL = "http://127.0.0.1:17595"
# 云中继(09-10 云端收编):electron main 常驻 HTTP,渲染层执行漫影云链单源。
# env 由 main 经 image_gen 侧车 spawn env 注入(引擎随 os.environ 继承);
# 缺省值与 electron 侧 comfy-cloud-relay 契约配对(双侧测试断言防漂移)。
DEFAULT_CLOUD_RELAY_URL = "http://127.0.0.1:17596"


def bridge_url() -> str:
    return (os.environ.get("MYSTUDIO_BRIDGE_URL") or DEFAULT_BRIDGE_URL).rstrip("/")


def bridge_token() -> str:
    return os.environ.get("MYSTUDIO_BRIDGE_TOKEN") or ""


def cloud_relay_url() -> str:
    return (os.environ.get("MYSTUDIO_CLOUD_RELAY_URL") or DEFAULT_CLOUD_RELAY_URL).rstrip("/")


def cloud_relay_token() -> str:
    return os.environ.get("MYSTUDIO_CLOUD_RELAY_TOKEN") or ""
