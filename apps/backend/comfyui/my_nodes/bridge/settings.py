# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 端点/令牌(引擎侧只读 env;launch 时由 engine_manager 注入,
与 comfyui/bridge_contract.py 同源)。"""

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
    """桥令牌(1105 根治:App 重启令牌轮换后引擎 env 快照即陈货→侧栏恒 403)。

    供 /my_bridge/config 实时下发,须每次现读文件真源(sidecar config.json
    的 controlToken,engine_task 启动注入的同源文件);文件不可读/为空才回退
    env 快照(0928 语义保留,fail-closed 不变)。注:spawn 时刻的决议序仍是
    bridge_contract.resolve_bridge_token 的 env 优先——那是"当刻快照"正确;
    本处是"活供令牌"须新鲜优先,两者场景不同。"""
    try:
        from comfyui.bridge_contract import sidecar_control_token  # 懒加载:同树无环

        fresh = sidecar_control_token()
        if fresh:
            return fresh
    except Exception:  # noqa: BLE001 — 真源不可达=回退 env 快照,不放大故障
        pass
    return os.environ.get("MYSTUDIO_BRIDGE_TOKEN") or ""


def cloud_relay_url() -> str:
    return (os.environ.get("MYSTUDIO_CLOUD_RELAY_URL") or DEFAULT_CLOUD_RELAY_URL).rstrip("/")


def cloud_relay_token() -> str:
    return os.environ.get("MYSTUDIO_CLOUD_RELAY_TOKEN") or ""
