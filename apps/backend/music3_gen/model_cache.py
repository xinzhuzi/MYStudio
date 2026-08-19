"""Music3 model cache helpers — mirrors audio_gen/sfx_gen model_cache.py.

The repo is self-contained (weights + generate.py + minimax_mlx_model.py),
downloaded as an HF snapshot; completeness = runtime files present + weights
dirs non-empty + no .incomplete blobs.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict

MODEL_WEIGHT_EXTENSIONS = (".safetensors", ".bin", ".npz", ".mlx")

MIN_MUSIC3_DURATION_S = 10.0
MAX_MUSIC3_DURATION_S = 300.0


class Music3ModelSpec(TypedDict):
    label: str
    repo_id: str
    repo_ids: tuple[str, ...]
    size_mb: int
    license: str
    description: str
    engine: str
    enabled: bool


# 自含仓库:权重+生成脚本一体(int8 量化 MLX)。mlx-community/mxfp8 裸权重
# 为二期换装候选(同架构,需核 manifest)——见任务 PRD 选型记录。
MUSIC3_MODELS: dict[str, Music3ModelSpec] = {
    "minimax-music3-mlx": {
        "label": "MiniMax-Music3(MLX 整曲引擎)",
        "repo_id": "PocketAiHub/MiniMax-Music3-MLX",
        "repo_ids": ("PocketAiHub/MiniMax-Music3-MLX",),
        "size_mb": 11900,
        "license": "MiniMax-Music3 Community License",
        "description": "本地整曲 BGM 生成(10-300 秒/44.1kHz 立体声,[Instrumental] 纯音乐,原生种子确定性;约 12 GB)",
        "engine": "mlx-native-script",
        "enabled": True,
    },
}


class CachedMusic3Model(TypedDict):
    repo_id: str
    cache_dir: str
    repo_cache_dir: str
    size_mb: float


def primary_hf_cache_dir() -> Path:
    env_cache = (
        os.environ.get("MYSTUDIO_AUDIO_MODEL_DIR")
        or os.environ.get("MANYING_TTS_MODELS_DIR")
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
    for env_name in ("MYSTUDIO_AUDIO_MODEL_DIR", "MANYING_TTS_MODELS_DIR", "HF_HUB_CACHE"):
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


def _snapshot_dir(repo: Path) -> Path | None:
    """HF snapshot 布局:<repo>/snapshots/<rev>/;取最新修改的那个。"""
    snapshots = repo / "snapshots"
    if not snapshots.is_dir():
        return None
    revisions = [p for p in snapshots.iterdir() if p.is_dir()]
    if not revisions:
        return None
    return max(revisions, key=lambda p: p.stat().st_mtime)


def _has_complete_music3(repo: Path) -> bool:
    snapshot = _snapshot_dir(repo)
    if snapshot is None:
        return False
    blobs_dir = repo / "blobs"
    if blobs_dir.exists() and any(blobs_dir.glob("*.incomplete")):
        return False
    # 自含运行时文件在场
    for required in ("generate.py", "minimax_mlx_model.py", "model_manifest.json"):
        if not (snapshot / required).is_file():
            return False
    # 权重目录非空(diffusion_models/text_encoders/vae)
    has_weights = any(
        any(file.is_file() for file in (snapshot / weight_dir).rglob("*"))
        for weight_dir in ("diffusion_models", "text_encoders", "vae")
    )
    return has_weights


def _cache_size_mb(repo: Path) -> float:
    size = sum(
        file.stat().st_size
        for file in repo.rglob("*")
        if file.is_file() and not file.name.endswith(".incomplete")
    )
    return round(size / 1024 / 1024, 2)


def find_cached_music3_model(repo_ids: tuple[str, ...]) -> CachedMusic3Model | None:
    for cache_dir in hf_cache_dirs():
        for repo_id in repo_ids:
            repo = repo_cache_dir(repo_id, cache_dir)
            if _has_complete_music3(repo):
                return {
                    "repo_id": repo_id,
                    "cache_dir": str(cache_dir),
                    "repo_cache_dir": str(_snapshot_dir(repo)),
                    "size_mb": _cache_size_mb(repo),
                }
    return None
