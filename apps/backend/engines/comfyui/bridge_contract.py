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

0928 根修(环a):import 时求值的 BRIDGE_TOKEN 在无该 env 的宿主进程里
(keeper/终端拉起的 engine_manager)恒为空串,spawn 注入空令牌=引擎侧栏
打桥恒 403(引擎 env 存活期不可变)。resolve_bridge_token() 把令牌决议
推迟到 spawn/收编时刻:env 优先,缺则读 sidecar config.json 的
controlToken(electron main 落盘的装机令牌真源,见
image-gen-runtime-controller getControlToken)——keeper 路线由此拿到与
侧车一致的令牌,空令牌引擎自源头绝迹。
"""
from __future__ import annotations

import json
import os

BRIDGE_TOKEN_ENV = "MANYING_LOCAL_IMAGE_TOKEN"
BRIDGE_URL = "http://127.0.0.1:17595"
BRIDGE_TOKEN = os.environ.get(BRIDGE_TOKEN_ENV, "")


def sidecar_control_token() -> str:
    """装机令牌落盘真源:sidecar config.json 的 controlToken(读不到=空串)。

    路径=<userData>/python/profiles/image-gen/config.json(与 electron main
    侧 configPath() 同一布局);<userData> 解析复用 manifest.user_data_root()
    ——托管 python/venv(符号链回托管解释器)布局下两侧同根。令牌本就落盘
    在用户目录,此处读盘不扩攻击面(0924 H5 目标=公开仓库零令牌字面量)。
    """
    try:
        from engines.comfyui import manifest as _cm  # 懒加载:manifest 不回引本模块,零循环

        config_path = _cm.user_data_root() / "python" / "profiles" / "image-gen" / "config.json"
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    token = data.get("controlToken") if isinstance(data, dict) else None
    return token if isinstance(token, str) else ""


def resolve_bridge_token() -> str:
    """spawn/收编时刻的令牌决议:① env(侧车常驻路径)② config.json
    controlToken(keeper/终端宿主路径)。双缺=空串(与旧 BRIDGE_TOKEN 同为
    fail-closed,不自愈空转)。"""
    token = os.environ.get(BRIDGE_TOKEN_ENV, "")
    if token:
        return token
    return sidecar_control_token()
