from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .catalog import TtsModel


MODEL_WEIGHT_EXTENSIONS = (".safetensors", ".bin", ".pt", ".pth", ".npz", ".onnx")

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


def _unique_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    unique: list[Path] = []
    for path in paths:
        key = str(path.expanduser())
        if key in seen:
            continue
        seen.add(key)
        unique.append(path.expanduser())
    return unique


def primary_hf_cache_dir() -> Path:
    env_cache = os.environ.get("MANYING_TTS_MODELS_DIR") or os.environ.get("VOICEBOX_MODELS_DIR") or os.environ.get("HF_HUB_CACHE")
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


def _with_hub_subdir(paths: list[Path]) -> list[Path]:
    expanded: list[Path] = []
    for path in paths:
        expanded.append(path)
        if path.name != "hub":
            expanded.append(path / "hub")
    return expanded


def hf_cache_dirs() -> list[Path]:
    candidates: list[Path] = []
    for env_name in ("MANYING_TTS_MODELS_DIR", "VOICEBOX_MODELS_DIR", "HF_HUB_CACHE"):
        value = os.environ.get(env_name)
        if value:
            candidates.append(Path(value))

    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        candidates.append(Path(hf_home))
        candidates.append(Path(hf_home) / "hub")

    try:
        from huggingface_hub import constants as hf_constants

        hf_hub_cache = Path(hf_constants.HF_HUB_CACHE)
        candidates.append(hf_hub_cache)
        candidates.append(hf_hub_cache.parent)
    except Exception:
        pass

    candidates.extend(
        [
            Path.home() / ".cache" / "huggingface",
            Path.home() / ".cache" / "huggingface" / "hub",
            Path.home() / "Library" / "Caches" / "huggingface",
            Path.home() / "Library" / "Caches" / "huggingface" / "hub",
        ]
    )
    return _unique_paths(_with_hub_subdir(candidates))


def repo_cache_name(repo_id: str) -> str:
    return "models--" + repo_id.replace("/", "--")


def repo_cache_dir(repo_id: str, cache_dir: Path | None = None) -> Path:
    return (cache_dir or primary_hf_cache_dir()) / repo_cache_name(repo_id)


def model_repo_ids(model: TtsModel) -> tuple[str, ...]:
    return tuple(dict.fromkeys((model.hf_repo_id, *MODEL_REPO_ALIASES.get(model.model_name, ()))))


def _has_complete_model_files(cache: Path) -> bool:
    if not cache.exists():
        return False
    blobs_dir = cache / "blobs"
    if blobs_dir.exists() and any(blobs_dir.glob("*.incomplete")):
        return False
    snapshots_dir = cache / "snapshots"
    if not snapshots_dir.exists():
        return False
    return any(snapshots_dir.rglob(f"*{extension}") for extension in MODEL_WEIGHT_EXTENSIONS)


def _cache_size_mb(cache: Path) -> float:
    size = sum(file.stat().st_size for file in cache.rglob("*") if file.is_file() and not file.name.endswith(".incomplete"))
    return round(size / 1024 / 1024, 2)


def find_cached_repo(repo_ids: tuple[str, ...]) -> CachedModel | None:
    for cache_dir in hf_cache_dirs():
        for repo_id in repo_ids:
            cache = repo_cache_dir(repo_id, cache_dir)
            if _has_complete_model_files(cache):
                return CachedModel(
                    repo_id=repo_id,
                    cache_dir=cache_dir,
                    repo_cache_dir=cache,
                    size_mb=_cache_size_mb(cache),
                )
    return None


def find_cached_model(model: TtsModel) -> CachedModel | None:
    return find_cached_repo(model_repo_ids(model))


def is_model_downloaded(model: TtsModel) -> tuple[bool, float | None]:
    cached = find_cached_model(model)
    if not cached:
        return False, None
    return True, cached.size_mb
