"""Depth model cache helpers — thin wrapper over model_cache_core.

Models are NEVER auto-downloaded at inference time. The settings panel calls
model_inventory.py (scan) and download_model.py (explicit user-triggered
download) instead.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import TypedDict

import model_cache_core as _core

MODEL_WEIGHT_EXTENSIONS = _core.DEFAULT_WEIGHT_EXTENSIONS

# env 表=Electron spawn 契约(见 model_cache_core 模块头)。
# MYSTUDIO_DEPTH_MODEL_DIR 由 TS runtime controller 恒注入(<userData>/DeepModel),
# 其余条目仅作独立 CLI 运行的兜底;多候选不含 huggingface_hub 常量探测(原实现如此)。
_CACHE_ENV_NAMES = ("MYSTUDIO_DEPTH_MODEL_DIR", "MANYING_TTS_MODELS_DIR", "VOICEBOX_MODELS_DIR", "HF_HUB_CACHE")


class DepthModelSpec(TypedDict):
    label: str
    repo_id: str
    repo_ids: tuple[str, ...]
    size_mb: int
    license: str


DEPTH_MODELS: dict[str, DepthModelSpec] = {
    "depth-anything-v2-small": {
        "label": "Depth Anything V2 Small",
        "repo_id": "depth-anything/Depth-Anything-V2-Small-hf",
        "repo_ids": ("depth-anything/Depth-Anything-V2-Small-hf",),
        "size_mb": 100,
        "license": "Apache-2.0",
    },
}


class CachedDepthModel(TypedDict):
    repo_id: str
    cache_dir: str
    repo_cache_dir: str
    size_mb: float


def primary_hf_cache_dir() -> Path:
    return _core.primary_hf_cache_dir(_CACHE_ENV_NAMES[:1])


def download_hf_cache_dir() -> Path:
    return _core.download_hf_cache_dir(_CACHE_ENV_NAMES[:1])


def hf_cache_dirs() -> list[Path]:
    # depth 原实现为纯静态候选+去重(无 hf 常量探测/无 hub 子目录扩展),保持双关。
    return _core.hf_cache_dirs(_CACHE_ENV_NAMES, probe_hf_constants=False, expand_hub_subdir=False)


def repo_cache_name(repo_id: str) -> str:
    return _core.repo_cache_name(repo_id)


def repo_cache_dir(repo_id: str, cache_dir: Path | None = None) -> Path:
    return (cache_dir or primary_hf_cache_dir()) / _core.repo_cache_name(repo_id)


def resolve_snapshot_dir(repo_cache: str | Path) -> Path:
    root = Path(repo_cache)
    refs_main = root / "refs" / "main"
    if refs_main.is_file():
        ref = refs_main.read_text(encoding="utf-8").strip()
        snapshot = root / "snapshots" / ref
        if snapshot.is_dir():
            return snapshot
    snapshots = root / "snapshots"
    if snapshots.is_dir():
        for entry in sorted(snapshots.iterdir()):
            if entry.is_dir():
                return entry
    raise FileNotFoundError(f"模型缓存缺少快照目录: {repo_cache}")


def model_weight_sha256(repo_cache: str | Path) -> str:
    snapshot = resolve_snapshot_dir(repo_cache)
    weight_files = sorted(
        file
        for extension in MODEL_WEIGHT_EXTENSIONS
        for file in snapshot.rglob(f"*{extension}")
        if file.is_file()
    )
    if not weight_files:
        raise FileNotFoundError(f"模型缓存缺少权重文件: {repo_cache}")
    digest = hashlib.sha256()
    for file in weight_files:
        digest.update(file.relative_to(snapshot).as_posix().encode("utf-8"))
        digest.update(b"\0")
        with file.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def find_cached_depth_model(repo_ids: tuple[str, ...]) -> CachedDepthModel | None:
    hit = _core.find_weight_repo(repo_ids, hf_cache_dirs())
    if hit is None:
        return None
    return {
        "repo_id": hit.repo_id,
        "cache_dir": str(hit.cache_dir),
        "repo_cache_dir": str(hit.repo_cache_dir),
        "size_mb": hit.size_mb,
    }


def is_depth_model_downloaded(model_name: str) -> tuple[bool, float | None]:
    spec = DEPTH_MODELS.get(model_name)
    if not spec:
        return False, None
    cached = find_cached_depth_model(spec["repo_ids"])
    if not cached:
        return False, None
    return True, cached["size_mb"]


def delete_cached_model(model_name: str) -> bool:
    """Remove the cached model directory. Returns True when something was removed."""
    spec = DEPTH_MODELS.get(model_name)
    if not spec:
        return False
    import shutil

    removed = False
    for cache_dir in hf_cache_dirs():
        for repo_id in spec["repo_ids"]:
            cache = repo_cache_dir(repo_id, cache_dir)
            if cache.exists():
                shutil.rmtree(cache, ignore_errors=True)
                removed = True
    return removed
