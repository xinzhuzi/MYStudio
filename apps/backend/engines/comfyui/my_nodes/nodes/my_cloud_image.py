# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影云端生图节点:prompt → 云中继(17596) → 漫影云链 → IMAGE。

云端产线收编(09-10 用户裁定):ComfyUI 自带云端 API 节点/登录随
--disable-api-nodes 退役,云端生图统一走漫影自有账号与计费——引擎侧
只认中继(env 注入),账号/供应商/兜底链/计费全部在漫影应用内,画布
用户零登录。请求失败抛大白话=画布可见执行错误(探测期禁轰炸例外:
这是用户显式运行的工作流节点,报错即所见)。
"""

from __future__ import annotations

import base64
import io
import json
import urllib.error
import urllib.request

from ..bridge import settings

ASPECT_RATIOS = ["auto", "1:1", "3:4", "4:3", "9:16", "16:9"]


class MyCloudImage:
    CATEGORY = "my"
    OUTPUT_NODE = False

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"default": "", "multiline": True}),
            },
            "optional": {
                "negative_prompt": ("STRING", {"default": "", "multiline": True}),
                "aspect_ratio": (ASPECT_RATIOS, {"default": "auto"}),
                "reference": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "run"

    def run(self, prompt, negative_prompt="", aspect_ratio="auto", reference=None):
        image_bytes = request_cloud_image(
            prompt=prompt,
            negative_prompt=negative_prompt or "",
            aspect_ratio="" if aspect_ratio in ("", "auto") else aspect_ratio,
            reference_b64s=tensor_batch_to_png_b64(reference),
        )
        return (_bytes_to_image_tensor(image_bytes),)


def tensor_batch_to_png_b64(reference) -> list[str]:
    """参考图 IMAGE batch → PNG base64 列表(缩略纪律由应用侧
    prepareReferenceImagesForTransfer 执行,引擎侧只透传)。"""
    if reference is None or len(reference) == 0:
        return []
    from PIL import Image

    out: list[str] = []
    for frame in reference:
        for op in ("detach", "cpu"):
            if callable(getattr(frame, op, None)):
                frame = getattr(frame, op)()
        if callable(getattr(frame, "clamp", None)):
            frame = frame.clamp(0, 1)
        array = (frame.numpy() * 255.0).round().astype("uint8")
        buffer = io.BytesIO()
        Image.fromarray(array).save(buffer, format="PNG")
        out.append(base64.b64encode(buffer.getvalue()).decode("ascii"))
    return out


def request_cloud_image(prompt: str, negative_prompt: str, aspect_ratio: str,
                        reference_b64s: list[str] | None = None) -> bytes:
    """POST 中继 → 图字节。传输/错误面与 writeback 同范式(urllib+大白话)。"""
    payload = {
        "prompt": prompt or "",
        "negativePrompt": negative_prompt or "",
        "aspectRatio": aspect_ratio or "",
        "referenceB64s": reference_b64s or [],
    }
    request = urllib.request.Request(
        settings.cloud_relay_url() + "/v1/cloud/images/generations",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Manying-Cloud-Token": settings.cloud_relay_token(),
        },
        method="POST",
    )
    try:
        # 云端生图分钟级(undici 侧 300s 上限)+下载余量
        with urllib.request.urlopen(request, timeout=420) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(_relay_error(exc)) from exc
    except Exception as exc:
        raise RuntimeError(
            f"漫影云端通道未接通({exc});请从漫影软件内启动引擎后重试") from exc
    if not body.get("ok"):
        raise RuntimeError(f"漫影云端生图失败:{body.get('error') or body}")
    image_b64 = body.get("imageB64") or ""
    if not image_b64:
        raise RuntimeError(f"漫影云端生图失败:未返回图像({body.get('error') or body})")
    return base64.b64decode(image_b64)


def _relay_error(exc: urllib.error.HTTPError) -> str:
    try:
        detail = json.loads(exc.read().decode("utf-8")).get("error") or ""
    except Exception:
        detail = ""
    hint = f":{detail}" if detail else ""
    return f"漫影云端生图被拒(HTTP {exc.code}){hint}"


def _bytes_to_image_tensor(image_bytes: bytes):
    """PNG 字节 → [1,H,W,3] float tensor(引擎库懒加载)。"""
    from PIL import Image

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    import torch

    import numpy as np

    array = np.asarray(image).astype("float32") / 255.0
    return torch.from_numpy(array).unsqueeze(0)
