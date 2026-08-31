"""Video QC model cache helpers — mirrors upscale/model_cache.py conventions.

当前 DOVER-Mobile 激活配置已核实：官方 v0.5.0 release URL、首下载
SHA-256 pin 与 modelscope 备选源均保留在下方 spec；推理架构位于本包
`dover_mobile_arch.py`，并带 VQAssessment/DOVER 的 LICENSE 溯源。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict

import model_cache_core as _core


class VideoQcModelSpec(TypedDict):
    label: str
    description: str
    file: str
    url: str
    # (repo_id, file inside repo) pairs tried via modelscope/HF snapshot before
    # the direct URL fallback. Empty tuple = no snapshot source.
    sources: tuple[tuple[str, str], ...]
    # 固定 pin；find_cached_video_qc_model 会拒绝 hash 不一致的文件。
    sha256: str
    size_mb: int
    license: str


VIDEO_QC_MODELS: dict[str, VideoQcModelSpec] = {
    "dover-mobile": {
        "label": "DOVER-Mobile 观感评分",
        "description": "ICCV 2023 DOVER 的移动版(9.86M 参数,纯 CPU ~1.4s/片),"
        "UGC 校准——只做按系列基线的相对告警,不做绝对国标",
        "file": "dover_mobile.pth",
        "url": "https://github.com/VQAssessment/DOVER/releases/download/v0.5.0/DOVER-Mobile.pth",
        "sources": (
            ("VQAssessment/DOVER", "assets/DOVER-Mobile.pth"),  # modelscope snapshot 备选
        ),
        "sha256": "81b487be2aa4b3dd6920afa2e92294ed8fdd46a306911f75ecc8e6938a670884",
        "size_mb": 41,
        "license": "S-Lab License 1.0 (non-commercial; attribution required)",
    },
}

DEFAULT_VIDEO_QC_MODEL = "dover-mobile"


class CachedVideoQcModel(TypedDict):
    file_path: str
    size_mb: float
    sha256: str


def primary_model_dir() -> Path:
    # MYSTUDIO_VIDEO_QC_MODEL_DIR is always set by the TS runtime controller to
    # the user-configured dir (default <userData>/VideoQcModel). The home
    # fallback only serves standalone CLI runs.
    env_cache = os.environ.get("MYSTUDIO_VIDEO_QC_MODEL_DIR")
    if env_cache:
        return Path(env_cache).expanduser()
    return Path.home() / ".mystudio" / "video-qc-models"


def _electron_userdata_model_dir() -> Path | None:
    # macOS Electron userData convention, HOME-based so it resolves for any
    # user on this machine. Only offered as a standalone-CLI convenience when
    # the runtime env var is absent — the TS controller always sets the env.
    candidate = Path.home() / "Library" / "Application Support" / "漫影工作室" / "model" / "videoqc"
    return candidate if candidate.is_dir() else None


def model_candidate_dirs() -> list[Path]:
    # Order: env-driven primary dir (set by the TS runtime controller to
    # <storageBase>/model/videoqc) → HOME-derived Electron userData dir →
    # standalone-CLI home fallback. No absolute user paths anywhere.
    candidates: list[Path] = [primary_model_dir()]
    userdata_dir = _electron_userdata_model_dir()
    if userdata_dir is not None:
        candidates.append(userdata_dir)
    candidates.append(Path.home() / ".mystudio" / "video-qc-models")
    return _core.unique_paths(candidates)


def file_sha256(path: Path) -> str:
    return _core.file_sha256(path)


def cached_model_path(model_dir: Path, spec: VideoQcModelSpec) -> Path:
    return model_dir / spec["file"]


def find_cached_video_qc_model(model_name: str) -> CachedVideoQcModel | None:
    spec = VIDEO_QC_MODELS.get(model_name)
    if not spec:
        return None
    # 空 pin(未核实)只验存在与大小;回填 sha256 后自动收紧为强校验
    hit = _core.find_pinned_file(
        model_candidate_dirs(),
        spec["file"],
        spec["sha256"],
        allow_empty_pin=True,
    )
    if hit is None:
        return None
    return {
        "file_path": str(hit.file_path),
        "size_mb": hit.size_mb,
        "sha256": hit.sha256,
    }


def is_video_qc_model_downloaded(model_name: str) -> tuple[bool, float | None]:
    cached = find_cached_video_qc_model(model_name)
    if not cached:
        return False, None
    return True, cached["size_mb"]


def verify_model_sha256(model_name: str) -> tuple[bool, str]:
    spec = VIDEO_QC_MODELS.get(model_name)
    if not spec:
        return False, "unknown-model"
    if not spec["sha256"]:
        # 未 pin:存在即通过(下载源核实后回填)
        for model_dir in model_candidate_dirs():
            path = cached_model_path(model_dir, spec)
            if path.is_file() and path.stat().st_size > 0:
                return True, str(path)
        return False, "model-not-downloaded"
    for model_dir in model_candidate_dirs():
        path = cached_model_path(model_dir, spec)
        if path.is_file():
            return (file_sha256(path) == spec["sha256"], str(path))
    return False, "model-not-downloaded"


def delete_cached_model(model_name: str) -> bool:
    spec = VIDEO_QC_MODELS.get(model_name)
    if not spec:
        return False
    return _core.delete_pinned_file(
        model_candidate_dirs(),
        spec["file"],
    )
