"""Diffusion pipeline — thin dispatcher(08-31 重构:每引擎独立模块)。

本文件只做:① PipelineError ② generate_image 统一入口(按 layout 分派
到 engines/<name>.py 的 generate)。引擎自身装配/生成/LoRA 全在 engines/。
"""
from __future__ import annotations

import base64
import io
import threading
from typing import Any

from .model_cache import (
    IMAGE_MODELS,
    comfyui_models_dir,
    hf_snapshot_dir,
    resolve_image_model_name,
    find_cached_image_model_for_spec,
)
from .engines import krea2 as _krea2
from .engines import flux2 as _flux2
from .engines import z_image as _z_image
from .engines import qwen as _qwen

_lock = threading.Lock()

ASPECT_RATIOS: dict[str, tuple[int, int]] = {
    "1:1": (1024, 1024), "16:9": (1152, 640), "9:16": (640, 1152),
    "4:3": (1072, 808), "3:4": (808, 1072),
}
RESOLUTION_SCALES: dict[str, float] = {"512": 0.5, "768": 0.75, "1024": 1.0, "2048": 1.5}


class PipelineError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


_ENGINE_BY_LAYOUT = {
    "krea2-pointed": _krea2,
    "flux2-pointed": _flux2,
    "z-image-pointed": _z_image,
    "qwen-pointed": _qwen,
}


def _require_downloaded(model_name: str) -> None:
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        raise PipelineError("unknown-model", f"未知图像模型: {model_name}")
    cached = find_cached_image_model_for_spec(spec)
    if not cached:
        raise PipelineError(
            "model-not-downloaded",
            f"图像模型 {spec['label']} 未就绪。请前往 设置 → 本地配置 → 本地图片生成 检查。",
        )


def generate_image(
    model_name: str,
    prompt: str,
    aspect_ratio: str = "1:1",
    resolution: str = "1024",
    negative_prompt: str | None = None,
    num_inference_steps: int | None = None,
    seed: int | None = None,
    reference_image_b64: str | None = None,
    strength: float = 0.55,
) -> str:
    """Generate an image and return it as base64 PNG."""
    model_name = resolve_image_model_name(model_name)
    spec = IMAGE_MODELS[model_name]
    layout = spec.get("layout", "")

    _require_downloaded(model_name)

    engine = _ENGINE_BY_LAYOUT.get(layout)
    if engine is None:
        raise PipelineError("unknown-model", f"未知布局: {layout}")

    steps = num_inference_steps or spec["steps"]

    # 构建引擎上下文(各引擎从 ctx 取自己需要的路径)
    models_dir = comfyui_models_dir()
    snapshot_dir = hf_snapshot_dir(
        engine.SMALL_REPO if hasattr(engine, "SMALL_REPO") else engine.IMAGE_REPO,
    )
    ctx = {
        "models_dir": models_dir,
        "snapshot_dir": snapshot_dir,
    }
    if layout == "qwen-pointed":
        ctx["qwen_snapshot_dirs"] = {
            "Qwen/Qwen-Image": str(hf_snapshot_dir("Qwen/Qwen-Image") or ""),
            "Qwen/Qwen2.5-VL-7B-Instruct": str(hf_snapshot_dir("Qwen/Qwen2.5-VL-7B-Instruct") or ""),
        }

    try:
        return engine.generate(
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            negative_prompt=negative_prompt,
            steps=steps,
            seed=seed,
            reference_b64=reference_image_b64,
            **ctx,
        )
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError("inference-failed", f"图像生成失败: {exc}") from exc
