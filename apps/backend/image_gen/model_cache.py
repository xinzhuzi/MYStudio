"""Image model cache — thin dispatcher(08-31 重构:每引擎独立模块)。

本文件只做:① 公共工具(HF 缓存/ComfyUI 路径/别名)② 从 engines/
聚合 IMAGE_MODELS 和各引擎的 resolve/find/status 函数并 re-export。
引擎自身逻辑(spec/常量/装配/生成/LoRA/下载)全在 engines/<name>.py。
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict

from .engines import krea2 as _krea2
from .engines import flux2 as _flux2
from .engines import z_image as _z_image
from .engines import qwen as _qwen

# ── 别名 ──
LEGACY_IMAGE_MODEL_ALIASES: dict[str, str] = {
    "sdxl-turbo": _qwen.MODEL_NAME,
    "flux-schnell": _qwen.MODEL_NAME,
}

# ── 公共类型 ──
class ImageModelSpec(TypedDict):
    label: str
    repo_id: str
    repo_ids: tuple[str, ...]
    size_mb: int
    license: str
    steps: int
    description: str

class PointedImageModelSpec(ImageModelSpec, total=False):
    layout: str

class CachedImageModel(TypedDict):
    repo_id: str
    cache_dir: str
    repo_cache_dir: str
    size_mb: float

# ── 公共工具 ──
def comfyui_models_dir() -> Path:
    override = os.environ.get("MYSTUDIO_QWEN_COMFYUI_MODELS_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / "Project" / "ComfyUI" / "models"

def resolve_image_model_name(name: str) -> str:
    return LEGACY_IMAGE_MODEL_ALIASES.get(name, name)

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
        return Path(hf_home).expanduser()
    return Path.home() / ".cache" / "huggingface" / "hub"

def download_hf_cache_dir() -> Path:
    cache_dir = primary_hf_cache_dir()
    if cache_dir.name == "huggingface":
        return cache_dir / "hub"
    return cache_dir

def hf_cache_dirs() -> list[Path]:
    seen: list[Path] = []
    for candidate in (primary_hf_cache_dir(), download_hf_cache_dir(),
                      Path.home() / ".cache" / "huggingface",
                      Path.home() / ".cache" / "huggingface" / "hub",
                      Path.home() / "Library" / "Caches" / "huggingface",
                      Path.home() / "Library" / "Caches" / "huggingface" / "hub"):
        if candidate not in seen:
            seen.append(candidate)
    return seen

def repo_cache_name(repo_id: str) -> str:
    return "models--" + repo_id.replace("/", "--")

def repo_cache_dir(repo_id: str, cache_dir: Path | None = None) -> Path:
    return (cache_dir or primary_hf_cache_dir()) / repo_cache_name(repo_id)

def hf_snapshot_dir(repo_id: str, cache_dir: Path | None = None) -> Path | None:
    repo_dir = repo_cache_dir(repo_id, cache_dir)
    if not repo_dir.is_dir():
        return None
    snapshots = sorted(
        (s for s in (repo_dir / "snapshots").iterdir() if s.is_dir()),
        key=lambda s: s.stat().st_mtime,
        reverse=True,
    )
    return snapshots[0] if snapshots else None

# ── IMAGE_MODELS 注册表(从 engines/ 聚合) ──
IMAGE_MODELS: dict[str, PointedImageModelSpec] = {
    _krea2.MODEL_NAME: _krea2.SPEC,
    _flux2.MODEL_NAME: _flux2.SPEC,
    _z_image.MODEL_NAME: _z_image.SPEC,
    _qwen.MODEL_NAME: _qwen.SPEC,
}

# ── 引擎分派 ──
_ENGINE_BY_LAYOUT = {
    "krea2-pointed": _krea2,
    "flux2-pointed": _flux2,
    "z-image-pointed": _z_image,
    "qwen-pointed": _qwen,
}

def find_cached_image_model_for_spec(spec: ImageModelSpec) -> CachedImageModel | None:
    engine = _ENGINE_BY_LAYOUT.get(spec.get("layout", ""))
    if engine is not None:
        return engine.find_cached(comfyui_models_dir())
    return _find_cached_hf(spec)

def _find_cached_hf(spec: ImageModelSpec) -> CachedImageModel | None:
    for repo_id in spec.get("repo_ids", (spec["repo_id"],)):
        cache_dir = primary_hf_cache_dir()
        cache = repo_cache_dir(repo_id, cache_dir) / "snapshots"
        if cache.is_dir():
            for snapshot in sorted(cache.iterdir(), reverse=True):
                if snapshot.is_dir() and any(snapshot.rglob("config.json")):
                    size = sum(f.stat().st_size for f in snapshot.rglob("*") if f.is_file())
                    return {"repo_id": repo_id, "cache_dir": str(cache_dir),
                            "repo_cache_dir": str(snapshot), "size_mb": round(size/1024/1024, 2)}
    return None

def is_image_model_downloaded(model_name: str) -> tuple[bool, float | None]:
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        return False, None
    cached = find_cached_image_model_for_spec(spec)
    if not cached:
        return False, None
    return True, cached["size_mb"]

# ── Re-export(保持 pipeline/download_model/inventory/server 的既有 import 不破) ──
QWEN_IMAGE_EDIT_MODEL = _qwen.MODEL_NAME
QWEN_IMAGE_REPO = _qwen.IMAGE_REPO
QWEN_VL_REPO = _qwen.VL_REPO
QWEN_GGUF_REPO = _qwen.GGUF_REPO
QWEN_GGUF_FILE = _qwen.GGUF_FILE
QWEN_TE_REPO = _qwen.TE_REPO
QWEN_TE_FILE = _qwen.TE_FILE
QWEN_BIG_FILE_REPOS = _qwen.BIG_FILE_REPOS
QWEN_SMALL_PIECE_REPOS = _qwen.SMALL_PIECE_REPOS
QWEN_IMAGE_REQUIRED_FILES = _qwen.IMAGE_REQUIRED
QWEN_VL_REQUIRED_FILES = _qwen.VL_REQUIRED
QWEN_SMALL_PIECES_SIZE_MB = _qwen.SMALL_PIECES_SIZE_MB

Z_IMAGE_MODEL = _z_image.MODEL_NAME
Z_IMAGE_SMALL_REPO = _z_image.SMALL_REPO
Z_IMAGE_SMALL_EXACT_FILES = _z_image.SMALL_EXACT_FILES
Z_IMAGE_SMALL_PIECE_REPOS = ((_z_image.SMALL_REPO, _z_image.SMALL_EXACT_FILES),)

FLUX2_KLEIN_MODEL = _flux2.MODEL_NAME
FLUX2_SMALL_REPO = _flux2.SMALL_REPO
FLUX2_SMALL_EXACT_FILES = _flux2.SMALL_EXACT_FILES
FLUX2_SMALL_PIECE_REPOS = ((_flux2.SMALL_REPO, _flux2.SMALL_EXACT_FILES),)

KREA2_MODEL = _krea2.MODEL_NAME
KREA2_SMALL_REPO = _krea2.SMALL_REPO
KREA2_SMALL_EXACT_FILES = _krea2.SMALL_EXACT_FILES
KREA2_SMALL_PIECE_REPOS = ((_krea2.SMALL_REPO, _krea2.SMALL_EXACT_FILES),)

def resolve_qwen_big_files(cache_dir=None):
    return _qwen.resolve_big_files(comfyui_models_dir(), hf_snapshot_dir, cache_dir)

def resolve_z_image_big_files(cache_dir=None):
    return _z_image.resolve_big_files(comfyui_models_dir())

def resolve_flux2_big_files(cache_dir=None):
    return _flux2.resolve_big_files(comfyui_models_dir())

def resolve_krea2_big_files(cache_dir=None):
    return _krea2.resolve_big_files(comfyui_models_dir())

def qwen_small_pieces_status(cache_dir=None):
    return _qwen.small_pieces_status(hf_snapshot_dir, cache_dir)

def z_image_small_pieces_status(cache_dir=None):
    return _z_image.small_pieces_status(hf_snapshot_dir, cache_dir)

def flux2_small_pieces_status(cache_dir=None):
    return _flux2.small_pieces_status(hf_snapshot_dir, cache_dir)

def krea2_small_pieces_status(cache_dir=None):
    return _krea2.small_pieces_status(hf_snapshot_dir, cache_dir)

def qwen_pointed_big_files():
    return _qwen.pointed_big_files(comfyui_models_dir())

def z_image_pointed_big_files():
    return _z_image.pointed_big_files(comfyui_models_dir())
