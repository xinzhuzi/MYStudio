"""Depth model cache helpers — mirrors tts/model_cache.py conventions.

Models are NEVER auto-downloaded at inference time. The settings panel calls
model_inventory.py (scan) and download_model.py (explicit user-triggered
download) instead.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import TypedDict

MODEL_WEIGHT_EXTENSIONS = (".safetensors", ".bin", ".pt", ".pth", ".npz", ".onnx")


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
    # MYSTUDIO_DEPTH_MODEL_DIR is always set by the TS runtime controller to
    # the user-configured dir (default <userData>/DeepModel). Remaining entries
    # are safety fallbacks for standalone CLI runs only.
    env_cache = os.environ.get("MYSTUDIO_DEPTH_MODEL_DIR")
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
    for env_name in ("MYSTUDIO_DEPTH_MODEL_DIR", "MANYING_TTS_MODELS_DIR", "VOICEBOX_MODELS_DIR", "HF_HUB_CACHE"):
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


def find_cached_depth_model(repo_ids: tuple[str, ...]) -> CachedDepthModel | None:
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
