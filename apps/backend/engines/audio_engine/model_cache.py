"""Audio model cache helpers — mirrors depth_estimation/model_cache.py."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict

MODEL_WEIGHT_EXTENSIONS = (".safetensors", ".bin", ".pt", ".pth", ".npz", ".onnx")
# MusicGen's processor/model loader needs the model configuration and a real
# model weight. Auxiliary files such as `compression_state_dict.bin` alone do
# not make a HuggingFace snapshot runnable.
MODEL_CONFIG_FILES = ("config.json", "preprocessor_config.json")
MODEL_WEIGHT_PREFIXES = ("model", "pytorch_model")


class AudioModelSpec(TypedDict):
    label: str
    repo_id: str
    repo_ids: tuple[str, ...]
    size_mb: int
    license: str
    description: str


# MusicGen small: ~300M params, ~2 GB download. CC-BY-NC-4.0 (weights) — fine
# for personal/local use; commercial use requires a license from Meta.
AUDIO_MODELS: dict[str, AudioModelSpec] = {
    "musicgen-small": {
        "label": "MusicGen Small",
        "repo_id": "facebook/musicgen-small",
        "repo_ids": ("facebook/musicgen-small",),
        "size_mb": 2000,
        "license": "CC-BY-NC-4.0 (weights)",
        "description": "本地 BGM 生成（约 2 GB），生成 10-30 秒背景音乐",
    },
}


class CachedAudioModel(TypedDict):
    repo_id: str
    cache_dir: str
    repo_cache_dir: str
    size_mb: float


def primary_hf_cache_dir() -> Path:
    env_cache = (
        os.environ.get("MYSTUDIO_AUDIO_MODEL_DIR")
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


def hf_cache_dirs() -> list[Path]:
    candidates: list[Path] = []
    for env_name in ("MYSTUDIO_AUDIO_MODEL_DIR", "HF_HUB_CACHE"):
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
    snapshots = [path for path in snapshots_dir.iterdir() if path.is_dir()]
    for snapshot in snapshots:
        if not all((snapshot / name).is_file() for name in MODEL_CONFIG_FILES):
            continue
        if any(
            file.is_file()
            and file.suffix in MODEL_WEIGHT_EXTENSIONS
            and file.name.startswith(MODEL_WEIGHT_PREFIXES)
            for file in snapshot.rglob("*")
        ):
            return True
    return False


def _cache_size_mb(cache: Path) -> float:
    size = sum(
        file.stat().st_size
        for file in cache.rglob("*")
        if file.is_file() and not file.name.endswith(".incomplete")
    )
    return round(size / 1024 / 1024, 2)


def find_cached_audio_model(repo_ids: tuple[str, ...]) -> CachedAudioModel | None:
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
