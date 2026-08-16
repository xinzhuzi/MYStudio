"""Upscale model cache helpers — mirrors depth_estimation/model_cache.py
conventions, adapted for single-file Real-ESRGAN weights.

Models are NEVER auto-downloaded at inference time. The settings panel calls
model_inventory.py (scan) and download_model.py (explicit user-triggered
download) instead. Canonical storage is flat: <cacheDir>/<file> with a pinned
sha256 (the two MA-proven weights byte-match the current GitHub release
assets, so one hash pins both the modelscope mirror and GitHub fallback).
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import TypedDict


class UpscaleModelSpec(TypedDict):
    label: str
    description: str
    file: str
    url: str
    # (repo_id, file inside repo) pairs tried via modelscope/HF snapshot before
    # the GitHub release direct URL fallback. Empty tuple = GitHub only.
    sources: tuple[tuple[str, str], ...]
    sha256: str
    size_mb: int
    arch: dict
    scale: int
    license: str


UPSCALE_MODELS: dict[str, UpscaleModelSpec] = {
    "realesrgan-x4plus-anime-6b": {
        "label": "动漫插画 6B",
        "description": "Real-ESRGAN anime 6B,国漫/工笔/插画首选,道劫风格实证",
        "file": "RealESRGAN_x4plus_anime_6B.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth",
        "sources": (("amd/realesrgan-x4plus-anime-6b", "RealESRGAN_x4plus_anime_6B.pth"),),
        "sha256": "f872d837d3c90ed2e05227bed711af5671a6fd1c9f7d7e91c911a61f155e99da",
        "size_mb": 18,
        "arch": {
            "kind": "rrdbnet",
            "num_in_ch": 3,
            "num_out_ch": 3,
            "num_feat": 64,
            "num_block": 6,
            "num_grow_ch": 32,
            "scale": 4,
        },
        "scale": 4,
        "license": "BSD-3-Clause",
    },
    "realesrgan-x4plus": {
        "label": "通用照片 x4",
        "description": "Real-ESRGAN x4plus,照片/写实素材通用 4 倍超分",
        "file": "RealESRGAN_x4plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
        "sources": (("AI-ModelScope/Real-ESRGAN", "RealESRGAN_x4.pth"),),
        "sha256": "4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1",
        "size_mb": 64,
        "arch": {
            "kind": "rrdbnet",
            "num_in_ch": 3,
            "num_out_ch": 3,
            "num_feat": 64,
            "num_block": 23,
            "num_grow_ch": 32,
            "scale": 4,
        },
        "scale": 4,
        "license": "BSD-3-Clause",
    },
    "realesrgan-x2plus": {
        "label": "通用照片 x2",
        "description": "Real-ESRGAN x2plus,照片/写实素材通用 2 倍超分",
        "file": "RealESRGAN_x2plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth",
        "sources": (("AI-ModelScope/Real-ESRGAN", "RealESRGAN_x2.pth"),),
        "sha256": "49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb",
        "size_mb": 64,
        "arch": {
            "kind": "rrdbnet",
            "num_in_ch": 3,
            "num_out_ch": 3,
            "num_feat": 64,
            "num_block": 23,
            "num_grow_ch": 32,
            "scale": 2,
        },
        "scale": 2,
        "license": "BSD-3-Clause",
    },
    "realesr-animevideov3": {
        "label": "动画帧轻量 x4",
        "description": "realesr-animevideov3,动画/连续帧轻量 4 倍超分,速度最快",
        "file": "realesr-animevideov3.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth",
        "sources": (),
        "sha256": "b8a8376811077954d82ca3fcf476f1ac3da3e8a68a4f4d71363008000a18b75d",
        "size_mb": 3,
        "arch": {"kind": "srvgg", "num_feat": 64, "num_conv": 16, "upscale": 4},
        "scale": 4,
        "license": "BSD-3-Clause",
    },
    "realesr-general-x4v3": {
        "label": "通用轻量 x4",
        "description": "realesr-general-x4v3,通用轻量 4 倍超分,支持降噪风格",
        "file": "realesr-general-x4v3.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
        "sources": (),
        "sha256": "8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292",
        "size_mb": 5,
        "arch": {"kind": "srvgg", "num_feat": 64, "num_conv": 32, "upscale": 4},
        "scale": 4,
        "license": "BSD-3-Clause",
    },
}

DEFAULT_UPSCALE_MODEL = "realesrgan-x4plus-anime-6b"


class CachedUpscaleModel(TypedDict):
    file_path: str
    size_mb: float
    sha256: str


def primary_model_dir() -> Path:
    # MYSTUDIO_UPSCALE_MODEL_DIR is always set by the TS runtime controller to
    # the user-configured dir (default <userData>/UpscaleModel). The home
    # fallback only serves standalone CLI runs.
    env_cache = os.environ.get("MYSTUDIO_UPSCALE_MODEL_DIR")
    if env_cache:
        return Path(env_cache).expanduser()
    return Path.home() / ".mystudio" / "upscale-models"


def model_candidate_dirs() -> list[Path]:
    seen: set[str] = set()
    unique: list[Path] = []
    for path in (primary_model_dir(), Path.home() / ".mystudio" / "upscale-models"):
        expanded = path.expanduser()
        if str(expanded) in seen:
            continue
        seen.add(str(expanded))
        unique.append(expanded)
    return unique


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cached_model_path(model_dir: Path, spec: UpscaleModelSpec) -> Path:
    return model_dir / spec["file"]


def find_cached_upscale_model(model_name: str) -> CachedUpscaleModel | None:
    spec = UPSCALE_MODELS.get(model_name)
    if not spec:
        return None
    for model_dir in model_candidate_dirs():
        path = cached_model_path(model_dir, spec)
        if path.is_file() and path.stat().st_size > 0:
            return {
                "file_path": str(path),
                "size_mb": round(path.stat().st_size / 1024 / 1024, 2),
                "sha256": spec["sha256"],
            }
    return None


def is_upscale_model_downloaded(model_name: str) -> tuple[bool, float | None]:
    cached = find_cached_upscale_model(model_name)
    if not cached:
        return False, None
    return True, cached["size_mb"]


def verify_model_sha256(model_name: str) -> tuple[bool, str]:
    """Full sha256 verification of the cached file against the pinned digest."""
    spec = UPSCALE_MODELS.get(model_name)
    if not spec:
        return False, "unknown-model"
    for model_dir in model_candidate_dirs():
        path = cached_model_path(model_dir, spec)
        if path.is_file():
            return (file_sha256(path) == spec["sha256"], str(path))
    return False, "model-not-downloaded"


def delete_cached_model(model_name: str) -> bool:
    """Remove the cached model file. Returns True when something was removed."""
    spec = UPSCALE_MODELS.get(model_name)
    if not spec:
        return False
    removed = False
    for model_dir in model_candidate_dirs():
        path = cached_model_path(model_dir, spec)
        if path.is_file():
            try:
                path.unlink()
                removed = True
            except OSError:
                pass
    return removed
