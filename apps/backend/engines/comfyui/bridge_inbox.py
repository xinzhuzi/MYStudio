# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 回写收件箱(my_generated → sidecar;swap 阶段1)。

引擎侧自定义节点执行完成后 POST 图像(b64)+meta 到本 sidecar;逐条落盘
<comfyui-home>/bridge-inbox/(sidecar 重启不丢);渲染层 cursor 轮询消费、
ack 清理。台账/资产库/分镜落账仍在渲染层既有链(口径不变),本箱只转运。
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from . import manifest as cm

_LOCK = threading.Lock()
_SEQUENCE_FILE = ".sequence.json"


def _inbox_dir() -> Path:
    directory = cm.comfy_home() / "bridge-inbox"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _ids() -> list[int]:
    return [int(p.stem) for p in _inbox_dir().glob("*.json") if p.stem.isdigit()]


def _write_atomic(path: Path, payload: dict) -> None:
    # All callers hold _LOCK: a fixed, non-item temp name is safe in the
    # single ThreadingHTTPServer sidecar and survives interrupted publication.
    temporary = path.with_suffix(".json.tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    if os.name != "nt":
        # Persist the rename before publishing media or deleting legacy items.
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def _last_id(directory: Path) -> int:
    try:
        state = json.loads((directory / _SEQUENCE_FILE).read_text(encoding="utf-8"))
    except FileNotFoundError:
        state = {"lastId": 0}  # First use, including pre-sequence inboxes.
    except (ValueError, OSError) as exc:
        raise RuntimeError("回写收件箱序号无法读取，已停止写入和清理") from exc
    last_id = state.get("lastId") if isinstance(state, dict) else None
    if type(last_id) is not int or last_id < 0:
        raise RuntimeError("回写收件箱序号无效，已停止写入和清理")
    return max(last_id, max(_ids(), default=0))


def append(meta: dict, blob_b64: str, field: str = "imageB64") -> int:
    if field not in {"imageB64", "videoB64"}:
        raise ValueError("回写载荷字段不支持")
    with _LOCK:
        directory = _inbox_dir()
        item_id = _last_id(directory) + 1
        payload = {**meta, "id": item_id, field: blob_b64}
        # Reserve durably first. An interrupted append may leave a gap, but
        # an ID already returned to a renderer must never be reused.
        _write_atomic(directory / _SEQUENCE_FILE, {"lastId": item_id})
        _write_atomic(directory / f"{item_id:08d}.json", payload)
        return item_id


def list_since(cursor: int, *, include_image: bool = True) -> dict:
    with _LOCK:
        items = []
        paths = sorted(
            (path for path in _inbox_dir().glob("*.json") if path.stem.isdigit()),
            key=lambda path: int(path.stem),
        )
        for path in paths:
            item_id = int(path.stem)
            if item_id <= cursor:
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                break  # Never let cumulative ack skip an unreadable legacy item.
            if not isinstance(data, dict):
                break
            data["id"] = item_id  # Filename is the allocation/ack authority.
            if not include_image:
                data.pop("imageB64", None)
                data.pop("videoB64", None)
            items.append(data)
        return {"cursor": items[-1]["id"] if items else cursor, "items": items}


def ack(up_to: int = 0, *, ids: list[int] | None = None) -> int:
    if ids is not None and (not isinstance(ids, list) or any(type(item_id) is not int or item_id <= 0 for item_id in ids)):
        raise ValueError("回写确认 ids 必须是正整数列表")
    acknowledged = set(ids) if ids is not None else None
    deleted = 0
    with _LOCK:
        directory = _inbox_dir()
        # Upgrade legacy files before the last pending ID can disappear.
        _write_atomic(directory / _SEQUENCE_FILE, {"lastId": _last_id(directory)})
        for path in directory.glob("*.json"):
            if path.stem.isdigit() and (
                int(path.stem) in acknowledged if acknowledged is not None else int(path.stem) <= up_to
            ):
                path.unlink(missing_ok=True)
                deleted += 1
    return deleted
