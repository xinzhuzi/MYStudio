"""DOVER-Mobile scoring adapter — honest readiness gates, no fake scores.

两个独立闸门:
  1. model-not-downloaded:权重文件缺失(model_cache 校验)。
  2. arch-unavailable:vendor 架构 `dover_mobile_arch.py` 缺失(需从
     VQAssessment/DOVER 仓库 vendor,带 LICENSE;本会话网络不可达未完成)。

任一闸门未过 → VideoQcError(blocked),QC 链把 aesthetic 层标
skipped-model-missing / skipped-arch-unavailable。权重+架构齐后,
score_video 按 DOVER 官方口径输出 fused/aesthetic/technical ∈ [0,1]。
"""

from __future__ import annotations

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
    """request: {projectId, chapterId, videoPath, mode: whole|slices, slices?}"""
    started = time.time()
    probe = probe_model()
    if probe["status"] != "ready":
        raise VideoQcError(probe["code"], probe["message"])

    mode = str(request.get("mode", "whole"))
    if mode not in ("whole", "slices"):
        raise VideoQcError("invalid-mode", f"mode 必须是 whole|slices: {mode}")

    # === 推理路径(架构 vendor 后启用)===
    # import torch  # noqa: F401 — 惰性导入,probe 路径零重依赖
    # from .dover_mobile_arch import load_model, score_frames
    #
    # model = load_model(find_cached_video_qc_model(DEFAULT_MODEL)["file_path"])
    # frames = sample_frames(video_path, fragments=32)   # ffmpeg 抽帧
    # fused, aesthetic, technical = score_frames(model, frames)
    raise VideoQcError(
        "arch-unavailable",
        "推理路径未启用:权重与架构 vendor 后,按上方注释补 20 行接线(fused/aesthetic/technical)",
    )
