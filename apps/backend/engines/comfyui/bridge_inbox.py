# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 回写收件箱(manying_generated → sidecar;swap 阶段1)。

引擎侧自定义节点执行完成后 POST 图像(b64)+meta 到本 sidecar;逐条落盘
<comfyui-home>/bridge-inbox/(sidecar 重启不丢);渲染层 cursor 轮询消费、
ack 清理。台账/资产库/分镜落账仍在渲染层既有链(口径不变),本箱只转运。
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

from . import manifest as cm

_LOCK = threading.Lock()


def _inbox_dir() -> Path:
    directory = cm.comfy_home() / "bridge-inbox"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _ids() -> list[int]:
    return [int(p.stem) for p in _inbox_dir().glob("*.json") if p.stem.isdigit()]


def append(meta: dict, blob_b64: str, field: str = "imageB64") -> int:
    if field not in {"imageB64", "videoB64"}:
        raise ValueError("回写载荷字段不支持")
    with _LOCK:
        item_id = (max(_ids()) + 1) if _ids() else 1
        payload = {"id": item_id, **meta, field: blob_b64}
        (_inbox_dir() / f"{item_id:08d}.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return item_id


def list_since(cursor: int, *, include_image: bool = True) -> dict:
    items = []
    for path in sorted(_inbox_dir().glob("*.json")):
        if not path.stem.isdigit() or int(path.stem) <= cursor:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not include_image:
            data.pop("imageB64", None)
            data.pop("videoB64", None)
        items.append(data)
    return {"cursor": max(_ids(), default=cursor), "items": items}


def ack(up_to: int) -> int:
    deleted = 0
    with _LOCK:
        for path in _inbox_dir().glob("*.json"):
            if path.stem.isdigit() and int(path.stem) <= up_to:
                path.unlink(missing_ok=True)
                deleted += 1
    return deleted
