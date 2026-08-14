"""Diffusion pipeline management — lazy load, local files only.

Inference NEVER downloads models. A missing model raises PipelineError with
code "model-not-downloaded" so callers surface an actionable message.
"""

from __future__ import annotations

import base64
import io
import threading
from typing import Any

from .model_cache import IMAGE_MODELS, find_cached_image_model

# Aspect ratio presets (width, height) matching common storyboard ratios.
ASPECT_RATIOS: dict[str, tuple[int, int]] = {
    "1:1": (1024, 1024),
    "16:9": (1152, 640),
    "9:16": (640, 1152),
    "4:3": (1072, 808),
    "3:4": (808, 1072),
}

RESOLUTION_SCALES: dict[str, float] = {
    "512": 0.5,
    "768": 0.75,
    "1024": 1.0,
    "2048": 1.5,
}


class PipelineError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


_lock = threading.Lock()
_pipelines: dict[str, Any] = {}
_img2img_pipelines: dict[str, Any] = {}


def _require_downloaded(model_name: str) -> None:
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        raise PipelineError("unknown-model", f"未知图像模型: {model_name}")
    cached = find_cached_image_model(spec["repo_ids"])
    if not cached:
        raise PipelineError(
            "model-not-downloaded",
            f"图像模型 {spec['label']} 未下载。请前往 设置 → 本地配置 → 本地图片生成 下载。",
        )


def _get_pipeline(model_name: str):
    _require_downloaded(model_name)
    with _lock:
        if model_name in _pipelines:
            return _pipelines[model_name]

        spec = IMAGE_MODELS[model_name]
        try:
            import torch
            from diffusers import AutoPipelineForText2Image
        except ImportError as exc:
            raise PipelineError("diffusers-missing", f"diffusers/torch 未安装: {exc}") from exc

        device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
        dtype = torch.float16 if device in ("mps", "cuda") else torch.float32
        try:
            pipe = AutoPipelineForText2Image.from_pretrained(
                spec["repo_id"],
                torch_dtype=dtype,
                local_files_only=True,
            )
            pipe = pipe.to(device)
        except Exception as exc:
            raise PipelineError("model-load-failed", f"模型 {spec['label']} 加载失败: {exc}") from exc

        _pipelines[model_name] = pipe
        return pipe


def _get_img2img_pipeline(model_name: str):
    """Convert the cached t2i pipeline to img2img (reference/consistency mode)."""
    _require_downloaded(model_name)
    with _lock:
        if model_name in _img2img_pipelines:
            return _img2img_pipelines[model_name]
        t2i = _get_pipeline(model_name)
        try:
            from diffusers import AutoPipelineForImage2Image

            pipe = AutoPipelineForImage2Image.from_pipe(t2i)
        except Exception as exc:
            raise PipelineError("img2img-unavailable", f"img2img 转换失败: {exc}") from exc
        _img2img_pipelines[model_name] = pipe
        return pipe


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
    """Generate an image and return it as base64 PNG (no data: prefix).

    When reference_image_b64 is provided (raw base64, data: prefix tolerated),
    generation runs in img2img mode against the reference — the local analogue
    of the cloud reference-image flow for character/scene consistency.
    """
    spec = IMAGE_MODELS[model_name]

    width, height = ASPECT_RATIOS.get(aspect_ratio, ASPECT_RATIOS["1:1"])
    scale = RESOLUTION_SCALES.get(resolution, 1.0)
    width, height = int(width * scale), int(height * scale)
    width, height = max(512, (width // 8) * 8), max(512, (height // 8) * 8)

    steps = num_inference_steps or spec["steps"]

    import torch

    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(seed)

    init_image = None
    if reference_image_b64:
        raw = reference_image_b64
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        try:
            init_image = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
            init_image = init_image.resize((width, height))
        except Exception as exc:
            raise PipelineError("invalid-reference", f"参考图解码失败: {exc}") from exc

    pipe = _get_img2img_pipeline(model_name) if init_image is not None else _get_pipeline(model_name)

    kwargs: dict[str, Any] = {
        "prompt": prompt,
        "num_inference_steps": steps,
        "generator": generator,
    }
    if init_image is not None:
        kwargs["image"] = init_image
        kwargs["strength"] = min(0.9, max(0.1, strength))
    else:
        kwargs["width"] = width
        kwargs["height"] = height
    if negative_prompt and model_name.startswith("sdxl"):
        kwargs["negative_prompt"] = negative_prompt
    if model_name == "sdxl-turbo":
        kwargs["guidance_scale"] = 0.0

    try:
        result = pipe(**kwargs)
    except Exception as exc:
        raise PipelineError("inference-failed", f"图像生成失败: {exc}") from exc

    image = result.images[0]
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")
