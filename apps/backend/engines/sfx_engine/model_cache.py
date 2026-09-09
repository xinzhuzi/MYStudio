"""SFX model cache helpers — mirrors audio_gen/model_cache.py.

Pluggable catalog (design D1): the first entry reuses the already-delivered
facebook/musicgen-small weights via transformers (zero new heavy deps, works
today, seed-deterministic for short one-shots). AudioGen stays a catalog
candidate pending live quality/licensing tests — do not flip it on blindly.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict

MODEL_WEIGHT_EXTENSIONS = (".safetensors", ".bin", ".pt", ".pth", ".npz", ".onnx")
# Keep auxiliary HF files (for example compression_state_dict.bin) from being
# mistaken for runnable MusicGen weights.
MODEL_CONFIG_FILES = ("config.json", "preprocessor_config.json")
MODEL_WEIGHT_PREFIXES = ("model", "pytorch_model")

MAX_SFX_DURATION_S = 5.0
MIN_SFX_DURATION_S = 0.5


class SfxModelSpec(TypedDict):
    label: str
    repo_id: str
    repo_ids: tuple[str, ...]
    size_mb: int
    license: str
    description: str
    engine: str  # "transformers-musicgen" | "audiocraft-audiogen"
    enabled: bool


SFX_MODELS: dict[str, SfxModelSpec] = {
    # P1 引擎:复用 MusicGen small 权重(与本地音乐生成相同仓库,独立缓存目录),提示词面向
    # 短音效;种子确定性=torch.manual_seed。许可同 musicgen-small。
    "sfx-musicgen-small": {
        "label": "音效生成(MusicGen 引擎)",
        "repo_id": "facebook/musicgen-small",
        "repo_ids": ("facebook/musicgen-small",),
        "size_mb": 2000,
        "license": "CC-BY-NC-4.0 (weights)",
        "description": "本地短音效生成(whoosh/impact/riser/环境拟声,≤5 秒,与本地音乐生成共用模型缓存)",
        "engine": "transformers-musicgen",
        "enabled": True,
    },
    # 选型候选(设计 D1):AudioGen 对短 one-shot 更对口,但需 audiocraft 依赖
    # (重)且许可商用边界待核——实测音质/体积通过后再启用。
    "audiogen-medium": {
        "label": "AudioGen Medium(候选)",
        "repo_id": "facebook/audiogen-medium",
        "repo_ids": ("facebook/audiogen-medium",),
        "size_mb": 6000,
        "license": "CC-BY-NC-4.0 (weights,待核)",
        "description": "选型候选:提示词短音效更对口;启用前需实测音质/体积并核 audiocraft 依赖与许可",
        "engine": "audiocraft-audiogen",
        "enabled": False,
    },
}


class CachedSfxModel(TypedDict):
    repo_id: str
    cache_dir: str
    repo_cache_dir: str
    size_mb: float


def primary_hf_cache_dir() -> Path:
    env_cache = os.environ.get("MYSTUDIO_SFX_MODEL_DIR") or os.environ.get("HF_HUB_CACHE")
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
    for env_name in ("MYSTUDIO_SFX_MODEL_DIR", "HF_HUB_CACHE"):
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


def find_cached_sfx_model(repo_ids: tuple[str, ...]) -> CachedSfxModel | None:
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
