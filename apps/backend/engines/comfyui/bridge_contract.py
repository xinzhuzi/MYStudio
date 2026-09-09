# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 回写契约单源(swap 阶段1):manying_generated → sidecar 17595。

BRIDGE_TOKEN 与 image_gen/server.py LOCAL_TOKEN 同源——server 启动时
assert 防漂移(两侧各改各的=回写全拒);URL 端口与 image_gen.LOCAL_IMAGE_PORT
配对,跨域禁 import(engine 域不引模态包),改端口两处同步。
"""
from __future__ import annotations

BRIDGE_URL = "http://127.0.0.1:17595"
BRIDGE_TOKEN = "manying-local-image"
