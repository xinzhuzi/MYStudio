from __future__ import annotations

import json
from pathlib import Path

from .catalog import TTS_MODELS, TtsModel
from .model_cache import download_hf_cache_dir, find_cached_model, has_cached_repo_files


ALIGNMENT_MODEL_NAME = "whisper-large-v3-turbo"
ALIGNMENT_TOKENIZER_REPO = "openai/whisper-large-v3-turbo"
ALIGNMENT_TOKENIZER_FILES = ("tokenizer.json",)


def build_model_status(
    model: TtsModel,
    *,
    cache_dirs: list[Path] | None = None,
    downloading: bool = False,
    loaded: bool = False,
) -> dict[str, object]:
    """Build one model status using the caller's cache boundary."""
    cached = find_cached_model(model, cache_dirs=cache_dirs)
    downloaded = cached is not None
    if model.model_name == ALIGNMENT_MODEL_NAME:
        downloaded = downloaded and has_cached_repo_files(
            ALIGNMENT_TOKENIZER_REPO,
            ALIGNMENT_TOKENIZER_FILES,
            cache_dirs=[cached.cache_dir] if cached else cache_dirs,
        )
    return {
        "model_name": model.model_name,
        "display_name": model.display_name,
        "hf_repo_id": model.hf_repo_id,
        "downloaded": downloaded and not downloading,
        "downloading": downloading,
        "size_mb": cached.size_mb if cached else None,
        "model_cache_dir": str(cached.cache_dir) if cached else None,
        "model_repo_path": str(cached.repo_cache_dir) if cached else None,
        "loaded": loaded,
        "engine": model.engine,
        "model_size": model.model_size,
        "languages": list(model.languages),
        "purpose": model.purpose,
        "description": model.description,
    }


def scan_model_inventory() -> dict[str, list[dict[str, object]]]:
    """Return a read-only inventory for every local TTS model."""
    cache_dir = download_hf_cache_dir()
    return {"models": [build_model_status(model, cache_dirs=[cache_dir]) for model in TTS_MODELS]}


def main() -> None:
    print(json.dumps(scan_model_inventory(), ensure_ascii=False))


if __name__ == "__main__":
    main()
