#!/usr/bin/env python3
"""Offline depth model inventory scanner.

Usage:
  python -m depth_estimation.model_inventory

Prints JSON to stdout (mirrors tts/model_inventory.py contract):
  {"models": [{"modelName", "label", "downloaded", "sizeMb", "repoId", "cacheDir"}]}
"""

from __future__ import annotations

import json
import sys

from .model_cache import DEPTH_MODELS, primary_hf_cache_dir, find_cached_depth_model


def build_model_status() -> list[dict]:
    rows: list[dict] = []
    for name, spec in DEPTH_MODELS.items():
        cached = find_cached_depth_model(spec["repo_ids"])
        rows.append(
            {
                "modelName": name,
                "label": spec["label"],
                "downloaded": cached is not None,
                "sizeMb": cached["size_mb"] if cached else None,
                "repoId": spec["repo_id"],
                "cacheDir": cached["cache_dir"] if cached else None,
                "repoCacheDir": cached["repo_cache_dir"] if cached else None,
            }
        )
    return rows


def scan_model_inventory() -> dict:
    return {"models": build_model_status(), "cacheDir": str(primary_hf_cache_dir())}


if __name__ == "__main__":
    print(json.dumps(scan_model_inventory(), ensure_ascii=False))
    sys.exit(0)
