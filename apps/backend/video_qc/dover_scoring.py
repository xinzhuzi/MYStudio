"""DOVER-Mobile scoring adapter — honest readiness gates, no fake scores.

两个独立闸门:
  1. model-not-downloaded:权重文件缺失(model_cache 校验)。
  2. arch-unavailable:vendor 架构 `dover_mobile_arch.py` 缺失。

任一闸门未过 → VideoQcError(blocked),QC 链把 aesthetic 层标
skipped-model-missing / skipped-arch-unavailable。权重+架构齐后,
score_video 按 DOVER 官方口径输出 fused ∈ [0,1]，并保留
aesthetic/technical 的有限 raw head 分数。
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from .model_cache import find_cached_video_qc_model

DEFAULT_MODEL = "dover-mobile"


class VideoQcError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _arch_available() -> bool:
    return (Path(__file__).parent / "dover_mobile_arch.py").is_file()


def probe_model() -> dict[str, Any]:
    cached = find_cached_video_qc_model(DEFAULT_MODEL)
    if not cached:
        return {
            "status": "blocked",
            "code": "model-not-downloaded",
            "message": "观感评分模型未下载(设置页显式下载)",
        }
    if not _arch_available():
        return {
            "status": "blocked",
            "code": "arch-unavailable",
            "message": "推理架构未 vendor(dover_mobile_arch.py 缺失,见 dover_scoring.py 头注)",
        }
    return {"status": "ready", "file": cached["file_path"], "sizeMb": cached["size_mb"]}


def score_video(request: dict[str, Any]) -> dict[str, Any]:
    """request: {projectId, chapterId, videoPath, mode: whole|slices, slices?}

    slices 模式先出整片分(官方同一 scorer),再逐镜窗口评分;切片参数
    非法直接 invalid-slices fail-closed,不静默跳过。"""
    started = time.time()
    probe = probe_model()
    if probe["status"] != "ready":
        raise VideoQcError(probe["code"], probe["message"])

    mode = str(request.get("mode", "whole"))
    if mode not in ("whole", "slices"):
        raise VideoQcError("invalid-mode", f"mode 必须是 whole|slices: {mode}")

    video_path = request.get("videoPath")
    if not isinstance(video_path, str) or not video_path:
        raise VideoQcError("missing-video-path", "videoPath 缺失或为空")

    if mode == "slices":
        # fail-closed 先行:切片参数非法直接拒,不进推理(官方 scorer 代价高)。
        requested = request.get("slices") or []
        for item in requested:
            if not isinstance(item, dict) or not item.get("shotId") \
                    or not isinstance(item.get("startS"), (int, float)) \
                    or not isinstance(item.get("durationS"), (int, float)) \
                    or item["durationS"] <= 0:
                raise VideoQcError(
                    "invalid-slices",
                    "slices 需要每片含 shotId/startS/durationS(时长>0): "
                    f"{json.dumps(item, ensure_ascii=False, default=str)[:120]}",
                )

    # === 推理路径：架构已 vendor，保持惰性导入 ===
    import torch  # noqa: F401 — 惰性导入，probe 路径零重依赖
    from . import dover_mobile_arch as arch

    model = arch.load_model(find_cached_video_qc_model(DEFAULT_MODEL)["file_path"])

    def _elapsed_ms() -> int:
        return round((time.time() - started) * 1000)

    fused, aesthetic, technical = arch.score_frames(model, video_path)

    if mode == "whole":
        return {
            "fused": float(fused),
            "aesthetic": float(aesthetic),
            "technical": float(technical),
            "elapsedMs": _elapsed_ms(),
            "elapsed": time.time() - started,
        }

    # Orchestrator 的低于基线归因请求:逐镜 [startS, startS+durationS) 窗口评分。
    scored = []
    for item in requested:
        slice_fused, _, _ = arch.score_frames(
            model, video_path,
            start_s=float(item["startS"]), duration_s=float(item["durationS"]))
        scored.append({"shotId": str(item["shotId"]), "fused": float(slice_fused)})

    return {
        "fused": float(fused),
        "aesthetic": float(aesthetic),
        "technical": float(technical),
        "slices": scored,
        "elapsedMs": _elapsed_ms(),
        "elapsed": time.time() - started,
    }
