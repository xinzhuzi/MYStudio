from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import model_cache_core as _core
from .catalog import TtsModel


MODEL_WEIGHT_EXTENSIONS = _core.DEFAULT_WEIGHT_EXTENSIONS

# env 表=Electron spawn 契约(见 model_cache_core 模块头),禁止顺手增删。
_CACHE_ENV_NAMES = ("MANYING_TTS_MODELS_DIR", "VOICEBOX_MODELS_DIR", "HF_HUB_CACHE")

MODEL_REPO_ALIASES: dict[str, tuple[str, ...]] = {
    "qwen-tts-1.7B": (
        "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
        "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    ),
    "qwen-tts-0.6B": (
        "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
        "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    ),
}


@dataclass(frozen=True)
class CachedModel:
    repo_id: str
    cache_dir: Path
    repo_cache_dir: Path
    size_mb: float


def primary_hf_cache_dir() -> Path:
    return _core.primary_hf_cache_dir(_CACHE_ENV_NAMES)


def download_hf_cache_dir() -> Path:
    return _core.download_hf_cache_dir(_CACHE_ENV_NAMES)


def hf_cache_dirs() -> list[Path]:
    # tts 原实现含 huggingface_hub 常量探测与 hub 子目录扩展,保持双开。
    return _core.hf_cache_dirs(_CACHE_ENV_NAMES)


def repo_cache_name(repo_id: str) -> str:
    return _core.repo_cache_name(repo_id)


def repo_cache_dir(repo_id: str, cache_dir: Path | None = None) -> Path:
    return (cache_dir or primary_hf_cache_dir()) / _core.repo_cache_name(repo_id)


def model_repo_ids(model: TtsModel) -> tuple[str, ...]:
    return tuple(dict.fromkeys((model.hf_repo_id, *MODEL_REPO_ALIASES.get(model.model_name, ()))))


def find_cached_repo(repo_ids: tuple[str, ...], cache_dirs: list[Path] | None = None) -> CachedModel | None:
    """Find a complete cached repo, optionally within an explicit cache set.

    The optional list lets managed workers reuse the application's configured
    cache without silently falling back to a user's unrelated global cache.
    Existing TTS callers keep the historical multi-location scan when the
    argument is omitted.
    """
    hit = _core.find_weight_repo(repo_ids, cache_dirs or hf_cache_dirs())
    if hit is None:
        return None
    return CachedModel(
        repo_id=hit.repo_id,
        cache_dir=hit.cache_dir,
        repo_cache_dir=hit.repo_cache_dir,
        size_mb=hit.size_mb,
    )


def has_cached_repo_files(
    repo_id: str,
    required_files: tuple[str, ...],
    cache_dirs: list[Path] | None = None,
) -> bool:
    """Check a cached repository whose files are not model-weight files.

    Tokenizer repositories commonly contain JSON/vocabulary files but no
    ``safetensors`` weight.  They therefore cannot use ``find_cached_repo``'s
    model-weight completeness rule.
    """
    return _core.has_repo_files(repo_id, required_files, cache_dirs or hf_cache_dirs())


def find_cached_model(model: TtsModel, cache_dirs: list[Path] | None = None) -> CachedModel | None:
    return find_cached_repo(model_repo_ids(model), cache_dirs=cache_dirs)


def is_model_downloaded(model: TtsModel) -> tuple[bool, float | None]:
    cached = find_cached_model(model)
    if not cached:
        return False, None
    return True, cached.size_mb
