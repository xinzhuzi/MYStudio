# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""参考图上传转发(渲染层→引擎 input 目录;同名覆写=迁移占位名闭环)。

迁移器产出的 LoadImage 占位名(my-ref-N-hash.png)在此闭环:渲染层
读项目/资产图→b64→sidecar→本模块转发引擎 /upload/image?overwrite=true
——真图以同名落进 input 目录,占位名工作流即开即跑。
"""

from __future__ import annotations

import base64
import json
import urllib.request
import uuid

from . import manifest as cm
from .engine_manager import EngineOpError


def upload_reference(image_b64: str, name: str, timeout: float = 30.0) -> dict:
    port = cm.recorded_port()
    if not port:
        raise EngineOpError("引擎还没启动过,先启动引擎再传参考图")
    try:
        raw = base64.b64decode(image_b64, validate=False)
    except Exception as exc:
        raise EngineOpError(f"参考图数据不是有效 base64:{exc}") from exc
    if not raw:
        raise EngineOpError("参考图数据为空")
    boundary = f"----my-ref-{uuid.uuid4().hex}"
    body = b"".join((
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{name}"\r\n'.encode(),
        b"Content-Type: application/octet-stream\r\n\r\n",
        raw,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ))
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/upload/image?overwrite=true",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise EngineOpError(f"参考图上传失败(引擎不可达或拒收):{exc};请确认引擎在运行") from exc
    if not isinstance(result, dict) or not result.get("name"):
        raise EngineOpError(f"引擎上传应答异常:{json.dumps(result, ensure_ascii=False)[:120]}")
    return result
