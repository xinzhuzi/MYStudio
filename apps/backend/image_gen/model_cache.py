"""Image model cache helpers — mirrors depth_estimation/model_cache.py."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict

MODEL_WEIGHT_EXTENSIONS = (".safetensors", ".bin", ".pt", ".pth", ".npz", ".onnx")


class ImageModelSpec(TypedDict):
    label: str
    repo_id: str
    repo_ids: tuple[str, ...]
    size_mb: int
    license: str
    steps: int
    description: str


# Catalog — SDXL Turbo is the default: fastest (1-4 steps), Apache-ish open
# license ( Stability AI Community License), ~6 GB download.
IMAGE_MODELS: dict[str, ImageModelSpec] = {
    "sdxl-turbo": {
        "label": "SDXL Turbo",
        "repo_id": "stabilityai/sdxl-turbo",
        "repo_ids": ("stabilityai/sdxl-turbo",),
        "size_mb": 6000,
        "license": "Stability AI Community License (non-commercial)",
        "steps": 4,
        "description": "最快（1-4 步出图），适合分镜草图与批量生成",
    },
    "flux-schnell": {
        "label": "FLUX.1 schnell",
        "repo_id": "black-forest-labs/FLUX.1-schnell",
        "repo_ids": ("black-forest-labs/FLUX.1-schnell",),
        "size_mb": 12000,
        "license": "Apache-2.0",
        "steps": 4,
        "description": "质量更高，Apache-2.0 商用友好，约 12 GB",
    },
}


class CachedImageModel(TypedDict):
    repo_id: str
    cache_dir: str
    repo_cache_dir: str
    size_mb: float


def primary_hf_cache_dir() -> Path:
    env_cache = (
        os.environ.get("MYSTUDIO_IMAGE_MODEL_DIR")
        or os.environ.get("MANYING_TTS_MODELS_DIR")
        or os.environ.get("VOICEBOX_MODELS_DIR")
        or os.environ.get("HF_HUB_CACHE")
    )
    if env_cache:
        return Path(env_cache).expanduser()

    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return Path(hf_home).expanduser() / "hub"

    try:
        from huggingface_hub import constants as hf_constants

        return Path(hf_constants.HF_HUB_CACHE).expanduser()
    except Exception:
        return Path.home() / ".cache" / "huggingface" / "hub"


def download_hf_cache_dir() -> Path:
    cache_dir = primary_hf_cache_dir()
    if cache_dir.name == "huggingface":
        return cache_dir / "hub"
    if cache_dir.name != "hub" and (cache_dir / "hub").exists():
        return cache_dir / "hub"
    return cache_dir


def hf_cache_dirs() -> list[Path]:
    candidates: list[Path] = []
    for env_name in ("MYSTUDIO_IMAGE_MODEL_DIR", "MANYING_TTS_MODELS_DIR", "VOICEBOX_MODELS_DIR", "HF_HUB_CACHE"):
        value = os.environ.get(env_name)
        if value:
            candidates.append(Path(value))
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        candidates.append(Path(hf_home))
        candidates.append(Path(hf_home) / "hub")
    candidates.extend(
        [
            Path.home() / ".cache" / "huggingface",
            Path.home() / ".cache" / "huggingface" / "hub",
            Path.home() / "Library" / "Caches" / "huggingface",
            Path.home() / "Library" / "Caches" / "huggingface" / "hub",
        ]
    )
    seen: set[str] = set()
    unique: list[Path] = []
    for path in candidates:
        expanded = path.expanduser()
        if str(expanded) in seen:
            continue
        seen.add(str(expanded))
        unique.append(expanded)
    return unique


def repo_cache_name(repo_id: str) -> str:
    return "models--" + repo_id.replace("/", "--")


def repo_cache_dir(repo_id: str, cache_dir: Path | None = None) -> Path:
    return (cache_dir or primary_hf_cache_dir()) / repo_cache_name(repo_id)


def _has_complete_model_files(cache: Path) -> bool:
    if not cache.exists():
        return False
    blobs_dir = cache / "blobs"
    if blobs_dir.exists() and any(blobs_dir.glob("*.incomplete")):
        return False
    snapshots_dir = cache / "snapshots"
    if not snapshots_dir.exists():
        return False
    return any(
        file.is_file()
        for extension in MODEL_WEIGHT_EXTENSIONS
        for file in snapshots_dir.rglob(f"*{extension}")
    )


def _cache_size_mb(cache: Path) -> float:
    size = sum(
        file.stat().st_size
        for file in cache.rglob("*")
        if file.is_file() and not file.name.endswith(".incomplete")
    )
    return round(size / 1024 / 1024, 2)


def find_cached_image_model(repo_ids: tuple[str, ...]) -> CachedImageModel | None:
    for cache_dir in hf_cache_dirs():
        for repo_id in repo_ids:
            cache = repo_cache_dir(repo_id, cache_dir)
            if _has_complete_model_files(cache):
                return {
                    "repo_id": repo_id,
                    "cache_dir": str(cache_dir),
                    "repo_cache_dir": str(cache),
                    "size_mb": _cache_size_mb(cache),
                }
    return None


def is_image_model_downloaded(model_name: str) -> tuple[bool, float | None]:
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        return False, None
    cached = find_cached_image_model(spec["repo_ids"])
    if not cached:
        return False, None
    return True, cached["size_mb"]
