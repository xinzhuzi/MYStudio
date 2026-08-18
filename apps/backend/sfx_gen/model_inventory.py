#!/usr/bin/env python3
"""Offline sfx model inventory scanner. Usage: python -m sfx_gen.model_inventory"""

from __future__ import annotations

import json
import sys

from .model_cache import SFX_MODELS, find_cached_sfx_model


def scan_model_inventory() -> dict:
    models = []
    for name, spec in SFX_MODELS.items():
        cached = find_cached_sfx_model(spec["repo_ids"])
        models.append(
            {
                "modelName": name,
                "label": spec["label"],
                "downloaded": cached is not None,
                "sizeMb": cached["size_mb"] if cached else None,
                "repoId": spec["repo_id"],
                "cacheDir": cached["cache_dir"] if cached else None,
                "enabled": spec["enabled"],
                "engine": spec["engine"],
            }
        )
    return {"models": models}


if __name__ == "__main__":
    print(json.dumps(scan_model_inventory(), ensure_ascii=False))
    sys.exit(0)
