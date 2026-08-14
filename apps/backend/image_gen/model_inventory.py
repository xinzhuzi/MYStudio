#!/usr/bin/env python3
"""Offline image model inventory scanner.

Usage:
  python -m image_gen.model_inventory
"""

from __future__ import annotations

import json
import sys

from .model_cache import IMAGE_MODELS, find_cached_image_model


def build_model_status() -> list[dict]:
    rows: list[dict] = []
    for name, spec in IMAGE_MODELS.items():
        cached = find_cached_image_model(spec["repo_ids"])
        rows.append(
            {
                "modelName": name,
                "label": spec["label"],
                "downloaded": cached is not None,
                "sizeMb": cached["size_mb"] if cached else None,
                "repoId": spec["repo_id"],
                "cacheDir": cached["cache_dir"] if cached else None,
            }
        )
    return rows


def scan_model_inventory() -> dict:
    return {"models": build_model_status()}


if __name__ == "__main__":
    print(json.dumps(scan_model_inventory(), ensure_ascii=False))
    sys.exit(0)
