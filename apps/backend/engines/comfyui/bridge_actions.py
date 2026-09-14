# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 制作动作通道(09-11 旧画布功能迁移收口):引擎漫影侧栏 → 宿主。

旧 React Flow 画布的批量制作动作(一键生图/一键生成所有视频)随渲染层退役
迁入了分镜面板;侧栏要完整体现这些功能,需要引擎 webview 能向宿主提交动作。
本箱只转运(内存队列,容量上限,不落盘):侧栏 POST 提交,宿主渲染层
cursor 轮询消费、ack 清理;执行仍在宿主既有批量钩子(零新语义)。
"""
from __future__ import annotations

import threading
import time

_LOCK = threading.Lock()
_STATE: dict = {"actions": [], "nextId": 1}

# 09-12 功能完备(用户终裁:节点功能要像之前):环节节点动作全量收编——
# 老画布 ProductionFlowNodeAction 的四个批量动作(导演规划/分镜表=付费 LLM,
# 一键生图/一键视频=既有) + 工作台重建轨道。
# 09-13 用户裁定:节点「全文/编辑」回流(每型节点查看完全+可编辑)。
ALLOWED_KINDS = (
    "generate-images",
    "generate-videos",
    "generate-director-plan",
    "generate-storyboard-table",
    "rebuild-workbench-tracks",
    "view-doc",
    "edit-doc",
    "extract-assets",
    "open-shot-video",
)
CAP = 20

# 幂等 UI 开合类:每次点击都必须送达(同 kind 不同节点是常态),豁免去重
DEDUPE_EXEMPT_KINDS = frozenset({"view-doc", "edit-doc", "open-shot-video"})


NOTE_CAP = 2000  # 补充要求字符上限(付费生成的附加指令,09-12 功能差异补齐)


def submit(kind: str, note: str = "") -> dict:
    kind = str(kind or "")
    if kind not in ALLOWED_KINDS:
        raise ValueError(f"未知动作类型:{kind}(允许:{'/'.join(ALLOWED_KINDS)})")
    note = str(note or "").strip()[:NOTE_CAP]
    now = int(time.time() * 1000)
    with _LOCK:
        # 同类未消费动作去重(付费生成类防连点双花钱;带新补充要求重提=
        # 更新在途 note,最新意图胜出,老画布同语义);文档开合类豁免
        if kind not in DEDUPE_EXEMPT_KINDS and any(item["kind"] == kind for item in _STATE["actions"]):
            existing = next(item for item in _STATE["actions"] if item["kind"] == kind)
            if note:
                existing["note"] = note
            return {"id": existing["id"], "kind": kind, "duplicate": True}
        item_id = _STATE["nextId"]
        _STATE["nextId"] += 1
        item = {"id": item_id, "kind": kind, "submittedAt": now}
        if note:
            item["note"] = note
        _STATE["actions"].append(item)
        if len(_STATE["actions"]) > CAP:
            raise ValueError(f"动作队列超过 {CAP} 条上限(宿主未消费)")
        return {"id": item_id, "kind": kind, "duplicate": False}


def list_since(cursor: int) -> dict:
    with _LOCK:
        items = [item for item in _STATE["actions"] if item["id"] > cursor]
        return {"cursor": cursor, "items": [dict(item) for item in items]}


def ack(up_to: int) -> int:
    with _LOCK:
        before = len(_STATE["actions"])
        _STATE["actions"] = [item for item in _STATE["actions"] if item["id"] > up_to]
        return before - len(_STATE["actions"])


def reset_for_tests() -> None:
    with _LOCK:
        _STATE["actions"] = []
        _STATE["nextId"] = 1
