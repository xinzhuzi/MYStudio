"""Audio model cache helpers — mirrors depth_estimation/model_cache.py."""

from __future__ import annotations

import os
from pathlib import Path

from common import model_cache_core as _core
from typing import TypedDict

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


# 家族 env 表=Electron spawn 契约(禁归一);委托 common 骨架,
# 双关旋钮(不探 hf_constants/不扩 hub 子目录)与历史手写版逐字等价
# (parity 场景 audio_engine:* 锁证)
_ENV_NAMES = ("MYSTUDIO_AUDIO_MODEL_DIR", "HF_HUB_CACHE")


def primary_hf_cache_dir() -> Path:
    return _core.primary_hf_cache_dir(_ENV_NAMES)


def hf_cache_dirs() -> list[Path]:
    return _core.hf_cache_dirs(_ENV_NAMES, probe_hf_constants=False, expand_hub_subdir=False)


def repo_cache_name(repo_id: str) -> str:
    return _core.repo_cache_name(repo_id)


def repo_cache_dir(repo_id: str, cache_dir: Path | None = None) -> Path:
    return _core.repo_cache_dir(repo_id, cache_dir or primary_hf_cache_dir())


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
            and file.suffix in _core.DEFAULT_WEIGHT_EXTENSIONS
            and file.name.startswith(MODEL_WEIGHT_PREFIXES)
            for file in snapshot.rglob("*")
        ):
            return True
    return False


def find_cached_audio_model(repo_ids: tuple[str, ...]) -> CachedAudioModel | None:
    for cache_dir in hf_cache_dirs():
        for repo_id in repo_ids:
            cache = repo_cache_dir(repo_id, cache_dir)
            if _has_complete_model_files(cache):
                return {
                    "repo_id": repo_id,
                    "cache_dir": str(cache_dir),
                    "repo_cache_dir": str(cache),
                    "size_mb": _core.cache_size_mb(cache),
                }
    return None
