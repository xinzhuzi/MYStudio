# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""业务侧栏数据面(09-09 swap 阶段2 批3):渲染层推、引擎前端拉。

渲染层周期 POST 分镜快照({shots:[{id,label}]});my sidebar 扩展
(webview 内)GET 同一地址(CORS 回显+令牌头)——分镜列表由此注入
ComfyUI 原生画布侧栏,点选即回填 MyGenerated.shot_target。
09-12 功能差异补齐 B2:载荷再带队列实时快照(queue:[{index,status,progress}])
——宿主 tick 从 window.remotionQueue 投影,画布 stage-node 轮询活更徽章。
"""

from __future__ import annotations

import threading
import time

_LOCK = threading.Lock()
_STATE: dict = {"updatedAt": 0, "shots": [], "currentEpisodeId": "", "queue": []}

STALE_S = 900.0  # 渲染层停推 15 分钟后侧栏仍可显示旧快照(标注时间)
QUEUE_STATUS = ("pending", "blocked", "ready", "running", "succeeded", "failed", "canceled")


def _clean_queue(raw) -> list:
    if not isinstance(raw, list):
        return []
    clean: list = []
    for item in raw[:500]:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "")
        if status not in QUEUE_STATUS:
            continue
        try:
            progress = min(1.0, max(0.0, float(item.get("progress") or 0.0)))
        except (TypeError, ValueError):
            progress = 0.0
        entry = {"index": int(item.get("index") or 0), "status": status, "progress": round(progress, 4)}
        if entry not in clean:
            clean.append(entry)
    return clean


def update(shots: list, payload: dict | None = None) -> dict:
    if not isinstance(shots, list):
        raise ValueError("shots 必须是数组")
    clean = []
    for item in shots:
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"]:
            clean.append({
                "id": item["id"],
                "label": str(item.get("label") or item["id"])[:64],
                "episodeId": str(item.get("episodeId") or "")[:64],
                # 09-11 续:视频/画面就绪标记(分镜页签的视频分类展示)
                "videoReady": bool(item.get("videoReady")),
                "imageReady": bool(item.get("imageReady")),
            })
    if len(clean) > 500:
        raise ValueError("shots 超过 500 条上限")
    queue = _clean_queue((payload or {}).get("queue"))
    now = int(time.time() * 1000)
    with _LOCK:
        # 锁内直接组装返回值:snapshot() 也取 _LOCK,非重入 Lock 嵌套=自死锁
        _STATE["shots"] = clean
        _STATE["updatedAt"] = now
        _STATE["currentEpisodeId"] = str((payload or {}).get("currentEpisodeId") or "")[:64]
        _STATE["queue"] = queue
        return {
            "updatedAt": now,
            "staleAfterMs": int(STALE_S * 1000),
            "shots": list(clean),
            "currentEpisodeId": _STATE["currentEpisodeId"],
            "queue": list(queue),
        }


def snapshot() -> dict:
    with _LOCK:
        return {
            "updatedAt": _STATE["updatedAt"],
            "staleAfterMs": int(STALE_S * 1000),
            "shots": list(_STATE["shots"]),
            "currentEpisodeId": _STATE.get("currentEpisodeId", ""),
            "queue": list(_STATE.get("queue", [])),
        }


def reset_for_tests() -> None:
    with _LOCK:
        _STATE["shots"] = []
        _STATE["updatedAt"] = 0
        _STATE["currentEpisodeId"] = ""
        _STATE["queue"] = []
