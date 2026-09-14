# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""Manying 节点回写传输。"""

from __future__ import annotations

import base64
import io
import json
import time
import urllib.request

from . import settings


def _safe_meta(meta_text: str) -> dict:
    if not meta_text:
        return {}
    try:
        parsed = json.loads(meta_text)
    except Exception:
        return {"raw": meta_text}
    return parsed if isinstance(parsed, dict) else {"raw": meta_text}


def _post(payload: dict, label: str) -> dict:
    request = urllib.request.Request(
        settings.bridge_url() + "/comfy/bridge/writeback",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Manying-Image-Token": settings.bridge_token(),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"{label}回写失败(联系不上漫影软件):{exc};请确认漫影在运行后重试") from exc
    if not body.get("accepted"):
        raise RuntimeError(f"{label}回写被拒:{body}")
    return body


def deliver(images, shot_target: str, prompt: str, meta: str) -> dict:
    if images is None or len(images) == 0:
        raise RuntimeError("成图回写收到空图像,请检查上游连线")

    from PIL import Image

    frame = images[0]
    for op in ("detach", "cpu"):
        if callable(getattr(frame, op, None)):
            frame = getattr(frame, op)()
    if callable(getattr(frame, "clamp", None)):
        frame = frame.clamp(0, 1)  # 显式区间:裸 clamp() torch 直接抛错(实弹教训)
    array = (frame.numpy() * 255.0).round().astype("uint8")
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")

    payload = {
        "client": "my-nodes",
        "shotTarget": shot_target or "",
        "prompt": prompt or "",
        "meta": _safe_meta(meta),
        "imageB64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "ts": int(time.time() * 1000),
    }
    return _post(payload, "成图")


def deliver_video(shot_target: str, video_b64: str, subfolder: str, policy: str) -> dict:
    if not video_b64:
        raise RuntimeError("视频回写收到空视频,请检查上游连线")
    try:
        decoded_size = len(base64.b64decode(video_b64, validate=True))
    except Exception as exc:
        raise RuntimeError("视频回写收到无效视频数据") from exc
    if decoded_size > 64 * 1024 * 1024:
        raise RuntimeError("视频回写超过64MB限制")
    payload = {
        "client": "my-nodes",
        "shotTarget": shot_target or "",
        "prompt": "",
        "meta": {"kind": "video", "subfolder": subfolder, "policy": policy},
        "videoB64": video_b64,
        "ts": int(time.time() * 1000),
    }
    return _post(payload, "视频")
