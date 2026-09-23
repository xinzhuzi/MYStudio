# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 回写契约单源(swap 阶段1):my_generated → sidecar 17595。

BRIDGE_TOKEN 与 image_gen/server.py local_token() 同源——0924 安全收口 H5
起单源=MANYING_LOCAL_IMAGE_TOKEN env(electron main 装机生成 UUID、spawn
sidecar 时注入;两侧各改各的 env 名=回写全拒,天然自暴露)。本常量在
sidecar 进程 import 时求值,engine_manager 组 launch_env 时由此注入引擎
进程。URL 端口与 image_gen.LOCAL_IMAGE_PORT 配对,跨域禁 import(engine
域不引模态包),改端口两处同步。
"""
from __future__ import annotations

import os

BRIDGE_TOKEN_ENV = "MANYING_LOCAL_IMAGE_TOKEN"
BRIDGE_URL = "http://127.0.0.1:17595"
BRIDGE_TOKEN = os.environ.get(BRIDGE_TOKEN_ENV, "")
