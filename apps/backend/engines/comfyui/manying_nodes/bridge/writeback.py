# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""成图回写传输:tensor batch → PNG b64 → POST sidecar /comfy/bridge/writeback。"""

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


def deliver(images, shot_target: str, prompt: str, meta: str) -> dict:
    if images is None or len(images) == 0:
        raise RuntimeError("成图回写收到空图像,请检查上游连线")

    from PIL import Image

    frame = images[0]
    for op in ("detach", "clamp", "cpu"):
        frame = getattr(frame, op)() if callable(getattr(frame, op, None)) else frame
    array = (frame.numpy() * 255.0).round().astype("uint8")
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")

    payload = {
        "client": "manying-nodes",
        "shotTarget": shot_target or "",
        "prompt": prompt or "",
        "meta": _safe_meta(meta),
        "imageB64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "ts": int(time.time() * 1000),
    }
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
        raise RuntimeError(f"成图回写失败(联系不上漫影软件):{exc};请确认漫影在运行后重试") from exc
    if not body.get("accepted"):
        raise RuntimeError(f"成图回写被拒:{body}")
    return body
