#!/usr/bin/env python3
"""Offline audio model inventory scanner. Usage: python -m audio_gen.model_inventory"""

from __future__ import annotations

import json
import sys

from .model_cache import AUDIO_MODELS, find_cached_audio_model


def scan_model_inventory() -> dict:
    models = []
    for name, spec in AUDIO_MODELS.items():
        cached = find_cached_audio_model(spec["repo_ids"])
        models.append(
            {
                "modelName": name,
                "label": spec["label"],
                "downloaded": cached is not None,
                "sizeMb": cached["size_mb"] if cached else None,
                "repoId": spec["repo_id"],
                "cacheDir": cached["cache_dir"] if cached else None,
            }
        )
    return {"models": models}


if __name__ == "__main__":
    print(json.dumps(scan_model_inventory(), ensure_ascii=False))
    sys.exit(0)
