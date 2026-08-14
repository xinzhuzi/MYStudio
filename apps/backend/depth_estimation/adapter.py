"""Depth estimation adapter — runs the Depth Anything V2 Small model.

Called by worker.py; raises DepthEstimationError on failure.

Model download policy: the model is NEVER auto-downloaded here. Downloads are
user-initiated from the settings panel via download_model.py. Inference fails
with code "model-not-downloaded" when the model is missing from the cache so
the UI can surface an actionable warning.
"""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from .model_cache import DEPTH_MODELS, find_cached_depth_model


class DepthEstimationError(Exception):
    """Typed error with a code + message for the worker artifact."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _model_spec(model: str):
    spec = DEPTH_MODELS.get(model)
    if not spec:
        raise DepthEstimationError("unknown-model", f"未知深度估计模型: {model}")
    return spec


def _model_cache_dir() -> str:
    return (
        os.environ.get("MYSTUDIO_DEPTH_MODEL_DIR", "").strip()
        or os.environ.get("MANYING_TTS_MODELS_DIR", "").strip()
    )


def _require_model_downloaded(model: str) -> None:
    """Fail closed when the model is not present in the cache.

    NEVER triggers a download — the user must download it explicitly from the
    settings panel (设置 → 本地配置 → 深度估计模型).
    """
    spec = _model_spec(model)
    cached = find_cached_depth_model(spec["repo_ids"])
    if not cached:
        raise DepthEstimationError(
            "model-not-downloaded",
            f"深度估计模型 {spec['label']} 未下载。请前往 设置 → 本地配置 → 深度估计模型 下载。",
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_model(model: str):
    """Load the depth estimation model via transformers pipeline (downloaded files only)."""
    spec = _model_spec(model)
    _require_model_downloaded(model)

    try:
        from transformers import pipeline as hf_pipeline
    except ImportError as exc:
        raise DepthEstimationError("transformers-missing", f"transformers 库未安装: {exc}") from exc

    cache_dir = _model_cache_dir()
    try:
        kwargs: dict[str, Any] = {"local_files_only": True}
        if cache_dir:
            kwargs["cache_dir"] = cache_dir
        pipe = hf_pipeline(task="depth-estimation", model=spec["repo_id"], **kwargs)
        return pipe
    except Exception as exc:
        # local_files_only surfaces network-free cache misses as OSError; unify them.
        raise DepthEstimationError("model-not-downloaded", f"模型 {spec['label']} 缓存不可用: {exc}") from exc


def estimate_depth(
    input_path: str,
    output_path: str,
    model: str,
) -> dict[str, Any]:
    """Run depth estimation on a single image and write the depth-map PNG.

    Returns a dict with the artifact fields (status, sha256, dimensions, etc.).
    Raises DepthEstimationError on any failure — notably "model-not-downloaded"
    when the model was never explicitly downloaded from the settings panel.
    """
    input_file = Path(input_path)
    output_file = Path(output_path)

    if not input_file.exists():
        raise DepthEstimationError("input-not-found", f"输入图片不存在: {input_path}")

    input_sha = _sha256(input_file)
    start = time.time()

    # Fail fast when the model is missing, before any heavy work.
    _require_model_downloaded(model)

    try:
        image = Image.open(input_file).convert("RGB")
    except Exception as exc:
        raise DepthEstimationError("image-load-failed", f"图片加载失败: {exc}") from exc

    width, height = image.size

    pipe = _load_model(model)
    try:
        result = pipe(image)
    except Exception as exc:
        raise DepthEstimationError("inference-failed", f"深度推理失败: {exc}") from exc

    if isinstance(result, dict) and "predicted_depth" in result:
        depth_tensor = result["predicted_depth"]
    elif isinstance(result, list) and len(result) > 0 and isinstance(result[0], dict) and "predicted_depth" in result[0]:
        depth_tensor = result[0]["predicted_depth"]
    else:
        raise DepthEstimationError("unexpected-output", f"模型返回格式异常: {type(result)}")

    if hasattr(depth_tensor, "numpy"):
        depth_np = depth_tensor.numpy()
    elif hasattr(depth_tensor, "detach"):
        depth_np = depth_tensor.detach().cpu().numpy()
    else:
        depth_np = np.array(depth_tensor)

    depth_np = np.squeeze(depth_np)
    if depth_np.ndim != 2:
        raise DepthEstimationError("depth-shape", f"深度图维度异常: {depth_np.shape}, 期望 2D")

    d_min = float(depth_np.min())
    d_max = float(depth_np.max())
    if d_max - d_min < 1e-6:
        depth_norm = np.full_like(depth_np, 128, dtype=np.uint8)
    else:
        depth_norm = ((depth_np - d_min) / (d_max - d_min) * 255).astype(np.uint8)

    depth_image = Image.fromarray(depth_norm, mode="L")
    output_file.parent.mkdir(parents=True, exist_ok=True)
    depth_image.save(output_file, format="PNG")

    output_sha = _sha256(output_file)
    elapsed = time.time() - start

    norm_min = d_min / 255.0 if d_max > 1e-6 else 0.0
    norm_max = d_max / 255.0 if d_max > 1e-6 else 0.0

    return {
        "status": "accepted",
        "inputSha256": input_sha,
        "outputSha256": output_sha,
        "outputPath": str(output_file.resolve()),
        "width": width,
        "height": height,
        "depthRange": {"min": round(norm_min, 6), "max": round(norm_max, 6)},
        "elapsedSeconds": round(elapsed, 3),
    }


def probe_model() -> dict[str, Any]:
    """Probe whether the model is cached and loadable (for --probe).

    Distinguishes "model-not-downloaded" (actionable in the UI) from other
    load failures so the settings panel can show the download button.
    """
    try:
        spec = _model_spec("depth-anything-v2-small")
        cached = find_cached_depth_model(spec["repo_ids"])
        if not cached:
            return {
                "status": "blocked",
                "code": "model-not-downloaded",
                "message": f"深度估计模型 {spec['label']} 未下载，请前往设置下载",
                "cacheDir": _model_cache_dir() or "(default)",
            }
        return {
            "status": "ready",
            "model": "depth-anything-v2-small",
            "sizeMb": cached["size_mb"],
            "cacheDir": _model_cache_dir() or "(default)",
        }
    except DepthEstimationError as exc:
        return {"status": "blocked", "code": exc.code, "message": exc.message}
    except Exception as exc:
        return {"status": "blocked", "code": "probe-failed", "message": str(exc)}
