# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""业务侧栏数据面(09-09 swap 阶段2 批3):渲染层推、引擎前端拉。

渲染层周期 POST 分镜快照({shots:[{id,label}]});manying sidebar 扩展
(webview 内)GET 同一地址(CORS 回显+令牌头)——分镜列表由此注入
ComfyUI 原生画布侧栏,点选即回填 ManyingGenerated.shot_target。
"""

from __future__ import annotations

import threading
import time

_LOCK = threading.Lock()
_STATE: dict = {"updatedAt": 0, "shots": []}

STALE_S = 900.0  # 渲染层停推 15 分钟后侧栏仍可显示旧快照(标注时间)


def update(shots: list) -> dict:
    if not isinstance(shots, list):
        raise ValueError("shots 必须是数组")
    clean = []
    for item in shots:
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"]:
            clean.append({
                "id": item["id"],
                "label": str(item.get("label") or item["id"])[:64],
                "episodeId": str(item.get("episodeId") or "")[:64],
            })
    if len(clean) > 500:
        raise ValueError("shots 超过 500 条上限")
    now = int(time.time() * 1000)
    with _LOCK:
        # 锁内直接组装返回值:snapshot() 也取 _LOCK,非重入 Lock 嵌套=自死锁
        _STATE["shots"] = clean
        _STATE["updatedAt"] = now
        return {
            "updatedAt": now,
            "staleAfterMs": int(STALE_S * 1000),
            "shots": list(clean),
        }


def snapshot() -> dict:
    with _LOCK:
        return {
            "updatedAt": _STATE["updatedAt"],
            "staleAfterMs": int(STALE_S * 1000),
            "shots": list(_STATE["shots"]),
        }


def reset_for_tests() -> None:
    with _LOCK:
        _STATE["shots"] = []
        _STATE["updatedAt"] = 0
